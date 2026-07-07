#!/usr/bin/env node
// Claude Code PreToolUse hook — soak-exclude-date-guard.
//
// Blocks Edit/Write tool calls on `pnpm-workspace.yaml` that introduce
// a per-package `minimumReleaseAgeExclude` entry without the canonical
// `# published: YYYY-MM-DD | removable: YYYY-MM-DD` annotation as the
// LAST comment line above the bullet.
//
// Why: soak-bypass entries are temporary by design — they exist because
// a fresh release was needed faster than the 7-day soak window. Without
// a documented removable-on date, entries pile up and nobody knows when
// they can be removed. The standard format lets a periodic sweep
// (manual or scripted) grep for `removable: <past-date>` to find
// candidates for cleanup.
//
// What's enforced (inside `minimumReleaseAgeExclude:` blocks only):
//   - Each `  - 'NAME@VERSION'` line (exact-pin form) must be preceded by
//     a comment line matching:
//       # published: YYYY-MM-DD | removable: YYYY-MM-DD
//     The annotation must be the IMMEDIATELY-PRECEDING comment line (the
//     last `#` line above the bullet, no intervening blank line).
//
// What's exempt:
//   - Scope-glob entries (`@socketsecurity/*`, `@socketregistry/*`, etc.) —
//     persistent fleet policy, not a time-bound bypass.
//   - Bare-name entries without `@version` (also persistent).
//   - Lines marked `# socket-lint: allow soak-exclude-no-date-annotation`.
//
// Bypass: `Allow soak-exclude-no-date-annotation bypass` (typed verbatim
// by the user) for one-off legitimate cases.
//
// The hook fails OPEN on its own bugs (allow + stderr log) so a bad
// hook deploy can't brick the session.

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const ALLOW_MARKER = '# socket-lint: allow soak-exclude-no-date-annotation'
const BYPASS_PHRASE = 'Allow soak-exclude-no-date-annotation bypass'

// Matches the section header for the soak-exclude block.
const SECTION_HEADER = /^minimumReleaseAgeExclude:\s*$/

// Matches a top-level YAML key that ENDS the soak-exclude block.
const ANY_TOP_LEVEL_KEY = /^[A-Za-z_][\w-]*:\s*(?:\S.*)?$/

// Matches a per-package exact-pin entry inside the block:
//   - 'name@1.2.3'
//   - 'name@1.2.3-pre.0'
//   - '@scope/name@1.2.3'
//   - "name@1.2.3" (double-quoted)
//   - name@1.2.3 (unquoted)
// Captures: 1=name, 2=version
const ENTRY_RE =
  /^\s*-\s*['"]?(?<name>(?:@[^@/'"\s]+\/)?[^@'"\s]+)@(?<version>[^'"\s]+)['"]?\s*$/

// Glob entries (scope-wide, exempt).
const GLOB_ENTRY_RE = /^\s*-\s*['"]?[^'"\s]*\*[^'"\s]*['"]?\s*$/

// Bare name entries (no @version, exempt — persistent policy).
const BARE_NAME_ENTRY_RE = /^\s*-\s*['"]?[^@'"\s]+['"]?\s*$/

// The canonical annotation form. The two YYYY-MM-DD slots must be
// present, in this exact order, separated by ` | `.
const ANNOTATION_RE =
  /^\s*#\s+published:\s+(?:\d{4}-\d{2}-\d{2})\s+\|\s+removable:\s+(?:\d{4}-\d{2}-\d{2})\s*$/

interface OrphanReport {
  line: number
  name: string
  version: string
}

/**
 * Walk the proposed file content and find every per-package exact-pin entry
 * inside the soak-exclude block that lacks the canonical `# published: ... |
 * removable: ...` annotation immediately above it.
 */
export function findOrphanEntries(text: string): OrphanReport[] {
  const lines = text.split('\n')
  const orphans: OrphanReport[] = []
  let inBlock = false
  for (let i = 0; i < lines.length; i += 1) {
    /* c8 ignore next - String.prototype.split never yields undefined elements */
    const line = lines[i] ?? ''
    if (SECTION_HEADER.test(line)) {
      inBlock = true
      continue
    }
    if (!inBlock) {
      continue
    }
    // A top-level key (non-indented `foo:`) ends the block.
    if (ANY_TOP_LEVEL_KEY.test(line) && !line.startsWith(' ')) {
      inBlock = false
      continue
    }
    const m = ENTRY_RE.exec(line)
    if (!m) {
      continue
    }
    // Per-line allow marker. ENTRY_RE requires the line ends with optional
    // quote + optional spaces, so a trailing `# socket-lint: allow …` comment
    // prevents ENTRY_RE from matching — the continue here is structurally
    // unreachable in practice (a code path the regex composition forecloses).
    /* c8 ignore start - ENTRY_RE's trailing `['"]?\s*$` prevents a line with the allow marker from matching */
    if (line.includes(ALLOW_MARKER)) {
      continue
    }
    /* c8 ignore stop */
    // Scope-glob / bare-name entries are exempt — checked here so the
    // regex order doesn't matter.
    if (GLOB_ENTRY_RE.test(line) || BARE_NAME_ENTRY_RE.test(line)) {
      continue
    }
    // Walk upward to find the IMMEDIATELY-PRECEDING comment line. Skip
    // intervening blank lines? No — the canonical form requires the
    // annotation to be the LAST comment above the bullet, contiguous.
    /* c8 ignore start - i===0 arm unreachable: an entry requires inBlock=true, which requires seeing the section header at i>=0, so any entry is at i>=1; lines[i-1] is always a string (split never yields undefined) */
    const prev = i > 0 ? (lines[i - 1] ?? '') : ''
    /* c8 ignore stop */
    if (!ANNOTATION_RE.test(prev)) {
      orphans.push({
        line: i + 1,
        /* c8 ignore start - ENTRY_RE named groups are always populated when the regex matches */
        name: m.groups?.name ?? '<unknown>',
        version: m.groups?.version ?? '<unknown>',
        /* c8 ignore stop */
      })
    }
  }
  return orphans
}

export const check = editGuard((filePath, content, payload) => {
  if (!filePath.endsWith('/pnpm-workspace.yaml')) {
    return undefined
  }
  const proposed = content ?? ''
  const orphans = findOrphanEntries(proposed)
  if (orphans.length === 0) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  const today = new Date().toISOString().slice(0, 10)
  const exampleRemovable = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  return block(
    `[soak-exclude-date-guard] refusing edit: ` +
      `${orphans.length} minimumReleaseAgeExclude entr${orphans.length === 1 ? 'y' : 'ies'} ` +
      `lack the canonical date annotation:\n` +
      orphans
        .map(o => `    line ${o.line}: ${o.name}@${o.version}`)
        .join('\n') +
      '\n\n' +
      "Fix: prepend a comment line directly above each `- '<pkg>@<version>'` bullet:\n" +
      '\n' +
      '  # published: <YYYY-MM-DD> | removable: <YYYY-MM-DD>\n' +
      "  - 'pkg@1.2.3'\n" +
      '\n' +
      "`published` is the version's npm publish date (`npm view pkg@1.2.3 time`).\n" +
      '`removable` is `published + 7d` — the natural soak-clear date.\n' +
      `\nExample for an entry added today (${today}):\n` +
      `  # published: ${today} | removable: ${exampleRemovable}\n` +
      "  - 'pkg@1.2.3'\n" +
      '\n' +
      'One-off override: append `# socket-lint: allow soak-exclude-no-date-annotation`\n' +
      'to the bullet line.\n',
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
