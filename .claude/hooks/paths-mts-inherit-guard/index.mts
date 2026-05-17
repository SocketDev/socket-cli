#!/usr/bin/env node
// Claude Code PreToolUse hook — paths-mts-inherit-guard.
//
// Mantra: 1 path, 1 reference (per-package).
//
// `scripts/paths.mts` is the canonical per-package paths module —
// like `package.json`, every package gets its own. Sub-packages
// inherit from the nearest ancestor's paths.mts via:
//
//   export * from '<rel>/paths.mts'
//
// The hook blocks Edit/Write tool calls that would land a sub-package
// `paths.mts` (or `paths.cts`) whose final content lacks the
// `export *` re-export from an ancestor.
//
// What counts as a "sub-package paths.mts":
//   - File path matches `<something>/scripts/paths.{mts,cts}`
//   - There exists an ancestor `scripts/paths.{mts,cts}` higher in
//     the directory tree (and not the same file).
//
// What counts as proper inheritance:
//   - The final content contains a line matching
//     `^export \* from ['"][^'"]*paths\.m?ts['"]`
//     where the target is a path that resolves to an ancestor's
//     paths.mts. The hook checks the textual `export *` line; it
//     doesn't resolve the target to verify the ancestor exists
//     on disk (the ancestor may also be a fresh Edit in the same
//     diff — we trust the consumer's intent).
//
// Repo-root scripts/paths.mts is exempt — there's no ancestor to
// inherit from. We detect "is repo root" by checking whether any
// parent dir between the file and the filesystem root contains
// another scripts/paths.{mts,cts}.
//
// Bypass: `Allow paths-mts-inherit bypass` typed verbatim by the
// user in a recent conversation turn.
//
// Fails open on every error (exit 0 + log) so a buggy hook can't
// brick the session.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit" | "Write" | "MultiEdit",
//     "tool_input": { "file_path": "...", "new_string"?: "...",
//                     "content"?: "..." },
//     "transcript_path": "/.../session.jsonl" }
//
// Exits:
//   0 — allowed (not a sub-package paths.mts, repo-root paths.mts,
//       inheritance present, or bypass phrase recent).
//   2 — blocked (with stderr explanation + the inheritance pattern
//       the maintainer should paste).
//   0 with stderr log — fail-open on hook bugs.

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors'

import {
  bypassPhrasePresent,
  readStdin,
} from '../_shared/transcript.mts'

type ToolInput = {
  tool_input?: {
    content?: string | undefined
    file_path?: string | undefined
    new_string?: string | undefined
  } | undefined
  tool_name?: string | undefined
  transcript_path?: string | undefined
}

const BYPASS_PHRASE = 'Allow paths-mts-inherit bypass'
const BYPASS_LOOKBACK_USER_TURNS = 8

const PATHS_MTS_RE = /(^|\/)paths\.(?:mts|cts)$/
const EXPORT_STAR_RE =
  /^\s*export\s+\*\s+from\s+['"]([^'"]+\/paths\.m?ts)['"];?\s*$/m

/**
 * Walk up from `filePath` looking for an ancestor `scripts/paths.mts`
 * or `scripts/paths.cts`. Returns the absolute path of the nearest
 * one, or `undefined` if there's no ancestor (i.e. this IS the repo-
 * root paths.mts).
 *
 * Stops at the first ancestor found OR at the filesystem root.
 */
function findAncestorPathsMts(filePath: string): string | undefined {
  const fileDir = path.dirname(path.resolve(filePath))
  // Skip the current file's own dir — we want a STRICT ancestor.
  let cur = path.dirname(fileDir)
  const root = path.parse(cur).root
  while (cur && cur !== root) {
    for (const ext of ['mts', 'cts']) {
      const candidate = path.join(cur, 'scripts', `paths.${ext}`)
      if (existsSync(candidate) && candidate !== path.resolve(filePath)) {
        return candidate
      }
    }
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return undefined
}

async function main(): Promise<number> {
  const raw = await readStdin()
  if (!raw.trim()) return 0

  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    process.stderr.write(
      'paths-mts-inherit-guard: failed to parse stdin payload — fail-open\n',
    )
    return 0
  }

  const tool = payload.tool_name
  if (tool !== 'Edit' && tool !== 'Write' && tool !== 'MultiEdit') {
    return 0
  }

  const filePath = payload.tool_input?.file_path
  if (!filePath) return 0
  if (!PATHS_MTS_RE.test(filePath)) return 0

  // Only enforce on `<...>/scripts/paths.{mts,cts}` (the canonical
  // location). A `paths.mts` outside a `scripts/` dir is some other
  // file with the same name; not our concern.
  if (!/\/scripts\/paths\.(?:mts|cts)$/.test(filePath)) {
    return 0
  }

  // Repo-root paths.mts has no ancestor — exempt.
  const ancestor = findAncestorPathsMts(filePath)
  if (!ancestor) return 0

  // The new content we're about to write. Edit uses `new_string`
  // (a fragment); Write uses `content` (the full file). For Edit,
  // we can't see the surrounding file without reading it, so we
  // approximate: if the fragment itself contains an `export *`,
  // accept; otherwise check the on-disk file. MultiEdit follows
  // the same shape as Edit at the payload level (Claude Code
  // serializes the merged result).
  const fragment =
    payload.tool_input?.content ??
    payload.tool_input?.new_string ??
    ''
  if (EXPORT_STAR_RE.test(fragment)) {
    return 0
  }

  // For Edit-shaped writes, the existing file may already carry the
  // export *. Read it as a best-effort check before blocking — we
  // don't want to false-positive when the Edit is touching some
  // OTHER line and the inheritance is already present.
  if (tool === 'Edit' || tool === 'MultiEdit') {
    try {
      const { readFileSync } = await import('node:fs')
      const existing = readFileSync(filePath, 'utf8')
      if (EXPORT_STAR_RE.test(existing)) {
        return 0
      }
    } catch {
      // File may not exist yet (new file via Edit, unusual but
      // possible). Fall through to the block path.
    }
  }

  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return 0
  }

  const relAncestor = path.relative(path.dirname(filePath), ancestor)
  process.stderr.write(
    [
      `🚨 paths-mts-inherit-guard: blocked Edit/Write to a sub-package`,
      `paths.mts that doesn't inherit from the nearest ancestor.`,
      ``,
      `File:     ${filePath}`,
      `Ancestor: ${ancestor}`,
      ``,
      `Mantra: 1 path, 1 reference.`,
      ``,
      `A sub-package's paths.mts must \`export *\` from the nearest`,
      `ancestor paths.mts so REPO_ROOT, CONFIG_DIR, NODE_MODULES_CACHE_DIR,`,
      `etc. aren't re-derived (and don't drift). Add this as the first`,
      `line of the file:`,
      ``,
      `    export * from '${relAncestor}'`,
      ``,
      `Then add this package's own overrides below.`,
      ``,
      `Bypass: type \`${BYPASS_PHRASE}\` verbatim in a recent message`,
      `if this paths.mts genuinely needs to be self-contained.`,
      ``,
    ].join('\n'),
  )
  return 2
}

main().then(
  code => process.exit(code),
  e => {
    process.stderr.write(
      `paths-mts-inherit-guard: hook bug — fail-open. ${errorMessage(e)}\n`,
    )
    process.exit(0)
  },
)
