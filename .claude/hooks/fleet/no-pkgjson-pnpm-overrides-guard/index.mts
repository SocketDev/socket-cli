#!/usr/bin/env node
// Claude Code PreToolUse hook — no-pkgjson-pnpm-overrides-guard.
//
// Blocks Edit/Write operations that add (or expand) a `pnpm.overrides`
// block in any `package.json`. The fleet keeps dependency overrides in
// `pnpm-workspace.yaml` `overrides:` as the single source of truth. A
// `pnpm.overrides` block in package.json splits that surface and sits
// outside the workspace file's `trustPolicy: no-downgrade` governance.
//
// Detection model:
//   - Fires only on Edit / Write to files named `package.json`.
//   - Parses before + after JSON. Reports the override keys that are
//     present in the after-state but absent (or fewer) in the before.
//   - New / expanded `pnpm.overrides` → block.
//
// Bypass: `Allow package-json-overrides bypass` typed verbatim in a
// recent user turn.
//
// Fails open on parse errors (better to under-block than to brick edits
// when the file isn't parseable JSON).

import path from 'node:path'

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { resolveEditedText } from '../_shared/payload.mts'

const logger = getDefaultLogger()

// Extract the set of override keys declared under `pnpm.overrides` in a
// package.json text. Returns an empty set when the block is absent, the
// text isn't valid JSON, or `pnpm.overrides` isn't an object. pnpm reads
// overrides from `pnpm.overrides` (package.json) or top-level `overrides`
// (pnpm-workspace.yaml); this guard targets the package.json form only.
export function extractOverrideKeys(jsonText: string): Set<string> {
  const out = new Set<string>()
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return out
  }
  if (!parsed || typeof parsed !== 'object') {
    return out
  }
  const pnpm = (parsed as { pnpm?: unknown | undefined }).pnpm
  if (!pnpm || typeof pnpm !== 'object') {
    return out
  }
  const overrides = (pnpm as { overrides?: unknown | undefined }).overrides
  if (!overrides || typeof overrides !== 'object') {
    return out
  }
  for (const key of Object.keys(overrides as Record<string, unknown>)) {
    out.add(key)
  }
  return out
}

export const check = editGuard((filePath, _content, payload) => {
  if (path.basename(filePath) !== 'package.json') {
    return undefined
  }

  const currentText = safeReadFileSync(filePath) ?? ''
  const afterText = resolveEditedText(payload)
  if (afterText === undefined) {
    return undefined
  }

  let beforeKeys: Set<string>
  let afterKeys: Set<string>
  try {
    beforeKeys = extractOverrideKeys(currentText)
    afterKeys = extractOverrideKeys(afterText)
  } catch (e) {
    /* c8 ignore start - extractOverrideKeys catches its own JSON errors; this branch is structurally unreachable */
    logger.error(
      `[no-pkgjson-pnpm-overrides-guard] parse error (allowing): ${e}`,
    )
    logger.error('')
    return undefined
    /* c8 ignore stop */
  }

  const added: string[] = []
  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) {
      added.push(key)
    }
  }
  if (added.length === 0) {
    return undefined
  }

  added.sort()
  return block(
    [
      '[no-pkgjson-pnpm-overrides-guard] Blocked: package.json pnpm.overrides additions',
      '',
      `  File:        ${filePath}`,
      `  New entries: ${added.map(k => `\`${k}\``).join(', ')}`,
      '',
      '  The fleet keeps dependency overrides in `pnpm-workspace.yaml`',
      '  `overrides:`, the single override surface. A `pnpm.overrides`',
      '  block in package.json splits the source of truth and sits',
      "  outside the workspace file's `trustPolicy: no-downgrade`.",
      '',
      '  Fix: move the override to the top-level `overrides:` map in',
      '  `pnpm-workspace.yaml`, then `pnpm install`.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['package-json-overrides'],
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
