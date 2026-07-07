#!/usr/bin/env node
// Claude Code PreToolUse hook — soak-pin-needs-annotation-guard.
//
// Blocks Edit/Write to the soak-exclude manifest
// (scripts/repo/sync-scaffolding/manifest/workspace.mts) that ADDS a
// version-pinned EXPECTED_RELEASE_AGE_EXCLUDE entry (`'name@version'`) without a
// matching `{ published, removable }` annotation in release-age-annotations.mts.
//
// Why: the manifest enforces this pin ↔ annotation parity at MODULE LOAD (a
// throw), so a missing annotation otherwise surfaces only when the cascade
// crashes mid-run. This front-runs it at edit time — add the annotation first.
//
// No bypass — the fix is deterministic (add the date annotation). Fails open on
// any read error (never blocks on its own bug).

import path from 'node:path'

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { resolveEditedText } from '../_shared/payload.mts'

// The sibling annotations registry, resolved next to the manifest.
const ANNOTATIONS_BASENAME = 'release-age-annotations.mts'

// A version-pinned soak entry literal: `'name@1.2.3'` or `'@scope/name@1.2.3'`.
// Scope globs (`@socketsecurity/*`) + spreads carry no version pin, so they need
// no date annotation and don't match (no `@<version>` segment after the name).
const PIN_RE = /'((?:@[\w.-]+\/)?[\w.-]+@[\w.+~-]+)'/g

export function isSoakManifest(filePath: string): boolean {
  return normalizePath(filePath).endsWith(
    'sync-scaffolding/manifest/workspace.mts',
  )
}

// Every version-pinned soak entry literal present in `text`.
export function soakPins(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(PIN_RE)) {
    out.add(m[1]!)
  }
  return out
}

// The pins present after the edit but not before (the ones this edit adds).
export function addedPins(beforeText: string, afterText: string): string[] {
  const before = soakPins(beforeText)
  const added: string[] = []
  for (const pin of soakPins(afterText)) {
    if (!before.has(pin)) {
      added.push(pin)
    }
  }
  return added
}

// Of `pins`, those with no `'<pin>':` key in the annotations registry.
export function pinsMissingAnnotation(
  pins: readonly string[],
  annotationsText: string,
): string[] {
  return pins.filter(pin => !annotationsText.includes(`'${pin}'`))
}

export const check = editGuard((filePath, _content, payload) => {
  if (!isSoakManifest(filePath)) {
    return undefined
  }
  const before = safeReadFileSync(filePath) ?? ''
  const after = resolveEditedText(payload)
  if (after === undefined) {
    return undefined
  }
  const added = addedPins(before, after)
  if (added.length === 0) {
    return undefined
  }
  const annotationsPath = path.join(
    path.dirname(filePath),
    ANNOTATIONS_BASENAME,
  )
  const annotationsText = safeReadFileSync(annotationsPath)
  if (annotationsText === undefined) {
    return undefined
  }
  const missing = pinsMissingAnnotation(added, annotationsText)
  if (missing.length === 0) {
    return undefined
  }
  const lines: string[] = [
    '[soak-pin-needs-annotation-guard] Blocked: soak-exclude pin without a date annotation',
    '',
    `  File: ${filePath}`,
    '',
  ]
  for (const pin of missing) {
    lines.push(`  • \`${pin}\``)
  }
  lines.push(
    '',
    '  A version-pinned EXPECTED_RELEASE_AGE_EXCLUDE entry needs a',
    '  { published, removable } annotation in release-age-annotations.mts, or the',
    '  manifest throws at load time and the cascade crashes mid-run.',
    '',
    '  Fix: add to scripts/repo/sync-scaffolding/manifest/release-age-annotations.mts',
    '  (removable = published + 7 days), then re-add the pin:',
  )
  for (const pin of missing) {
    lines.push(
      `    '${pin}': { published: '<YYYY-MM-DD>', removable: '<+7d>' },`,
    )
  }
  lines.push('')
  return block(lines.join('\n'))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
