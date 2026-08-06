/*
 * @file Deterministically remove AI-attribution lines from commit messages in
 *   a range — the script the fleet reaches for when the pre-push gate reports
 *   "AI attribution found in commit messages". Never hand-dance a
 *   `git rebase -i` with scripted GIT_SEQUENCE_EDITOR/GIT_EDITOR editors:
 *   that path is quoting-fragile, silently no-ops when the todo regex misses,
 *   and leaves no verification, all three happened live before this existed.
 *
 *   Flow: verify clean worktree → walk `base..HEAD` oldest-first with
 *   plumbing (`commit-tree`, preserving tree, author identity, and author
 *   date) → rewrite only messages that carry attribution → repoint HEAD →
 *   verify the final tree is BYTE-IDENTICAL and every rewritten message is
 *   clean. Commits are re-minted through the normal signing config, so a
 *   signed branch stays signed. Nothing is pushed.
 *
 *   Usage: node scripts/fleet/strip-ai-tags.mts --base <ref> [--dry-run]
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// oxlint-disable-next-line socket/prefer-async-spawn -- sequential git plumbing; each step gates the next on exit status.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  AI_ATTRIBUTION_RE,
  hasAiAttribution,
  stripAiAttribution,
} from '../../.claude/hooks/fleet/_shared/ai-attribution.mts'
import { REPO_ROOT } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()

interface GitRunResult {
  status: number
  stdout: string
}

export function git(
  args: readonly string[],
  options?:
    | {
        env?: Record<string, string> | undefined
        input?: string | undefined
      }
    | undefined,
): GitRunResult {
  const opts = { __proto__: null, ...options } as {
    env?: Record<string, string> | undefined
    input?: string | undefined
  }
  const r = spawnSync('git', [...args], {
    cwd: REPO_ROOT,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    input: opts.input,
    stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    stdioString: true,
  })
  return { status: r.status ?? 1, stdout: String(r.stdout ?? '').trim() }
}

export function gitOrDie(
  args: readonly string[],
  what: string,
  options?:
    | {
        env?: Record<string, string> | undefined
        input?: string | undefined
      }
    | undefined,
): string {
  const r = git(args, options)
  if (r.status !== 0) {
    logger.fail(`[strip-ai-tags] ${what} failed: git ${args.join(' ')}`)
    process.exitCode = 1
    throw new Error(what)
  }
  return r.stdout
}

// The rewritten body for one commit: strip attribution when present, otherwise
// leave the message intact with a single trailing newline (so `commit-tree`
// receives a normalized body either way). Pure — the message transform the
// rewrite loop applies per commit.
export function rewriteMessage(message: string): string {
  return hasAiAttribution(message)
    ? stripAiAttribution(message).cleaned
    : `${message}\n`
}

/**
 * A message's subject: its first non-blank line, or '' when it has none.
 *
 * The strip is line-oriented, and the attribution catalog it reads is the
 * WHOLE-TEXT one, which matches a bare robot emoji anywhere on a line. A
 * subject that legitimately contains that token — a commit naming a CI job
 * `🤖 Build AI Models WASM` — is therefore removed like a trailer, and a
 * one-line message strips down to nothing at all. Neither of the rewriter's
 * two verifications notices: the tree is untouched by a message edit, and an
 * empty message trivially carries no attribution.
 */
export function messageSubject(message: string): string {
  const lines = message.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (line !== '') {
      return line
    }
  }
  return ''
}

/**
 * Read all of stdin as UTF-8. The pipe lane's input: `… | strip-ai-tags
 * --stdin` keeps a Linear description or a Slack draft out of argv, where a
 * long body would hit the shell's argument limit and where anything passed
 * lands in shell history.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * A `--pr` / `--issue` value as `{ kind, ownerRepo, number }`, or undefined
 * when neither flag was passed. Accepts `owner/repo#123`, which is the
 * spelling GitHub itself renders, so a value can be pasted straight from a
 * browser tab.
 */
export function ghTargetFrom(values: {
  issue?: unknown | undefined
  pr?: unknown | undefined
}): { kind: 'issue' | 'pr'; number: string; ownerRepo: string } | undefined {
  const kind = typeof values.pr === 'string' ? 'pr' : 'issue'
  const raw = typeof values.pr === 'string' ? values.pr : values.issue
  if (typeof raw !== 'string' || !raw) {
    return undefined
  }
  // owner/repo#number: a slash-joined pair with no whitespace, then '#', then
  // the digits GitHub numbers the PR or issue with.
  const match = /^([^/\s]+\/[^#\s]+)#(\d+)$/.exec(raw.trim())
  return match ? { kind, number: match[2]!, ownerRepo: match[1]! } : undefined
}

/**
 * Drop every line the shared matcher flags, plus a `-----` rule left
 * orphaned directly beneath a stripped opener. Pure — the rewrite
 * `stripGitHubBody` applies, exported for tests.
 */
export function stripTagLines(body: string): string {
  const kept: string[] = []
  const lines = body.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (AI_ATTRIBUTION_RE.test(line)) {
      // The opener shape is "<tag>\n-----", and a horizontal rule with
      // nothing above it reads as a stray artifact.
      if (/^-{3,}\s*$/.test(lines[i + 1] ?? '')) {
        i += 1
      }
      continue
    }
    kept.push(line)
  }
  return kept.join('\n').replace(/^\n+/, '')
}

/**
 * Read a PR or issue body, drop its tag lines, and write it back. Reports and
 * changes nothing when the body is already clean, so a re-run is a no-op.
 */
async function stripGitHubBody(
  target: { kind: 'issue' | 'pr'; number: string; ownerRepo: string },
  config: { dryRun: boolean },
): Promise<number> {
  const cfg = { __proto__: null, ...config } as { dryRun: boolean }
  const { dryRun } = cfg
  const noun = target.kind === 'pr' ? 'pr' : 'issue'
  const read = spawnSync(
    'gh',
    [
      noun,
      'view',
      target.number,
      '--repo',
      target.ownerRepo,
      '--json',
      'body',
      '--jq',
      '.body',
    ],
    { encoding: 'utf8' },
  )
  if (read.status !== 0) {
    logger.fail(
      `[strip-ai-tags] could not read ${target.ownerRepo}#${target.number}.\n` +
        `  Where: gh ${noun} view.\n` +
        `  Saw vs. wanted: exit ${read.status}; wanted the body.\n` +
        '  Fix: check the reference and that gh is authenticated for that repo.',
    )
    return 1
  }
  const body = String(read.stdout ?? '')
  const cleaned = stripTagLines(body)
  if (cleaned === body) {
    logger.success(
      `[strip-ai-tags] ${target.ownerRepo}#${target.number} carries no AI tags.`,
    )
    return 0
  }
  if (dryRun) {
    logger.log(
      `[strip-ai-tags] would strip ${body.split('\n').length - cleaned.split('\n').length} line(s) from ${target.ownerRepo}#${target.number}.`,
    )
    return 0
  }
  const write = spawnSync(
    'gh',
    [
      noun,
      'edit',
      target.number,
      '--repo',
      target.ownerRepo,
      '--body',
      cleaned,
    ],
    { encoding: 'utf8' },
  )
  if (write.status !== 0) {
    logger.fail(
      `[strip-ai-tags] could not update ${target.ownerRepo}#${target.number}.\n` +
        `  Where: gh ${noun} edit.\n` +
        `  Saw vs. wanted: exit ${write.status}; wanted the body written.\n` +
        '  Fix: confirm write access, then re-run.',
    )
    return 1
  }
  logger.success(
    `[strip-ai-tags] stripped the AI tags from ${target.ownerRepo}#${target.number}.`,
  )
  return 0
}

export async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      base: { type: 'string' },
      'dry-run': { type: 'boolean' },
      issue: { type: 'string' },
      pr: { type: 'string' },
      stdin: { type: 'boolean' },
      text: { type: 'string' },
    },
    strict: false,
  })
  const dryRun = !!values['dry-run']
  // The text lanes come first and are pure: they read a string, print the
  // cleaned string, and touch nothing. That is what makes this usable for the
  // surfaces no API here writes to — a Linear description, a Slack message —
  // where the operator pastes in, gets clean text back, and pastes it on.
  if (typeof values['text'] === 'string') {
    process.stdout.write(`${stripTagLines(values['text'])}\n`)
    return
  }
  if (values['stdin']) {
    process.stdout.write(`${stripTagLines(await readStdin())}\n`)
    return
  }
  // A GitHub body is the other place these tags land, and it stays public
  // until someone edits it. Same matcher, different surface: no history is
  // rewritten here, so it runs before the commit path and returns.
  const target = ghTargetFrom(values)
  if (target) {
    process.exitCode = await stripGitHubBody(target, { dryRun })
    return
  }
  if (typeof values['base'] !== 'string' || !values['base']) {
    logger.fail(
      '[strip-ai-tags] pass --base <ref>, --pr <owner/repo#n>, or --issue <owner/repo#n> — the commit below the ' +
        'span to clean (e.g. the ref the pre-push gate scanned from).',
    )
    process.exitCode = 1
    return
  }

  const dirty = gitOrDie(['status', '--porcelain'], 'status')
  if (dirty) {
    logger.fail('[strip-ai-tags] the worktree is dirty — land or stash first.')
    process.exitCode = 1
    return
  }

  const base = gitOrDie(['rev-parse', String(values['base'])], 'resolve base')
  const orig = gitOrDie(['rev-parse', 'HEAD'], 'rev-parse HEAD')
  const shas = gitOrDie(['rev-list', '--reverse', `${base}..HEAD`], 'rev-list')
  const list = shas ? shas.split('\n') : []
  if (!list.length) {
    logger.log('[strip-ai-tags] nothing between base and HEAD — no-op.')
    return
  }

  let parent = base
  let rewrote = 0
  for (let i = 0, { length } = list; i < length; i += 1) {
    const sha = list[i]!
    const message = gitOrDie(['log', '-1', '--format=%B', sha], 'read message')
    const flagged = hasAiAttribution(message)
    const rewritten = rewriteMessage(message)
    if (flagged) {
      // Refuse rather than mint a subject-less commit. Checked before the
      // dry-run bail so the preview surfaces it too, and before `update-ref`
      // so HEAD never moves: the loop may have written commit objects by now,
      // but nothing references them and git will garbage-collect them.
      if (messageSubject(rewritten) === '') {
        logger.fail(
          `[strip-ai-tags] stripping ${sha.slice(0, 12)} would leave an EMPTY commit message.\n` +
            `  Where: ${sha.slice(0, 12)}, whose subject is itself the attribution match: ${JSON.stringify(message.split('\n')[0] ?? '')}\n` +
            '  Saw: every line removed. Wanted: a rewritten commit always keeps a subject.\n' +
            '  Fix: reword this one by hand so its subject says what the change does without the attribution token, then re-run.',
        )
        process.exitCode = 1
        return
      }
      rewrote += 1
      logger.substep(
        `reword ${sha.slice(0, 12)} ${message.split('\n')[0] ?? ''}`,
      )
    }
    if (dryRun) {
      continue
    }
    const tree = gitOrDie(['rev-parse', `${sha}^{tree}`], 'read tree')
    const authorName = gitOrDie(['log', '-1', '--format=%an', sha], 'author')
    const authorEmail = gitOrDie(['log', '-1', '--format=%ae', sha], 'email')
    const authorDate = gitOrDie(['log', '-1', '--format=%ad', sha], 'date')
    parent = gitOrDie(
      ['commit-tree', tree, '-p', parent, '-S', '-F', '-'],
      `commit-tree ${sha.slice(0, 12)}`,
      {
        env: {
          GIT_AUTHOR_DATE: authorDate,
          GIT_AUTHOR_EMAIL: authorEmail,
          GIT_AUTHOR_NAME: authorName,
        },
        input: rewritten,
      },
    )
  }

  if (dryRun) {
    logger.log(
      `[strip-ai-tags] dry-run: ${rewrote}/${list.length} commit(s) would be reworded.`,
    )
    return
  }
  if (!rewrote) {
    logger.log(
      `[strip-ai-tags] ${list.length} commit(s) scanned — none carry attribution. History unchanged.`,
    )
    return
  }

  const treeBefore = gitOrDie(['rev-parse', `${orig}^{tree}`], 'orig tree')
  const treeAfter = gitOrDie(['rev-parse', `${parent}^{tree}`], 'new tree')
  if (treeBefore !== treeAfter) {
    logger.fail(
      `[strip-ai-tags] final tree differs from HEAD — refusing to move the branch. HEAD unchanged at ${orig.slice(0, 12)}.`,
    )
    process.exitCode = 1
    return
  }
  gitOrDie(
    ['update-ref', '-m', 'strip-ai-attribution', 'HEAD', parent, orig],
    'update-ref',
  )
  const residue = git(['log', `${base}..HEAD`, '--format=%B'])
  if (residue.status === 0 && hasAiAttribution(residue.stdout)) {
    logger.fail(
      '[strip-ai-tags] attribution still present after rewrite — inspect git log manually.',
    )
    process.exitCode = 1
    return
  }
  logger.success(
    `[strip-ai-tags] reworded ${rewrote}/${list.length} commit(s); tree byte-identical. ` +
      'Push separately (a rewritten branch needs an authorized lease force-push).',
  )
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'strips AI tags from commit messages and from a GitHub PR or issue body',
  help: `Usage: node scripts/fleet/strip-ai-tags.mts [flags]

  Commits (rewrites history locally, never pushes):
  --base <ref>       the commit below the span to clean

  GitHub prose (edits in place):
  --pr <owner/repo#n>     strip the body of a pull request
  --issue <owner/repo#n>  strip the body of an issue

  Any other surface (prints the cleaned text, changes nothing):
  --stdin            read the text to clean from stdin
  --text <string>    clean this string

  --dry-run          preview what would change, mutate nothing

  A tag is any line the fleet's shared matcher flags: an attribution verb
  ("Generated with …", "written by <model>"), an AI trailer key, or an agent
  signature. For a Linear description or a Slack message, pipe the text
  through --stdin and paste the result back: those APIs are not driven from
  here, and a body long enough to matter does not belong in argv.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
