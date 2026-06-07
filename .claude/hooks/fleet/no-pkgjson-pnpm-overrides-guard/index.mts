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

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withEditGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow package-json-overrides bypass'

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

export function readFileSafe(p: string): string {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

// withEditGuard handles the stdin drain, tool_name gate, file_path narrow,
// content extraction (new_string / content), and fail-open on any throw.
await withEditGuard((filePath, content, payload) => {
  if (path.basename(filePath) !== 'package.json') {
    return
  }

  const currentText = readFileSafe(filePath)
  let afterText: string
  if (payload.tool_name === 'Write') {
    afterText = content ?? ''
  } else {
    const oldStr = (payload.tool_input?.old_string as string | undefined) ?? ''
    const newStr = content ?? ''
    if (!oldStr) {
      return
    }
    if (!currentText.includes(oldStr)) {
      return
    }
    afterText = currentText.replace(oldStr, newStr)
  }

  let beforeKeys: Set<string>
  let afterKeys: Set<string>
  try {
    beforeKeys = extractOverrideKeys(currentText)
    afterKeys = extractOverrideKeys(afterText)
  } catch (e) {
    logger.error(
      `[no-pkgjson-pnpm-overrides-guard] parse error (allowing): ${e}\n`,
    )
    return
  }

  const added: string[] = []
  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) {
      added.push(key)
    }
  }
  if (added.length === 0) {
    return
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return
  }

  added.sort()
  logger.error(
    [
      '[no-pkgjson-pnpm-overrides-guard] Blocked: package.json pnpm.overrides additions',
      '',
      `  File:        ${filePath}`,
      `  New entries: ${added.map(k => `\`${k}\``).join(', ')}`,
      '',
      '  The fleet keeps dependency overrides in `pnpm-workspace.yaml`',
      '  `overrides:`, the single override surface. A `pnpm.overrides`',
      '  block in package.json splits the source of truth and sits',
      '  outside the workspace file’s `trustPolicy: no-downgrade`.',
      '',
      '  Fix: move the override to the top-level `overrides:` map in',
      '  `pnpm-workspace.yaml`, then `pnpm install`.',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
      '',
    ].join('\n'),
  )
  process.exitCode = 2
})
