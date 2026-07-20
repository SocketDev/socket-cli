#!/usr/bin/env node
// Claude Code PreToolUse hook — synthesized-script-edit-guard.
//
// Root `package.json` `scripts` are SYNTHESIZED by the cascade from
// `CANONICAL_SCRIPT_BODIES` in `scripts/repo/sync-scaffolding/manifest.mts`. A
// hand-edit to one of those `scripts` entries in package.json is reverted by
// the next `chore(wheelhouse): cascade …` — the manifest is the source of
// truth, so the edit is always wrong (e.g. renaming a check and fixing the
// stale script path in package.json silently reverts on the next cascade; the
// fix has to land in the manifest).
//
// This hook BLOCKS (exit 2): editing a synthesized `scripts` key in
// package.json is denied with a pointer to the manifest. Only fires in the
// wheelhouse (the only repo that ships the manifest); in a cascaded fleet repo
// the manifest is absent and the hook is a no-op.
//
// Exit codes:
//   2 — edit touches a synthesized script key (blocked).
//   0 — otherwise, or on any error (fail-open).

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

export function getProjectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

// Extract the script KEYS declared in CANONICAL_SCRIPT_BODIES from the manifest
// source text. The object is `export const CANONICAL_SCRIPT_BODIES: … = { … }`;
// keys are either bare identifiers (`fix:`) or quoted (`'doctor:auth':`). Parsed
// textually (not imported) so the hook stays cheap + dependency-free.
export function synthesizedScriptKeys(manifestText: string): Set<string> {
  const keys = new Set<string>()
  const start = manifestText.indexOf('CANONICAL_SCRIPT_BODIES')
  if (start === -1) {
    return keys
  }
  const braceStart = manifestText.indexOf('{', start)
  if (braceStart === -1) {
    return keys
  }
  // Walk to the matching close brace so we don't read keys from later objects.
  let depth = 0
  let end = braceStart
  for (let i = braceStart; i < manifestText.length; i += 1) {
    const ch = manifestText[i]
    if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = manifestText.slice(braceStart + 1, end)
  // Match `key:` and `'key:sub':` at the start of a (possibly indented) line.
  const re =
    /^[ \t]*(?:'(?<sq>[^']+)'|"(?<dq>[^"]+)"|(?<bare>[A-Za-z_][\w-]*))\s*:/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const key = m.groups?.sq ?? m.groups?.dq ?? m.groups?.bare
    /* c8 ignore next - regex alternation guarantees one named group is always set */
    if (key) {
      keys.add(key)
    }
  }
  return keys
}

// Which synthesized keys does this edit content appear to touch? We look for a
// JSON `"key":` occurrence in the new content. Conservative: a hit means the
// edit references a synthesized script key by name.
export function touchedSynthesizedKeys(
  content: string,
  synthesized: ReadonlySet<string>,
): string[] {
  const hit: string[] = []
  for (const key of synthesized) {
    // JSON property form: "key": (the key may contain a colon, e.g. doctor:auth)
    const re = new RegExp(
      `"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`,
    )
    if (re.test(content)) {
      hit.push(key)
    }
  }
  return hit
}

export const check = editGuard((filePath, content) => {
  if (path.basename(filePath) !== 'package.json') {
    return undefined
  }
  if (content === undefined) {
    return undefined
  }
  const repoDir = getProjectDir()
  const manifest = path.join(
    repoDir,
    'scripts/repo/sync-scaffolding/manifest.mts',
  )
  // Wheelhouse-only: no manifest downstream → nothing is synthesized here.
  if (!existsSync(manifest)) {
    return undefined
  }
  let manifestText: string
  try {
    manifestText = readFileSync(manifest, 'utf8')
  } catch {
    return undefined
  }
  const synthesized = synthesizedScriptKeys(manifestText)
  if (synthesized.size === 0) {
    return undefined
  }
  const touched = touchedSynthesizedKeys(content, synthesized)
  if (touched.length === 0) {
    return undefined
  }
  return block(
    [
      `[synthesized-script-edit-guard] Blocked: this package.json edit touches a cascade-synthesized script:`,
      '',
      ...touched.slice(0, 8).map(k => `  • "${k}"`),
      '',
      '  Root package.json `scripts` are generated from CANONICAL_SCRIPT_BODIES',
      '  in scripts/repo/sync-scaffolding/manifest.mts. A hand-edit here is',
      '  reverted by the next cascade. Edit the manifest, then run:',
      '',
      '    node scripts/repo/sync-scaffolding/cli.mts --target . --fix',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['synthesized-script-edit'],
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
