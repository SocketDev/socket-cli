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
 *   Usage: node scripts/fleet/strip-ai-attribution.mts --base <ref> [--dry-run]
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// oxlint-disable-next-line socket/prefer-async-spawn -- sequential git plumbing; each step gates the next on exit status.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
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

function git(
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

function gitOrDie(
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
    logger.fail(`[strip-ai-attribution] ${what} failed: git ${args.join(' ')}`)
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

export async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      base: { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
    strict: false,
  })
  const dryRun = !!values['dry-run']
  if (typeof values['base'] !== 'string' || !values['base']) {
    logger.fail(
      '[strip-ai-attribution] pass --base <ref> — the commit below the ' +
        'span to clean (e.g. the ref the pre-push gate scanned from).',
    )
    process.exitCode = 1
    return
  }

  const dirty = gitOrDie(['status', '--porcelain'], 'status')
  if (dirty) {
    logger.fail(
      '[strip-ai-attribution] the worktree is dirty — land or stash first.',
    )
    process.exitCode = 1
    return
  }

  const base = gitOrDie(['rev-parse', String(values['base'])], 'resolve base')
  const orig = gitOrDie(['rev-parse', 'HEAD'], 'rev-parse HEAD')
  const shas = gitOrDie(['rev-list', '--reverse', `${base}..HEAD`], 'rev-list')
  const list = shas ? shas.split('\n') : []
  if (!list.length) {
    logger.log('[strip-ai-attribution] nothing between base and HEAD — no-op.')
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
          `[strip-ai-attribution] stripping ${sha.slice(0, 12)} would leave an EMPTY commit message.\n` +
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
      `[strip-ai-attribution] dry-run: ${rewrote}/${list.length} commit(s) would be reworded.`,
    )
    return
  }
  if (!rewrote) {
    logger.log(
      `[strip-ai-attribution] ${list.length} commit(s) scanned — none carry attribution. History unchanged.`,
    )
    return
  }

  const treeBefore = gitOrDie(['rev-parse', `${orig}^{tree}`], 'orig tree')
  const treeAfter = gitOrDie(['rev-parse', `${parent}^{tree}`], 'new tree')
  if (treeBefore !== treeAfter) {
    logger.fail(
      `[strip-ai-attribution] final tree differs from HEAD — refusing to move the branch. HEAD unchanged at ${orig.slice(0, 12)}.`,
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
      '[strip-ai-attribution] attribution still present after rewrite — inspect git log manually.',
    )
    process.exitCode = 1
    return
  }
  logger.success(
    `[strip-ai-attribution] reworded ${rewrote}/${list.length} commit(s); tree byte-identical. ` +
      'Push separately (a rewritten branch needs an authorized lease force-push).',
  )
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'rewrites base..HEAD to remove AI-attribution lines from commit messages, tree byte-identical',
  help: `Usage: node scripts/fleet/strip-ai-attribution.mts --base <ref> [flags]

  --base <ref>  the commit below the span to clean (required)
  --dry-run     preview which commits would be reworded`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
