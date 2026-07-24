#!/usr/bin/env node
// Claude Code PreToolUse hook — no-loose-config-ref-guard.
//
// BLOCKS source that constructs a LOOSE `.config/<file>.{json,yaml,yml,toml}`
// path — either a string literal (`'.config/lockstep.json'`) or a path.join
// pair (`path.join(x, '.config', 'lockstep.json')`). `.config/` is segregated:
// the segment after `.config` MUST be `repo` (repo-owned) or `fleet`
// (fleet-identical). A loose reference is legacy back-compat for a config we've
// already relocated 100% — there is no transient to fall back for, so point at
// the one canonical home instead of adding a fallback branch.
//
// Config DATA only (.json/.yaml/.yml/.toml); code configs are exempt. Bypass:
// `Allow loose-config-ref bypass` for a genuinely external/loose config. Fails
// open on hook bugs (exit 0 + stderr log).
//
// Rule: docs/agents.md/fleet/config-segregation.md.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

const EXT = '(?:json|ya?ml|toml)'

// A `.config/<file>.<ext>` reference where the segment after `.config/` is NOT
// `repo/` or `fleet/`.
const LOOSE_LITERAL_RE =
  // socket-lint: allow uncommented-regex -- described above.
  new RegExp(`\\.config/(?!repo/|fleet/)[A-Za-z0-9._-]+\\.${EXT}\\b`)

// A `path.join(…, '.config', '<file>.<ext>')` pair — the segregated forms
// interpose `'repo'`/`'fleet'`, so a config-ext directly after `'.config'` is
// loose.
const LOOSE_JOIN_RE =
  // socket-lint: allow uncommented-regex -- described above.
  new RegExp(
    `['"\`]\\.config['"\`]\\s*,\\s*['"\`][A-Za-z0-9._-]+\\.${EXT}['"\`]`,
  )

export function detectsLooseConfigRef(content: string): boolean {
  return LOOSE_LITERAL_RE.test(content) || LOOSE_JOIN_RE.test(content)
}

export function emitBlock(filePath: string): string {
  return (
    [
      '[no-loose-config-ref-guard] Blocked: loose `.config/<file>` reference.',
      `  File: ${filePath}`,
      '',
      '  `.config/` is segregated — config lives under `.config/fleet/`',
      '  (fleet-identical) or `.config/repo/` (repo-owned). A loose',
      '  `.config/<file>` path is legacy back-compat for a config already',
      '  relocated 100%. Point at the canonical `.config/repo/` or',
      '  `.config/fleet/` location; do NOT add a fallback branch.',
    ].join('\n') + '\n'
  )
}

export const check = editGuard((filePath, content, payload) => {
  const norm = normalizePath(filePath)
  // Source files only. This guard's own source + its test carry the pattern as
  // examples, so they're exempt.
  if (
    !/\.(?:cjs|cts|js|mjs|mts|ts)$/.test(norm) ||
    norm.includes('/no-loose-config-ref-guard/') ||
    norm.includes('no-loose-config-ref-guard.test.')
  ) {
    return undefined
  }
  if (!content || !detectsLooseConfigRef(content)) {
    return undefined
  }
  if (!isFleetTarget(payload)) {
    return undefined
  }
  return block(emitBlock(filePath))
})

export const hook = defineHook({
  bypass: ['loose-config-ref'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
