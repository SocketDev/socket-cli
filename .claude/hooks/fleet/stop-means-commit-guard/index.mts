#!/usr/bin/env node
// Claude Code Stop hook — stop-means-commit-guard.
//
// "stop", "pause", "hold off" mean FINISH THE COMMIT, not freeze wherever the
// turn happens to be. The two readings look alike and are not: one ends with
// the work landed, the other leaves a half-applied change on disk for the next
// session to find.
//
// Fires when BOTH hold at turn-end:
//   1. The most recent HUMAN turn asked to stop or pause.
//   2. This session's own work is uncommitted in the primary checkout.
//
// It BLOCKS, and says what to do: land what the turn produced, then report. A
// pause is a fine thing to ask for; it just does not license a broken tree.
//
// Why a hook rather than a line of prose: the misread already happened. A turn
// paused with a dirty tree and a red lint gate, reported that state, and
// stopped. `dirty-worktree-stop-guard` did not catch it, because an announced
// pause is one of its sanctioned escapes — the very escape this closes. That
// guard asks "is the tree clean?"; this one asks "was a pause read as
// permission to leave it dirty?".
//
// Two escapes:
//   1. A LINKED git worktree — WIP stacking there is sanctioned, the same
//      carve-out `dirty-worktree-stop-guard` makes.
//   2. `Allow stop-means-commit bypass`, for when the tree really should be
//      left as it is.

import path from 'node:path'

import { findGitRoot } from '@socketsecurity/lib-stable/git/repo'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { readSessionTouchedPaths } from '../_shared/foreign-paths.mts'
import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { commitInFlight, isStopRequest } from '../_shared/stop-request.mts'
import {
  bypassPhrasePresent,
  readHumanUserText,
} from '../_shared/transcript.mts'

/**
 * The phrase that leaves the tree exactly as it is.
 */
export const BYPASS_PHRASE = 'Allow stop-means-commit bypass'

/**
 * The repo-relative path a `git status --porcelain` line names.
 *
 * Porcelain v1 writes two status columns, then a space, then the path, and
 * spells a rename `old -> new` where the NEW path is the one on disk.
 *
 * Reads the path as everything past the FIRST whitespace run rather than
 * slicing a fixed width, because lib spawn returns trimmed stdout: a ` M path`
 * line arrives as `M path`, and a width-3 slice then eats the filename's first
 * character. That bug is invisible — the guard simply stops matching.
 *
 * Pure and exported, because this parse is where it silently goes wrong.
 */
export function pathFromPorcelainLine(line: string): string {
  const match = /^\s*\S{1,2}\s+(?<rest>.*)$/.exec(line)
  const rel = normalizePath((match?.groups?.['rest'] ?? '').trim())
  const arrow = rel.indexOf(' -> ')
  return arrow === -1 ? rel : rel.slice(arrow + ' -> '.length)
}

/**
 * Which of `porcelain`'s dirty paths this session authored.
 *
 * Scoped to the session's own touch set so a parallel session's in-flight work
 * in the same checkout is not this turn's to land.
 *
 * Pure and exported so the scoping is tested without a git repo.
 */
export function ownDirtyPaths(
  porcelain: string,
  cwd: string,
  touched: ReadonlySet<string>,
): string[] {
  const dirty: string[] = []
  const lines = porcelain.replace(/\r\n/g, '\n').split('\n').filter(Boolean)
  const absolute: string[] = []
  for (const entry of touched) {
    const normalized = normalizePath(entry)
    if (normalized.startsWith('/')) {
      absolute.push(normalized)
    }
  }
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const rel = pathFromPorcelainLine(lines[i]!)
    if (touched.has(rel) || touched.has(normalizePath(path.join(cwd, rel)))) {
      dirty.push(rel)
      continue
    }
    // The ledger records the path the tool was given; git resolves the repo
    // root through symlinks (`/tmp` -> `/private/tmp` on darwin, any symlinked
    // checkout). Comparing the TAIL matches the same file either way, and a
    // full repo-relative tail is specific enough not to collide.
    const tail = `/${rel}`
    if (absolute.some(entry => entry.endsWith(tail))) {
      dirty.push(rel)
    }
  }
  return dirty
}

/**
 * Whether `gitRoot` is a LINKED worktree rather than the primary checkout,
 * where stacking WIP is sanctioned.
 */
export function isLinkedWorktree(gitRoot: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--absolute-git-dir'], {
    cwd: gitRoot,
    stdioString: true,
  })
  if (result.status !== 0) {
    return false
  }
  return normalizePath(String(result.stdout ?? '')).includes('/.git/worktrees/')
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const transcriptPath = payload?.transcript_path
  // HUMAN turns only: a "pause" relayed by another agent or an injected summary
  // is not the operator asking.
  if (!isStopRequest(readHumanUserText(transcriptPath, 1))) {
    return undefined
  }
  if (bypassPhrasePresent(transcriptPath, BYPASS_PHRASE)) {
    return undefined
  }
  const cwd = payload?.cwd || process.env['CLAUDE_PROJECT_DIR'] || ''
  if (!cwd) {
    return undefined
  }
  const gitRoot = findGitRoot(cwd)
  if (!gitRoot || isLinkedWorktree(gitRoot)) {
    return undefined
  }
  // A commit is already running — a pre-commit gate working through its lint
  // and tests, most often. STOP means stop FORWARD action, and finishing the
  // commit is not forward action; interrupting it only leaves a stale
  // index.lock for the next turn to clear.
  if (commitInFlight(gitRoot)) {
    return undefined
  }
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: gitRoot,
    stdioString: true,
  })
  if (status.status !== 0) {
    return undefined
  }
  const dirty = ownDirtyPaths(
    String(status.stdout ?? ''),
    gitRoot,
    readSessionTouchedPaths(transcriptPath),
  )
  if (!dirty.length) {
    return undefined
  }
  const shown = dirty.slice(0, 8).map(p => `  - ${p}`)
  const more =
    dirty.length > shown.length
      ? [`  …and ${dirty.length - shown.length} more.`]
      : []
  return block(
    [
      '[stop-means-commit-guard] A pause was asked for, and this turn left its own work uncommitted:',
      ...shown,
      ...more,
      '',
      'Stop means FINISH THE COMMIT, not freeze here. Get the gate green, commit',
      'what the turn produced, then report where things stand. Reporting a',
      'half-applied change and stopping leaves the next session to find it.',
      '',
      `To leave the tree exactly as it is, the user types: ${BYPASS_PHRASE}`,
    ].join('\n'),
  )
}

export const hook = defineHook({
  bypass: ['stop-means-commit'],
  bypassMode: 'manual',
  bypassOptional: true,
  check,
  event: 'Stop',
  type: 'guard',
})
void runHook(hook, import.meta.url)
