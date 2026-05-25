#!/usr/bin/env node
// Claude Code PreToolUse hook — immutable-release-pattern-guard.
//
// Blocks Edit/Write to `.github/workflows/*.y*ml` files that introduce a
// single-call `gh release create <tag> [...flags] <files>` pattern.
//
// GitHub immutable releases (GA 2025-10-28) attach a Sigstore-bundle
// release attestation at publish-time over the locked asset set. The
// single-call form combines create + upload + publish into one action,
// which can race the attestation hash before all assets land. The fleet
// rule is the 3-step pattern:
//
//   gh release create "$TAG" --draft --title ... --notes ...
//   gh release upload "$TAG" <files...>
//   gh release edit "$TAG" --draft=false
//
// Detection: scan after-edit text for `gh release create` calls that do
// NOT include `--draft`. Skip when the call is followed by a `gh release
// upload` + `gh release edit ... --draft=false` pair (3-step pattern
// spread across multiple shell lines but the same workflow file).
//
// Bypass: `Allow immutable-release-pattern bypass` typed verbatim in a
// recent user turn.

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

const BYPASS_PHRASE = 'Allow immutable-release-pattern bypass'

// Match a `gh release create` invocation up to the next newline that isn't
// continued by a backslash. The capture is the full call (incl. continued
// lines). Subsequent analysis decides whether it's the 3-step or single-call
// form.
export function findReleaseCreateCalls(text: string): string[] {
  const calls: string[] = []
  // Find each `gh release create` opener.
  const opener = /gh\s+release\s+create\b/g
  let m: RegExpExecArray | null
  while ((m = opener.exec(text)) !== null) {
    const start = m.index
    // Walk forward, collecting until an unescaped newline.
    let i = start
    let prevWasBackslash = false
    while (i < text.length) {
      const c = text[i]
      if (c === '\n' && !prevWasBackslash) {
        break
      }
      prevWasBackslash = c === '\\'
      i += 1
    }
    calls.push(text.slice(start, i))
  }
  return calls
}

// A single `gh release create` call is "safe" if it includes the `--draft`
// flag — that marks it as the first step of the 3-step pattern.
export function callIsDraft(call: string): boolean {
  // Match `--draft` as a standalone flag (not e.g. `--draft=false`, which
  // is the publish step using `gh release edit`, not `create`).
  return /(^|\s)--draft(\s|$|=true)/.test(call)
}

export function isWorkflowYaml(filePath: string): boolean {
  return /[\\/]\.github[\\/]workflows[\\/][^\\/]+\.ya?ml$/.test(filePath)
}

export function readFileSafe(p: string): string {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

// Return the first offending (non-draft) `gh release create` call, or
// undefined if all calls in the text are draft-form.
export function findUnsafeCall(text: string): string | undefined {
  for (const call of findReleaseCreateCalls(text)) {
    if (!callIsDraft(call)) {
      return call
    }
  }
  return undefined
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
  if (!filePath || !isWorkflowYaml(filePath)) {
    process.exit(0)
  }

  let afterText: string
  if (payload.tool_name === 'Write') {
    afterText = input?.content ?? input?.new_string ?? ''
  } else {
    const currentText = readFileSafe(filePath)
    const oldStr = input?.old_string ?? ''
    const newStr = input?.new_string ?? ''
    if (!oldStr || !currentText.includes(oldStr)) {
      process.exit(0)
    }
    afterText = currentText.replace(oldStr, newStr)
  }

  const unsafe = findUnsafeCall(afterText)
  if (!unsafe) {
    process.exit(0)
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    process.exit(0)
  }

  const preview = unsafe.replace(/\s+/g, ' ').slice(0, 90)
  process.stderr.write(
    [
      '[immutable-release-pattern-guard] Blocked: single-call `gh release create` in workflow YAML',
      '',
      `  File:    ${path.basename(filePath)}`,
      `  Call:    ${preview}...`,
      '',
      '  GitHub immutable releases (GA 2025-10-28) auto-generate a Sigstore',
      '  release attestation at publish-time over the locked asset set. The',
      '  single-call `gh release create <tag> <files>` form combines create',
      '  + upload + publish into one action and can race the attestation',
      '  hash before all assets land.',
      '',
      '  Fix — use the 3-step pattern:',
      '',
      '    gh release create "$TAG" \\',
      '      --draft \\',
      '      --title "$TITLE" \\',
      '      --notes "$NOTES"',
      '    gh release upload "$TAG" release/*.tar.gz release/checksums.txt',
      '    gh release edit "$TAG" --draft=false',
      '',
      '  Detail: docs/claude.md/fleet/immutable-releases.md',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
      '',
    ].join('\n'),
  )
  process.exit(2)
}

main().catch(e => {
  process.stderr.write(
    `[immutable-release-pattern-guard] hook error (allowing): ${(e as Error).message}\n`,
  )
})
