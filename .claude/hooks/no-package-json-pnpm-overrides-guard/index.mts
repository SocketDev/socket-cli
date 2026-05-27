#!/usr/bin/env node
// Claude Code PreToolUse hook — no-package-json-pnpm-overrides-guard.
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

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_name?: string | undefined
  readonly tool_input?:
    | {
        readonly file_path?: string | undefined
        readonly new_string?: string | undefined
        readonly old_string?: string | undefined
        readonly content?: string | undefined
      }
    | undefined
  readonly transcript_path?: string | undefined
}

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

async function main(): Promise<void> {
  let raw: string
  try {
    raw = await readStdin()
  } catch {
    process.exit(0)
  }
  if (!raw) {
    process.exit(0)
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    process.exit(0)
  }

  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
    process.exit(0)
  }
  const input = payload.tool_input
  const filePath = input?.file_path
  if (!filePath || path.basename(filePath) !== 'package.json') {
    process.exit(0)
  }

  const currentText = readFileSafe(filePath)
  let afterText: string
  if (payload.tool_name === 'Write') {
    afterText = input?.content ?? input?.new_string ?? ''
  } else {
    const oldStr = input?.old_string ?? ''
    const newStr = input?.new_string ?? ''
    if (!oldStr) {
      process.exit(0)
    }
    if (!currentText.includes(oldStr)) {
      process.exit(0)
    }
    afterText = currentText.replace(oldStr, newStr)
  }

  let beforeKeys: Set<string>
  let afterKeys: Set<string>
  try {
    beforeKeys = extractOverrideKeys(currentText)
    afterKeys = extractOverrideKeys(afterText)
  } catch (e) {
    process.stderr.write(
      `[no-package-json-pnpm-overrides-guard] parse error (allowing): ${e}\n`,
    )
    process.exit(0)
  }

  const added: string[] = []
  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) {
      added.push(key)
    }
  }
  if (added.length === 0) {
    process.exit(0)
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    process.exit(0)
  }

  added.sort()
  process.stderr.write(
    [
      '[no-package-json-pnpm-overrides-guard] Blocked: package.json pnpm.overrides additions',
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
  process.exit(2)
}

main().catch(e => {
  process.stderr.write(
    `[no-package-json-pnpm-overrides-guard] hook error (allowing): ${(e as Error).message}\n`,
  )
})
