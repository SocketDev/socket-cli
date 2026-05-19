#!/usr/bin/env node
// Claude Code PreToolUse hook — soak-exclude-date-annotation-guard.
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
//   - Lines marked `# socket-hook: allow soak-exclude-no-date-annotation`.
//
// Bypass: `Allow soak-exclude-no-date-annotation bypass` (typed verbatim
// by the user) for one-off legitimate cases.
//
// The hook fails OPEN on its own bugs (exit 0 + stderr log) so a bad
// hook deploy can't brick the session.

import process from 'node:process'

const ALLOW_MARKER = '# socket-hook: allow soak-exclude-no-date-annotation'

// Matches the section header for the soak-exclude block.
const SECTION_HEADER = /^minimumReleaseAgeExclude:\s*$/

// Matches a top-level YAML key that ENDS the soak-exclude block.
const ANY_TOP_LEVEL_KEY = /^[A-Za-z_][\w-]*:\s*(\S.*)?$/

// Matches a per-package exact-pin entry inside the block:
//   - 'name@1.2.3'
//   - 'name@1.2.3-pre.0'
//   - '@scope/name@1.2.3'
//   - "name@1.2.3" (double-quoted)
//   - name@1.2.3 (unquoted)
// Captures: 1=name, 2=version
const ENTRY_RE =
  /^\s*-\s*['"]?((?:@[^@/'"\s]+\/)?[^@'"\s]+)@([^'"\s]+)['"]?\s*$/

// Glob entries (scope-wide, exempt).
const GLOB_ENTRY_RE = /^\s*-\s*['"]?[^'"\s]*\*[^'"\s]*['"]?\s*$/

// Bare name entries (no @version, exempt — persistent policy).
const BARE_NAME_ENTRY_RE = /^\s*-\s*['"]?[^@'"\s]+['"]?\s*$/

// The canonical annotation form. The two YYYY-MM-DD slots must be
// present, in this exact order, separated by ` | `.
const ANNOTATION_RE =
  /^\s*#\s+published:\s+(\d{4}-\d{2}-\d{2})\s+\|\s+removable:\s+(\d{4}-\d{2}-\d{2})\s*$/

interface Hook {
  tool_name?: string
  tool_input?: {
    file_path?: string
    new_string?: string
    content?: string
  }
}

interface OrphanReport {
  line: number
  name: string
  version: string
}

/**
 * Walk the proposed file content and find every per-package
 * exact-pin entry inside the soak-exclude block that lacks the canonical
 * `# published: ... | removable: ...` annotation immediately above it.
 */
function findOrphanEntries(text: string): OrphanReport[] {
  const lines = text.split('\n')
  const orphans: OrphanReport[] = []
  let inBlock = false
  for (let i = 0; i < lines.length; i += 1) {
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
    // Per-line allow marker.
    if (line.includes(ALLOW_MARKER)) {
      continue
    }
    // Scope-glob / bare-name entries are exempt — checked here so the
    // regex order doesn't matter.
    if (GLOB_ENTRY_RE.test(line) || BARE_NAME_ENTRY_RE.test(line)) {
      continue
    }
    // Walk upward to find the IMMEDIATELY-PRECEDING comment line. Skip
    // intervening blank lines? No — the canonical form requires the
    // annotation to be the LAST comment above the bullet, contiguous.
    const prev = i > 0 ? (lines[i - 1] ?? '') : ''
    if (!ANNOTATION_RE.test(prev)) {
      orphans.push({
        line: i + 1,
        name: m[1] ?? '<unknown>',
        version: m[2] ?? '<unknown>',
      })
    }
  }
  return orphans
}

function main(): void {
  let stdin = ''
  process.stdin.on('data', (chunk: Buffer) => {
    stdin += chunk.toString()
  })
  process.stdin.on('end', () => {
    try {
      let payload: Hook
      try {
        payload = JSON.parse(stdin) as Hook
      } catch {
        process.exit(0)
      }
      const tool = payload.tool_name
      if (tool !== 'Edit' && tool !== 'Write') {
        process.exit(0)
      }
      const filePath = payload.tool_input?.file_path
      if (!filePath || !filePath.endsWith('/pnpm-workspace.yaml')) {
        process.exit(0)
      }
      const proposed =
        payload.tool_input?.content ?? payload.tool_input?.new_string ?? ''
      const orphans = findOrphanEntries(proposed)
      if (orphans.length === 0) {
        process.exit(0)
      }
      const today = new Date().toISOString().slice(0, 10)
      const exampleRemovable = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
      process.stderr.write(
        `[soak-exclude-date-annotation-guard] refusing edit: ` +
          `${orphans.length} minimumReleaseAgeExclude entr${orphans.length === 1 ? 'y' : 'ies'} ` +
          `lack the canonical date annotation:\n` +
          orphans
            .map(o => `    line ${o.line}: ${o.name}@${o.version}`)
            .join('\n') +
          '\n\n' +
          'Fix: prepend a comment line directly above each `- \'<pkg>@<version>\'` bullet:\n' +
          '\n' +
          '  # published: <YYYY-MM-DD> | removable: <YYYY-MM-DD>\n' +
          "  - 'pkg@1.2.3'\n" +
          '\n' +
          '`published` is the version\'s npm publish date (`npm view pkg@1.2.3 time`).\n' +
          '`removable` is `published + 7d` — the natural soak-clear date.\n' +
          `\nExample for an entry added today (${today}):\n` +
          `  # published: ${today} | removable: ${exampleRemovable}\n` +
          "  - 'pkg@1.2.3'\n" +
          '\n' +
          'One-off override: append `# socket-hook: allow soak-exclude-no-date-annotation`\n' +
          'to the bullet line.\n',
      )
      process.exit(2)
    } catch (e) {
      process.stderr.write(
        `[soak-exclude-date-annotation-guard] hook error (allowing): ${e}\n`,
      )
      process.exit(0)
    }
  })
  if (process.stdin.readable === false) {
    process.exit(0)
  }
}

main()
