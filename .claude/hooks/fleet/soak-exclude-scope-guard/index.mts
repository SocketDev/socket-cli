#!/usr/bin/env node
// Claude Code PreToolUse hook — soak-exclude-scope-guard.
//
// Blocks Edit/Write to `pnpm-workspace.yaml` that add a non-Socket-
// scoped entry to `minimumReleaseAgeExclude:`. The soak gate is
// malware protection; bypassing it for third-party packages
// weakens the policy without justification. Such a dep should wait
// out the soak — `overrides:` pins a version but does NOT bypass
// minimumReleaseAge.
//
// Sibling guard: `soak-exclude-date-guard` enforces
// `# published: ... | removable: ...` annotations on entries. This
// guard is orthogonal — it restricts WHICH packages can appear at
// all, not how they're annotated.
//
// Bypass: `Allow soak-exclude-third-party bypass` typed verbatim.
//
// Fails open on YAML parse errors.

import path from 'node:path'

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { resolveEditedText } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow soak-exclude-third-party bypass'

// Fleet-internal first-party scopes published by trusted Socket pipelines —
// soak-exempt by design. The danger the guard targets is a third-party
// scope-glob (the 2026-04-06 `@anthropic-ai/*` incident), not a fleet repo's
// own scope. `@stuie` is the first-party scope of the stuie fleet repo.
const ALLOWED_SCOPES = new Set([
  '@socketaddon',
  '@socketbin',
  '@socketregistry',
  '@socketsecurity',
  '@stuie',
])

const SECTION_HEADER = /^minimumReleaseAgeExclude:\s*$/
const ANY_TOP_LEVEL_KEY = /^[A-Za-z_][\w-]*:\s*(?:\S.*)?$/

// Match a per-entry bullet inside the block:
//   - '@scope/name@1.2.3'
//   - '@scope/name'         (scope glob — name part is '*')
//   - '@scope/*'            (glob)
//   - 'bare-name@1.2.3'
//   - 'bare-name'
// Quoted or unquoted. Captures group 1 = full entry (no quotes).
const ENTRY_RE = /^\s*-\s*['"]?(?<entry>[^'"\s]+)['"]?\s*$/

interface OffendingEntry {
  readonly line: number
  readonly entry: string
  readonly scope: string | null
}

export function isPnpmWorkspaceYaml(filePath: string): boolean {
  return path.basename(filePath) === 'pnpm-workspace.yaml'
}

// Extract every per-entry value inside `minimumReleaseAgeExclude:`.
// Returns a Map keyed by entry value (the raw package selector) →
// line number (1-indexed) where the entry sits in the file.
export function parseExcludeEntries(text: string): Map<string, number> {
  const out = new Map<string, number>()
  const lines = text.split('\n')
  let inBlock = false
  for (let i = 0; i < lines.length; i += 1) {
    /* c8 ignore next - split('\n') always yields defined strings */
    const line = lines[i] ?? ''
    if (SECTION_HEADER.test(line)) {
      inBlock = true
      continue
    }
    if (!inBlock) {
      continue
    }
    if (ANY_TOP_LEVEL_KEY.test(line)) {
      inBlock = false
      continue
    }
    const m = ENTRY_RE.exec(line)
    if (m) {
      out.set(m.groups!.entry!, i + 1)
    }
  }
  return out
}

// Pull the scope from an entry. Returns the scope token (e.g.
// `@socketsecurity`) or `null` for un-scoped entries (`defu`,
// `defu@6.1.6`).
export function entryScope(entry: string): string | null {
  if (!entry.startsWith('@')) {
    return undefined
  }
  const slash = entry.indexOf('/')
  if (slash < 0) {
    // `@scope` with no `/name` — malformed; treat as un-scoped.
    return undefined
  }
  return entry.slice(0, slash)
}

export function isAllowedScope(scope: string | null): boolean {
  return scope !== null && ALLOWED_SCOPES.has(scope)
}

export const check = editGuard((filePath, _content, payload) => {
  if (!isPnpmWorkspaceYaml(filePath)) {
    return undefined
  }

  const currentText = safeReadFileSync(filePath) ?? ''
  const afterText = resolveEditedText(payload)
  if (afterText === undefined) {
    return undefined
  }

  let beforeEntries: Map<string, number>
  let afterEntries: Map<string, number>
  try {
    beforeEntries = parseExcludeEntries(currentText)
    afterEntries = parseExcludeEntries(afterText)
  } catch {
    /* c8 ignore next - parseExcludeEntries only does string ops and cannot throw */
    return undefined
  }

  const offending: OffendingEntry[] = []
  for (const [entry, line] of afterEntries) {
    if (beforeEntries.has(entry)) {
      continue
    }
    const scope = entryScope(entry)
    if (!isAllowedScope(scope)) {
      offending.push({ entry, line, scope })
    }
  }
  if (offending.length === 0) {
    return undefined
  }
  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return undefined
  }

  const lines: string[] = [
    '[soak-exclude-scope-guard] Blocked: non-Socket entry in minimumReleaseAgeExclude',
    '',
    `  File: ${filePath}`,
    '',
  ]
  for (let i = 0, { length } = offending; i < length; i += 1) {
    const o = offending[i]!
    lines.push(`  • line ${o.line}: \`${o.entry}\``)
  }
  lines.push(
    '',
    '  `minimumReleaseAgeExclude:` is a security-policy bypass for Socket',
    '  first-party scopes only:',
    '',
    '    @socketaddon/* @socketbin/* @socketregistry/* @socketsecurity/* @stuie/*',
    '',
    '  Adding a third-party package weakens the malware-protection soak gate.',
    '',
    '  Fix: wait for the package to clear the 7-day soak — the gate is doing its',
    '  job. (`overrides:` pins a version but does NOT bypass minimumReleaseAge,',
    '  so it is not a soak escape hatch.)',
    '',
    '  Last resort — to use it before the soak clears, type the bypass phrase',
    '  below, then add it (and any `@scope/*` platform binaries) here with a',
    '  `# published: <date> | removable: <date + 7d>` annotation. That knowingly',
    '  weakens the soak for those exact pins.',
    '',
    `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
    '',
  )
  return block(lines.join('\n'))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
