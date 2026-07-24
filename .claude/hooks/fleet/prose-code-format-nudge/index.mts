#!/usr/bin/env node
// Claude Code PostToolUse hook — prose-code-format-nudge.
//
// After an Edit/Write to a human-facing `*.md`, flag known software
// identifiers written as BARE words (e.g. rustls, reqwest, rolldown) that
// should be code spans. Surfaces a per-name nudge; never blocks (advisory —
// the dictionary can't be exhaustive). Scope is prose only: markdown docs,
// CHANGELOG, READMEs — NOT source files, whose comments have their own
// conventions.
//
// The dictionary + scanner live in `_shared/known-names.mts` (one source of
// truth, shared with the `prose` skill). The dictionary is derived from the
// repo's own manifests (package.json, the pnpm catalog, external-tools.json,
// Cargo.toml) plus a small curated EXTRA_NAMES, minus an AMBIGUOUS_DENYLIST so
// short/English-colliding names don't fire on ordinary sentences.
//
// PostToolUse (not Pre) so the edit lands first and the scanner reads on-disk
// state. Exits deterministically; fails open.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'
import { findBareKnownNames, safeRead } from '../_shared/known-names.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'

export function isHumanProseMarkdown(filePath: string): boolean {
  const p = normalizePath(filePath)
  if (!/\.md$/i.test(p)) {
    return false
  }
  // Skip vendored / generated / VCS trees — not human-authored prose.
  return !/(?:^|\/)(?:\.git|build|dist|node_modules)\//.test(p)
}

export const check = editGuard((filePath, content) => {
  if (!isHumanProseMarkdown(filePath)) {
    return undefined
  }
  // PostToolUse: prefer the on-disk (post-edit) content; fall back to the
  // Write payload's content when the file isn't readable (ephemeral test).
  const prose = safeRead(filePath) ?? content
  if (!prose) {
    return undefined
  }
  const repoRoot = resolveProjectDir()
  const hits = findBareKnownNames(prose, { repoRoot })
  if (!hits.length) {
    return undefined
  }
  const lines = [
    '[prose-code-format-nudge] bare known library/tool names in prose — ' +
      'wrap each in backticks:',
    '',
    `  File: ${filePath}`,
    '',
  ]
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const h = hits[i]!
    lines.push(`  ${h.line}:${h.col}  ${h.name} -> \`${h.name}\``)
  }
  lines.push(
    '',
    '  Known software identifiers read as code, not prose — a code span keeps',
    '  them unambiguous and consistent. Code-format only (no links). Advisory:',
    '  widen EXTRA_NAMES in _shared/known-names.mts if a real name is missed,',
    '  or add to AMBIGUOUS_DENYLIST if this is a false positive.',
    '',
  )
  return notify(lines.join('\n'))
})

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
