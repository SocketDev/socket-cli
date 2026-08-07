#!/usr/bin/env node
// Claude Code PostToolUse hook — uncommitted-sweep-nudge.
//
// Counts the files THIS SESSION has edited since its last commit. Past the
// threshold it nudges to land what is already verifiable and scope the rest.
//
// The exposure is the pile, not the edit. Uncommitted work is what a peer
// agent's reset, a revert, or a rebase takes — and the bigger the pile, the more
// there is to lose. Two losses in one session came from that shape.
//
// It also catches the wide-mechanical-sweep failure mode. A codemod that
// over-matches does it on the first file as readily as the three-hundredth, so a
// pass verified only at the end is one indivisible bet: when the transform is
// subtly wrong, every file unwinds together. Batched, the same mistake is a
// two-file diff read in a minute.
//
// The uncommitted-pile twin of `land-as-you-go-nudge`, which watches the
// UNPUSHED pile. This one fires earlier, while the work is still in hand.
//
// Never blocks: wide work is sometimes right, and a nudge that stops a
// legitimate sweep would be worse than the pile. A cascade is invisible here
// anyway — it writes through Bash, not Edit/Write.

import path from 'node:path'

import { findGitRoot } from '@socketsecurity/lib-stable/git/repo'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { readSessionTouchedPaths } from '../_shared/foreign-paths.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

/**
 * How many session-edited-but-uncommitted files reads as a sweep.
 *
 * Set where a batch stops being reviewable in one sitting. Below it, a wide
 * change is still one diff a reader can hold; above it, the reader is skimming
 * and a transform's mistake rides through unnoticed.
 */
export const SWEEP_THRESHOLD = 12

/**
 * Nudge once per multiple of the threshold rather than on every edit past it.
 *
 * A nudge on edit 13, 14, 15 … is noise the reader learns to skip, which is how
 * a cadence hook stops working. One at 12, the next at 24.
 */
export function shouldNudgeAt(count: number, threshold: number): boolean {
  return count > 0 && threshold > 0 && count % threshold === 0
}

/**
 * The repo-relative path a `git status --porcelain` line names.
 *
 * Two status columns, a space, then the path; a rename reads `old -> new` and
 * the NEW path is the one on disk. Reads past the FIRST whitespace run rather
 * than slicing a fixed width, because lib spawn returns trimmed stdout: a
 * ` M path` line arrives as `M path`, and a width-3 slice eats the filename's
 * first character.
 */
export function pathFromPorcelainLine(line: string): string {
  const match = /^\s*\S{1,2}\s+(?<rest>.*)$/.exec(line)
  const rel = normalizePath((match?.groups?.['rest'] ?? '').trim())
  const arrow = rel.indexOf(' -> ')
  return arrow === -1 ? rel : rel.slice(arrow + ' -> '.length)
}

/**
 * How many of `porcelain`'s dirty paths this session authored.
 *
 * Scoped to the session's own touch set, so a peer agent's in-flight work in
 * the same checkout is not counted against this turn. Matches an absolute
 * ledger entry by its repo-relative TAIL as well, because git resolves the root
 * through symlinks (`/tmp` -> `/private/tmp` on darwin) while the ledger
 * records the path the tool was handed.
 *
 * Pure and exported: the counting is the judgment, so it is tested directly.
 */
export function countOwnDirty(
  porcelain: string,
  cwd: string,
  touched: ReadonlySet<string>,
): number {
  const absolute: string[] = []
  for (const entry of touched) {
    const normalized = normalizePath(entry)
    if (normalized.startsWith('/')) {
      absolute.push(normalized)
    }
  }
  let count = 0
  const lines = porcelain.replace(/\r\n/g, '\n').split('\n').filter(Boolean)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const rel = pathFromPorcelainLine(lines[i]!)
    if (touched.has(rel) || touched.has(normalizePath(path.join(cwd, rel)))) {
      count += 1
      continue
    }
    const tail = `/${rel}`
    if (absolute.some(entry => entry.endsWith(tail))) {
      count += 1
    }
  }
  return count
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const cwd = payload?.cwd || process.env['CLAUDE_PROJECT_DIR'] || ''
  if (!cwd) {
    return undefined
  }
  const gitRoot = findGitRoot(cwd)
  if (!gitRoot) {
    return undefined
  }
  // `-uall` because the default collapses a wholly-untracked directory to one
  // `?? dir/` line. A sweep that CREATES twelve files in a new directory would
  // otherwise count as one and never reach the threshold.
  const status = spawnSync('git', ['status', '--porcelain', '-uall'], {
    cwd: gitRoot,
    stdioString: true,
  })
  if (status.status !== 0) {
    return undefined
  }
  const count = countOwnDirty(
    String(status.stdout ?? ''),
    gitRoot,
    readSessionTouchedPaths(payload?.transcript_path),
  )
  if (!shouldNudgeAt(count, SWEEP_THRESHOLD)) {
    return undefined
  }
  return notify(
    [
      `[uncommitted-sweep-nudge] ${count} files edited this session are uncommitted.`,
      '',
      'Land what is already verifiable, then scope the rest. A chunk is landable',
      'when it has its own verification and leaves the gate green without the',
      'chunks after it.',
      '',
      "For a mechanical sweep: read the FIRST batch's diff before widening. A",
      'transform that over-matches does it on file 1 as readily as file 300, and',
      'a pass verified only at the end unwinds all at once.',
    ].join('\n'),
  )
}

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
