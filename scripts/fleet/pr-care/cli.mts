/**
 * @file PR care and feeding, batched: the deterministic executor for tending
 *   a stack of open PRs. Judgment stays out (per code-first-then-ai): this
 *   tool never decides whether a bot finding is real, never writes reply
 *   prose, and never resolves a rebase conflict — it lists, rebases, squashes,
 *   pushes, polls, and collapses, and reports what needs a human or an AI
 *   pass.
 *   Usage (all subcommands take --repo <owner/name> and --checkout <dir>):
 *   pr-care list                      my open PRs + base/check/bot state
 *   pr-care bots <n>                  bot feedback on one PR, classified
 *   pr-care reply <n> --comment-id <id> --body-file <f>
 *   pr-care collapse <n> --comment-id <id> [--review-node <nid>]
 *   pr-care collapse-duplicates <n>   minimize staging-twin bot comments
 *   pr-care rebase [<n> ...]          base-update via local rebase + lease push
 *   pr-care squash <n>                one signed commit on origin/<base>
 *   pr-care checks [<n> ...]          poll to conclusion, report reds
 *   Force pushes and non-fleet pushes stay behind their guards — this tool
 *   runs in the operator's session where the grants live; it never relays or
 *   invents an authorization.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import {
  collectBotFeedback,
  isSecurityAlertBot,
  isStagingDuplicate,
  listReviewThreads,
  minimizeComment,
  replyToReviewComment,
  resolveReviewThread,
} from './bots.mts'
import { rebaseAndPush, runGit, squashToOne, worktreeFor } from './branch.mts'
import { checksVerdict, parseChecksOutput, pollChecks } from './checks.mts'
import { ghRestJson, runGh } from './gh.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

interface CliArgs {
  readonly checkout: string
  readonly flags: Map<string, string>
  readonly numbers: readonly number[]
  readonly repo: string
  readonly subcommand: string
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const flags = new Map<string, string>()
  const numbers: number[] = []
  let subcommand = ''
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      flags.set(arg.slice(2), argv[i + 1] ?? '')
      i += 1
      continue
    }
    if (/^\d+$/.test(arg)) {
      numbers.push(Number(arg))
      continue
    }
    if (!subcommand) {
      subcommand = arg
    }
  }
  return {
    checkout: flags.get('checkout') ?? process.env['PWD'] ?? '.',
    flags,
    numbers,
    repo: flags.get('repo') ?? '',
    subcommand,
  }
}

interface OpenPr {
  readonly headRefName: string
  readonly number: number
  readonly title: string
}

async function listMyOpenPrs(repo: string): Promise<readonly OpenPr[]> {
  const { stdout, exitCode } = await runGh([
    'pr',
    'list',
    '--repo',
    repo,
    '--state',
    'open',
    '--author',
    '@me',
    '--json',
    'number,title,headRefName',
  ])
  if (exitCode !== 0) {
    return []
  }
  try {
    return JSON.parse(stdout) as OpenPr[]
  } catch {
    return []
  }
}

async function headBranch(repo: string, pr: number): Promise<string> {
  const head = await ghRestJson(`repos/${repo}/pulls/${pr}`, '.head.ref')
  return typeof head === 'string' ? head : ''
}

async function commandList(args: CliArgs): Promise<number> {
  const prs = await listMyOpenPrs(args.repo)
  for (let i = 0, { length } = prs; i < length; i += 1) {
    const pr = prs[i]!
    const state = await ghRestJson(
      `repos/${args.repo}/pulls/${pr.number}`,
      '.mergeable_state',
    )
    const feedback = await collectBotFeedback(args.repo, pr.number)
    logger.info(
      `#${pr.number} [${String(state)}] bots=${feedback.comments.length} ${pr.title}`,
    )
  }
  return 0
}

async function commandBots(args: CliArgs): Promise<number> {
  let exit = 0
  for (let i = 0, { length } = args.numbers; i < length; i += 1) {
    const pr = args.numbers[i]!
    const feedback = await collectBotFeedback(args.repo, pr)
    for (const c of feedback.comments.values()) {
      const logins = feedback.comments.map(x => x.author)
      const tag = isStagingDuplicate(c.author, logins)
        ? 'duplicate'
        : isSecurityAlertBot(c.author)
          ? 'human-decision'
          : 'triage'
      logger.info(
        `#${pr} ${c.surface} ${c.author} [${tag}] id=${c.id} node=${c.nodeId}`,
      )
      if (tag === 'triage') {
        exit = 1
      }
    }
  }
  return exit
}

async function commandReply(args: CliArgs): Promise<number> {
  const pr = args.numbers[0]
  const commentId = Number(args.flags.get('comment-id') ?? '')
  const bodyFile = args.flags.get('body-file') ?? ''
  if (!pr || !commentId || !bodyFile) {
    logger.fail('reply needs <pr>, --comment-id, and --body-file.')
    return 1
  }
  const body = readFileSync(path.resolve(bodyFile), 'utf8').trim()
  const ok = await replyToReviewComment(args.repo, pr, commentId, body)
  logger.info(ok ? 'replied' : 'reply failed')
  return ok ? 0 : 1
}

async function commandCollapse(args: CliArgs): Promise<number> {
  const pr = args.numbers[0]
  const commentId = Number(args.flags.get('comment-id') ?? '')
  if (!pr || !commentId) {
    logger.fail('collapse needs <pr> and --comment-id.')
    return 1
  }
  const prNodeId = await ghRestJson(
    `repos/${args.repo}/pulls/${pr}`,
    '.node_id',
  )
  if (typeof prNodeId !== 'string') {
    logger.fail('could not resolve the PR node id.')
    return 1
  }
  const threads = await listReviewThreads(prNodeId)
  const thread = threads.find(
    t => !t.isResolved && t.firstCommentId === commentId,
  )
  let ok = true
  if (thread) {
    ok = (await resolveReviewThread(thread.threadId)) && ok
  }
  const reviewNode = args.flags.get('review-node')
  if (reviewNode) {
    ok = (await minimizeComment(reviewNode, 'RESOLVED')) && ok
  }
  logger.info(ok ? 'collapsed' : 'collapse incomplete')
  return ok ? 0 : 1
}

async function commandCollapseDuplicates(args: CliArgs): Promise<number> {
  let exit = 0
  for (let i = 0, { length } = args.numbers; i < length; i += 1) {
    const pr = args.numbers[i]!
    const feedback = await collectBotFeedback(args.repo, pr)
    const logins = feedback.comments.map(c => c.author)
    for (const c of feedback.comments.values()) {
      if (!isStagingDuplicate(c.author, logins) || !c.nodeId) {
        continue
      }
      const ok = await minimizeComment(c.nodeId, 'DUPLICATE')
      logger.info(
        `#${pr} ${c.author} id=${c.id}: ${ok ? 'minimized' : 'failed'}`,
      )
      if (!ok) {
        exit = 1
      }
    }
  }
  return exit
}

async function commandRebase(args: CliArgs): Promise<number> {
  const base = args.flags.get('base') ?? 'main'
  await runGit(args.checkout, ['fetch', 'origin', base])
  const targets = args.numbers.length
    ? args.numbers
    : (await listMyOpenPrs(args.repo)).map(pr => pr.number)
  const scratchDir = path.join(args.checkout, '.git', 'pr-care-scratch-wt')
  let exit = 0
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const pr = targets[i]!
    const branch = await headBranch(args.repo, pr)
    if (!branch) {
      logger.fail(`#${pr}: no head branch resolved.`)
      exit = 1
      continue
    }
    const result = await rebaseAndPush({
      base,
      branch,
      checkout: args.checkout,
      scratchDir,
    })
    logger.info(`#${pr} ${branch}: ${result.outcome} — ${result.detail}`)
    if (result.outcome === 'conflict-skipped') {
      exit = 1
    }
  }
  return exit
}

async function commandSquash(args: CliArgs): Promise<number> {
  const pr = args.numbers[0]
  if (!pr) {
    logger.fail('squash needs a PR number.')
    return 1
  }
  const base = args.flags.get('base') ?? 'main'
  const branch = await headBranch(args.repo, pr)
  const title = await ghRestJson(`repos/${args.repo}/pulls/${pr}`, '.title')
  const dir = (await worktreeFor(args.checkout, branch)) ?? args.checkout
  await runGit(dir, ['fetch', 'origin', base])
  const minted = await squashToOne({
    base,
    branch,
    dir,
    message: typeof title === 'string' ? title : branch,
  })
  logger.info(`#${pr} ${branch}: ${minted.detail}`)
  if (!minted.sha) {
    return 1
  }
  logger.info(
    `push it with: git push --force-with-lease=${branch}:<fetched-sha> origin ${branch}`,
  )
  return 0
}

async function commandChecks(args: CliArgs): Promise<number> {
  const targets = args.numbers.length
    ? args.numbers
    : (await listMyOpenPrs(args.repo)).map(pr => pr.number)
  let exit = 0
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const pr = targets[i]!
    const verdict = args.flags.has('wait')
      ? await pollChecks({ pr, repo: args.repo })
      : checksVerdict(
          parseChecksOutput(
            (await runGh(['pr', 'checks', String(pr), '--repo', args.repo]))
              .stdout,
          ),
        )
    const summary = verdict.failing.length
      ? `FAILING: ${verdict.failing.join(', ')}`
      : verdict.settled
        ? 'green'
        : `pending: ${verdict.pending.join(', ')}`
    logger.info(`#${pr}: ${summary}`)
    if (verdict.failing.length > 0) {
      exit = 1
    }
  }
  return exit
}

const SUBCOMMANDS: Readonly<
  Record<string, (args: CliArgs) => Promise<number>>
> = {
  __proto__: null,
  bots: commandBots,
  checks: commandChecks,
  collapse: commandCollapse,
  'collapse-duplicates': commandCollapseDuplicates,
  list: commandList,
  rebase: commandRebase,
  reply: commandReply,
  squash: commandSquash,
} as unknown as Record<string, (args: CliArgs) => Promise<number>>

export async function runPrCare(argv: readonly string[]): Promise<number> {
  const args = parseCliArgs(argv)
  if (!args.repo) {
    logger.fail(
      'What: no --repo. Where: pr-care argv. Saw: missing owner/name. Fix: pass --repo <owner/name>.',
    )
    return 1
  }
  const command = SUBCOMMANDS[args.subcommand]
  if (!command) {
    logger.fail(
      `What: unknown subcommand. Where: pr-care argv. Saw: '${args.subcommand}'. Fix: one of ${Object.keys(SUBCOMMANDS).join(', ')}.`,
    )
    return 1
  }
  return command(args)
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'tends a stack of open PRs: lists, rebases, squashes, polls checks, and collapses bot comments',
  help: `Usage: node scripts/fleet/pr-care/cli.mts <subcommand> --repo <owner/name> [--checkout <dir>]

  list                     my open PRs + base/check/bot state
  bots <n>                 bot feedback on one PR, classified
  reply <n> --comment-id <id> --body-file <f>
  collapse <n> --comment-id <id> [--review-node <nid>]
  collapse-duplicates <n>  minimize staging-twin bot comments
  rebase [<n> ...]         base-update via local rebase + lease push
  squash <n>               one signed commit on origin/<base>
  checks [<n> ...]         poll to conclusion, report reds`,
}

/* c8 ignore start - entrypoint guard; only runs when node executes this file as the process entry, never under the in-process test runner */
if (isMainModule(import.meta.url)) {
  runMain(() => runPrCare(process.argv.slice(2)), SCRIPT_META)
}
/* c8 ignore stop */
