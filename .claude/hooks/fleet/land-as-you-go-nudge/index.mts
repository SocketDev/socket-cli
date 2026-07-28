#!/usr/bin/env node
// Claude Code PostToolUse hook — land-as-you-go-nudge.
//
// After a successful `git commit` on the default branch, counts the local
// commits not yet on origin. At the threshold it nudges to land the queue —
// push, or the managing-worktrees land flow — BEFORE starting the next chunk.
// This is the commit-time twin of `unpushed-main-nudge`: that one reminds at
// turn end, this one fires in the moment the queue grows, when landing is one
// command and the context is still loaded. An unpushed pile is fragile in a
// parallel-session fleet — squash cadences and repair flows move origin under
// it — and every extra commit widens the eventual conflict surface.
//
// Never blocks. Silent off the default branch, since worktree branches land
// as a unit; silent when origin/<branch> is unknown — a fresh repo or an
// offline run; and silent below the threshold.

import path from 'node:path'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { parseCommands } from '../_shared/shell-command.mts'

const NAME = 'land-as-you-go-nudge'

// Nudge when the unpushed queue reaches this many commits.
const QUEUE_THRESHOLD = 3

/**
 * The directory a `git commit` in `command` targets: the `-C <dir>` value
 * when given, `.` otherwise, or undefined when no commit invocation exists.
 * Matches on parsed argv words, never the raw string, so `commit` inside a
 * message or path never counts. Exported for tests.
 */
export function findCommitDir(command: string): string | undefined {
  const commands = parseCommands(command)
  for (let i = 0, { length } = commands; i < length; i += 1) {
    const parsed = commands[i]!
    if (parsed.binary !== 'git') {
      continue
    }
    const words = parsed.args
    let dir: string | undefined
    for (let w = 0, { length: wlen } = words; w < wlen; w += 1) {
      const word = words[w]!
      if (word === '-C' && w + 1 < wlen) {
        dir = words[w + 1]!
        w += 1
        continue
      }
      if (word === 'commit') {
        return dir ?? '.'
      }
      // Any other subcommand word ends this invocation's scan.
      if (!word.startsWith('-')) {
        break
      }
    }
  }
  return undefined
}

function git(args: string[], cwd: string): string | undefined {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return r.status === 0 ? String(r.stdout).trim() : undefined
}

/**
 * The unpushed-commit count for the checkout at `dir`, or undefined when the
 * checkout is not on its default branch, has no origin counterpart, or is
 * not a git checkout at all. Exported for tests.
 */
export function unpushedQueueDepth(dir: string): number | undefined {
  const branch = git(['branch', '--show-current'], dir)
  if (!branch) {
    return undefined
  }
  const originHead = git(
    ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
    dir,
  )
  const defaultBranch = originHead
    ? originHead.replace(/^origin\//, '')
    : 'main'
  if (branch !== defaultBranch && branch !== 'master') {
    return undefined
  }
  const count = git(['rev-list', '--count', `origin/${branch}..HEAD`], dir)
  if (count === undefined) {
    return undefined
  }
  const n = Number.parseInt(count, 10)
  return Number.isFinite(n) ? n : undefined
}

export const check = (payload: ToolCallPayload): GuardResult => {
  if (payload.tool_name !== 'Bash') {
    return undefined
  }
  const command = payload.tool_input?.command
  if (typeof command !== 'string' || !command.includes('commit')) {
    return undefined
  }
  const commitDir = findCommitDir(command)
  if (commitDir === undefined) {
    return undefined
  }
  // The session cwd rides in the hook payload — hooks never read the
  // process's own cwd, which is unstable across the dispatcher.
  const baseDir = payload.cwd
  if (!baseDir && !path.isAbsolute(commitDir)) {
    return undefined
  }
  const dir = path.isAbsolute(commitDir)
    ? commitDir
    : path.resolve(baseDir!, commitDir)
  const depth = unpushedQueueDepth(dir)
  if (depth === undefined || depth < QUEUE_THRESHOLD) {
    return undefined
  }
  return notify(
    `[${NAME}] ${depth} unpushed commit(s) on the default branch at ${dir}.\n` +
      '  Land as you go: push the queue (or run the managing-worktrees land\n' +
      '  flow) before starting the next chunk — origin moves under an\n' +
      '  unpushed pile, and every extra commit widens the eventual conflict\n' +
      '  surface.',
  )
}

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
