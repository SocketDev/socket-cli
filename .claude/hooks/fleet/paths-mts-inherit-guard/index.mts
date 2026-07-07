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
// Repo-root scripts/fleet/paths.mts is exempt — there's no ancestor to
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

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow paths-mts-inherit bypass'
const BYPASS_LOOKBACK_USER_TURNS = 8

// Match any path that ends with `/paths.mts` or `/paths.cts`, whether at the
// start of the string or after a directory separator.
const PATHS_MTS_RE = /(?:^|\/)paths\.(?:cts|mts)$/
const EXPORT_STAR_RE =
  /^\s*export\s+\*\s+from\s+['"](?:[^'"]+\/paths\.m?ts)['"];?\s*$/m

// Ancestor paths.mts can live at `scripts/paths.{mts,cts}` (per-package
// convention) OR `scripts/fleet/paths.{mts,cts}` (the repo-root canonical
// module after the scripts/{fleet,repo} segmentation moved it under fleet/).
// Probe both, in directory-depth order, so the walk finds the nearest ancestor
// whether or not a given repo has been segmented yet.
const ANCESTOR_REL_CANDIDATES: readonly string[] = [
  'scripts/paths.mts',
  'scripts/paths.cts',
  'scripts/fleet/paths.mts',
  'scripts/fleet/paths.cts',
]

/**
 * Walk up from `filePath` looking for an ancestor paths module —
 * `scripts/paths.{mts,cts}` or `scripts/fleet/paths.{mts,cts}` (the post-
 * segmentation repo-root location). Returns the absolute path of the nearest
 * one, or `undefined` if there's no ancestor (i.e. this IS the repo-root
 * paths.mts).
 *
 * Stops at the first ancestor found OR at the filesystem root.
 */
export function findAncestorPathsMts(filePath: string): string | undefined {
  const resolvedSelf = path.resolve(filePath)
  const fileDir = path.dirname(resolvedSelf)
  // Skip the current file's own dir — we want a STRICT ancestor.
  let cur = path.dirname(fileDir)
  const root = path.parse(cur).root
  while (cur && cur !== root) {
    for (let i = 0, { length } = ANCESTOR_REL_CANDIDATES; i < length; i += 1) {
      const candidate = path.join(cur, ANCESTOR_REL_CANDIDATES[i]!)
      if (existsSync(candidate) && candidate !== resolvedSelf) {
        return candidate
      }
    }
    const parent = path.dirname(cur)
    /* c8 ignore start - unreachable on POSIX: while condition already excludes root */
    if (parent === cur) {
      break
    }
    /* c8 ignore stop */
    cur = parent
  }
  return undefined
}

export const hook = defineHook({
  check: editGuard((filePath, content, payload) => {
    const tool = payload.tool_name
    if (!PATHS_MTS_RE.test(filePath)) {
      return undefined
    }

    // Only enforce on `<...>/scripts/paths.{mts,cts}` (the canonical
    // location). A `paths.mts` outside a `scripts/` dir is some other
    // file with the same name; not our concern.
    if (!/\/scripts\/paths\.(?:cts|mts)$/.test(filePath)) {
      return undefined
    }

    // Repo-root paths.mts has no ancestor — exempt.
    const ancestor = findAncestorPathsMts(filePath)
    if (!ancestor) {
      return undefined
    }

    // The new content we're about to write. Edit uses `new_string`
    // (a fragment); Write uses `content` (the full file). For Edit,
    // we can't see the surrounding file without reading it, so we
    // approximate: if the fragment itself contains an `export *`,
    // accept; otherwise check the on-disk file. MultiEdit follows
    // the same shape as Edit at the payload level (Claude Code
    // serializes the merged result).
    const fragment = content ?? ''
    if (EXPORT_STAR_RE.test(fragment)) {
      return undefined
    }

    // For Edit-shaped writes, the existing file may already carry the
    // export *. Read it as a best-effort check before blocking — we
    // don't want to false-positive when the Edit is touching some
    // OTHER line and the inheritance is already present.
    if (tool === 'Edit' || tool === 'MultiEdit') {
      try {
        const existing = readFileSync(filePath, 'utf8')
        if (EXPORT_STAR_RE.test(existing)) {
          return undefined
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
      return undefined
    }

    const relAncestor = path.relative(path.dirname(filePath), ancestor)
    return block(
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
  }),
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
