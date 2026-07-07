#!/usr/bin/env node
// Claude Code PreToolUse hook — immutable-release-guard.
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

import path from 'node:path'

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { resolveEditedText } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

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
  return /(?:^|\s)--draft(?:\s|$|=true)/.test(call)
}

export function isWorkflowYaml(filePath: string): boolean {
  return /[\\/]\.github[\\/]workflows[\\/][^\\/]+\.ya?ml$/.test(filePath)
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

export const check = editGuard((filePath, _content, payload) => {
  if (!isWorkflowYaml(filePath)) {
    return undefined
  }

  const afterText = resolveEditedText(payload)
  if (afterText === undefined) {
    return undefined
  }

  const unsafe = findUnsafeCall(afterText)
  if (!unsafe) {
    return undefined
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return undefined
  }

  const preview = unsafe.replace(/\s+/g, ' ').slice(0, 90)
  return block(
    [
      '[immutable-release-guard] Blocked: single-call `gh release create` in workflow YAML',
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
      '  Detail: docs/agents.md/fleet/immutable-releases.md',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
