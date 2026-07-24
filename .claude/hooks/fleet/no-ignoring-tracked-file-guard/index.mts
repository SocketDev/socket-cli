#!/usr/bin/env node
// Claude Code PreToolUse hook — no-ignoring-tracked-file-guard.
//
// @file BLOCKS a Write / Edit / MultiEdit to a `.gitignore` that ADDS an ignore
//   rule matching a file git ALREADY tracks — the write-time twin of the
//   `ignored-files-are-untracked` check. A tracked-then-ignored file is a bug:
//   the index and `.gitignore` disagree, and a fresh clone re-ignores it (the
//   exact way build output / a vendored tree / a stray gitlink leaked into the
//   cascade). A `!` re-include (which UN-ignores) is always allowed.
//
// Only flags a NEWLY-added rule (a pattern in the about-to-land content that
// the current on-disk `.gitignore` doesn't already carry) — a pre-existing
// tracked-ignored entry is the commit-time check's concern, not this edit's.
// Match is best-effort via `git ls-files -- <pathspec>` (git's default pathspec
// glob, which crosses `/`), not full gitignore semantics; the committed-tree
// check `ignored-files-are-untracked` is the authoritative backstop.
//
// Fix: untrack the file FIRST (`git update-index --force-remove <path>` or
//      `git rm --cached <path>`), THEN add the ignore rule; or, to keep it
//      tracked, drop the rule or add a `!` re-include.
//
// Fleet-only. Fails open on any parse/payload/git error (a guard bug must never
// block work).
//
// Bypass: `Allow ignoring-tracked-file bypass`.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

/**
 * The ignore patterns the about-to-land `content` ADDS versus the current
 * on-disk file: non-blank, non-comment, non-negation (`!` only UN-ignores, so
 * it never creates a tracked-ignored file), and not already present. Works for
 * both a Write (content = whole file) and an Edit (content = the new_string
 * fragment) because it diffs against the current file's pattern set either way.
 * Pure — unit-tests without a repo.
 */
export function addedIgnorePatterns(
  current: string,
  proposed: string,
): string[] {
  const currentSet = new Set<string>()
  const currentLines = current.split('\n')
  for (let i = 0, { length } = currentLines; i < length; i += 1) {
    currentSet.add(currentLines[i]!.trim())
  }
  const out: string[] = []
  const seen = new Set<string>()
  const lines = proposed.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const trimmed = lines[i]!.trim()
    if (
      trimmed === '' ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('!') ||
      currentSet.has(trimmed) ||
      seen.has(trimmed)
    ) {
      continue
    }
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

/**
 * A gitignore pattern -> a git pathspec probe (best-effort): drop a leading
 * anchor `/`, a leading globstar, and a trailing `/`. `git ls-files -- <spec>`
 * then lists the tracked files the pattern would capture — git's default
 * pathspec glob crosses `/`, so `*.wasm` reaches any depth. Empty when the
 * pattern reduces to nothing to probe.
 */
export function patternToPathspec(pattern: string): string {
  let p = pattern
  if (p.startsWith('/')) {
    p = p.slice(1)
  }
  if (p.startsWith('**/')) {
    p = p.slice(3)
  }
  if (p.endsWith('/')) {
    p = p.slice(0, -1)
  }
  return p
}

function trackedFilesMatching(pattern: string, cwd: string): string[] {
  const spec = patternToPathspec(pattern)
  if (spec === '') {
    return []
  }
  try {
    const result = spawnSync('git', ['ls-files', '-z', '--', spec], {
      cwd,
      stdio: 'pipe',
      stdioString: true,
    }) as { status?: number | null | undefined; stdout?: string | undefined }
    if (result.status !== 0) {
      return []
    }
    return String(result.stdout ?? '')
      .split('\0')
      .filter(Boolean)
  } catch {
    return []
  }
}

export const check = editGuard((filePath, content, payload) => {
  if (path.basename(filePath) !== '.gitignore') {
    return undefined
  }
  if (!isFleetTarget(payload)) {
    return undefined
  }
  if (content === undefined) {
    return undefined
  }
  const current = existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
  const added = addedIgnorePatterns(current, content)
  if (added.length === 0) {
    return undefined
  }
  const cwd = path.dirname(filePath)
  const offenders: string[] = []
  for (let i = 0, { length } = added; i < length; i += 1) {
    const pattern = added[i]!
    const files = trackedFilesMatching(pattern, cwd)
    if (files.length > 0) {
      const shown = files.slice(0, 3).join(', ')
      offenders.push(
        `   + ${pattern}  -> ignores ${files.length} tracked file(s): ${shown}${files.length > 3 ? ', …' : ''}`,
      )
    }
  }
  if (offenders.length === 0) {
    return undefined
  }
  return block(
    [
      '🚨 no-ignoring-tracked-file-guard: this `.gitignore` edit would ignore a file git already TRACKS.',
      '',
      ...offenders,
      '',
      'A tracked-then-ignored file is a bug — the index and .gitignore disagree,',
      'and a fresh clone re-ignores it.',
      '',
      'Fix: untrack it FIRST (`git update-index --force-remove <path>` or',
      '     `git rm --cached <path>`), THEN add the ignore rule; or keep it',
      '     tracked (drop the rule, or add a `!` re-include).',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['ignoring-tracked-file'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
