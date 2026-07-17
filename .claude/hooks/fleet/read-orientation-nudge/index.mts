/*
 * @file Claude Code PreToolUse hook — read-orientation-nudge.
 *
 * Context re-read across turns dominates model spend: a whole-file Read
 * accumulates in context and gets re-read on every later turn. When about to
 * read a LARGE source file WITHOUT an offset/limit (i.e. the whole thing), this
 * nudge orients the reader toward the file's symbol skeleton first, then a
 * span-scoped Read.
 *
 * It UTILIZES the on-disk repo-map cache (`.repo-map/<rel>.skel`, warmed by the
 * SessionStart repo-map-refresh hook + the make-repo-map `--write` runs): when a
 * FRESH skeleton already exists it points straight at that file (a ready-made,
 * ~95%-smaller read — zero generation cost). Only when no fresh skeleton exists
 * does it fall back to suggesting `make-repo-map --write` (which also warms the
 * cache for next time).
 *
 * Advisory only — never blocks. Skips:
 *   - non-Read tools
 *   - a scoped read (offset or limit present) — already reading a span
 *   - small files (below the size threshold) — nothing to save
 *   - non-source files (a skeleton is meaningless for prose/JSON/binaries)
 *   - a read of a `.skel` file itself (already the skeleton)
 */

import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

// Below this byte size a skeleton saves little; skip the nudge.
const SIZE_THRESHOLD_BYTES = 6_000

// The repo-map cache dir (repo-root-relative). Keep in lock-step with
// DEFAULT_OUT_DIR in scripts/fleet/make-repo-map.mts.
const REPO_MAP_DIR = '.repo-map'

const SOURCE_EXTS = new Set<string>([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])

function isSourceFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) {
    return false
  }
  return SOURCE_EXTS.has(filePath.slice(dot))
}

function fileSize(filePath: string): number | undefined {
  try {
    return statSync(filePath).size
  } catch {
    return undefined
  }
}

/**
 * If a FRESH repo-map skeleton exists for `filePath`, return its repo-relative
 * path (`.repo-map/<rel>.skel`); otherwise `undefined`. Fresh = the skeleton's
 * mtime is at or after the source's, so a source edited since the last refresh
 * (stale skeleton with shifted line numbers) falls back to the generate-nudge
 * rather than pointing at wrong spans. Repo root comes from CLAUDE_PROJECT_DIR
 * (set by Claude Code for hooks), else cwd.
 */
function freshSkelFor(filePath: string): string | undefined {
  const repoRoot = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
  const relSkel = path.join(
    REPO_MAP_DIR,
    `${path.relative(repoRoot, filePath)}.skel`,
  )
  const skelAbs = path.join(repoRoot, relSkel)
  try {
    const skelStat = statSync(skelAbs)
    const srcStat = statSync(filePath)
    return skelStat.mtimeMs >= srcStat.mtimeMs ? relSkel : undefined
  } catch {
    return undefined
  }
}

export function check(payload: ToolCallPayload): GuardResult {
  if (payload.tool_name !== 'Read') {
    return undefined
  }
  const input = (payload.tool_input ?? {}) as Record<string, unknown>
  const filePath = input['file_path']
  if (typeof filePath !== 'string' || !isSourceFile(filePath)) {
    return undefined
  }
  // A scoped read (offset/limit) is already the behavior we want — don't nudge.
  if (input['offset'] !== undefined || input['limit'] !== undefined) {
    return undefined
  }
  const size = fileSize(filePath)
  if (size === undefined || size < SIZE_THRESHOLD_BYTES) {
    return undefined
  }
  const sizeKb = (size / 1024).toFixed(0)
  // A fresh cached skeleton already exists — point straight at it (no
  // generation, a ~95%-smaller read) instead of nudging a re-generate.
  const relSkel = freshSkelFor(filePath)
  if (relSkel !== undefined) {
    return notify(
      `[read-orientation-nudge] About to read a ${sizeKb}KB source file whole ` +
        `(it sits in context + is re-read every later turn — context re-read ` +
        `dominates spend). A fresh repo-map skeleton already exists:\n` +
        `  Read ${relSkel}\n` +
        `to locate the symbol, then Read only that line span (offset/limit) of ` +
        `${filePath}. Full read is fine if you are about to edit it and need ` +
        `exact surrounding content.\n`,
    )
  }
  return notify(
    `[read-orientation-nudge] About to read a ${sizeKb}KB source file whole. ` +
      `It will sit in context and be re-read every later turn (context re-read ` +
      `dominates spend). Consider orienting first:\n` +
      `  node scripts/fleet/make-repo-map.mts --write ${filePath}\n` +
      `then Read the .repo-map/<file>.skel skeleton and only the span you need ` +
      `(offset/limit). Full read is fine if you are about to edit it and need ` +
      `exact surrounding content.\n`,
  )
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
