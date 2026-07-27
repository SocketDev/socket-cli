/**
 * @file Claude Code PostToolUse(Edit|Write|MultiEdit) hook —
 *   generic-export-name-nudge. NUDGES (non-blocking, exit 0) when an edit ADDS
 *   an exported declaration whose name is a single generic token — `export
 *   function create`, `export const parse`, `export type Result`. Coding
 *   agents navigate by grep at ~10 tokens per line, and a bare one-word export
 *   is a grep-noise magnet: a real audit found `create` matched 1585 times
 *   across 459 files versus `createStripeClient` 43 times across 19; one-word
 *   names are ~61% unique, two-word ~88%, three-word ~96%.
 *   The edit-time partner of the `socket/exported-name-has-domain-word` oxlint
 *   rule, which catches the same shape once it lands. Both share ONE
 *   predicate — `isGenericExportName` in
 *   `.config/fleet/oxlint-plugin/lib/generic-name-tokens.mts` — so the
 *   denylist and the sanctioned-convention exemptions (`check`, `main`, `run`,
 *   …) never drift between the nudge and the lint gate.
 *   Only the ADDED content matters: a Write's full content, or an Edit's
 *   new_string. Scope is `.mts`/`.ts` source under `src/`, `scripts/`, or
 *   `.claude/hooks/` — a generated/vendored/build/node_modules path is never
 *   scanned. A nudge, not a guard: no bypass phrase (it never blocks).
 */

import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isGenericExportName } from '../../../../.config/fleet/oxlint-plugin/lib/generic-name-tokens.mts'
import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'

// In-scope source: a `.mts`/`.ts` file under `src/`, `scripts/`, or
// `.claude/hooks/`. Test dirs (`test/`, `tests/`, `__tests__/`) fall outside
// these roots already, so a test helper's name is never flagged.
const SCOPE_RE = /(?:^|\/)(?:\.claude\/hooks|scripts|src)\/.*\.m?ts$/

// A `.d.ts`/`.d.mts` declaration file is compiler output, never hand-authored.
const DECLARATION_RE = /\.d\.m?ts$/

// Directory segments that mark generated/vendored/build output — never
// scanned, mirrors the fleet's isGenerated()/isNeverGated() denylists.
const SKIP_SEGMENTS: ReadonlySet<string> = new Set([
  '_dist',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'third_party',
  'upstream',
  'vendor',
])

// An exported declaration name: `export [async] function|const|let|class|
// type|interface|enum <name>`. `export default …` never matches (`default`
// isn't one of the captured keywords), and a bare `export { name }`
// re-export is left to its definition site, same scope as the oxlint rule.
const EXPORTED_DECL_RE =
  /export\s+(?:async\s+)?(?:class|const|enum|function|interface|let|type)\s+([A-Za-z0-9_$]+)/g

function isInScopePath(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  if (!SCOPE_RE.test(normalized)) {
    return false
  }
  if (DECLARATION_RE.test(normalized)) {
    return false
  }
  return !normalized.split('/').some(seg => SKIP_SEGMENTS.has(seg))
}

/**
 * The exported names ADDED by `content` that are single generic tokens
 * (`isGenericExportName`), in first-seen order with no duplicates. Pure +
 * exported so the detection is unit-testable without a hook payload.
 */
export function genericExportNamesAdded(content: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of content.matchAll(EXPORTED_DECL_RE)) {
    const name = match[1]!
    if (!isGenericExportName(name) || seen.has(name)) {
      continue
    }
    seen.add(name)
    out.push(name)
  }
  return out
}

export const check = editGuard((filePath, content) => {
  if (content === undefined || !isInScopePath(filePath)) {
    return undefined
  }
  const generic = genericExportNamesAdded(content)
  if (!generic.length) {
    return undefined
  }
  const rel = path.basename(filePath)
  const lines: string[] = []
  lines.push(
    `[generic-export-name-nudge] ${rel} adds ${generic.length} single-generic-token export${generic.length === 1 ? '' : 's'}:`,
  )
  const shown = Math.min(generic.length, 5)
  for (let i = 0; i < shown; i += 1) {
    lines.push(`  • ${generic[i]}`)
  }
  lines.push('')
  lines.push(
    'A one-word generic export is a grep-noise magnet for agents (one-word names',
  )
  lines.push(
    'are ~61% unique vs ~96% for three-word). Qualify it with a domain word so a',
  )
  lines.push(
    'future grep finds this symbol, not every unrelated `create`/`parse`/`get` —',
  )
  lines.push('e.g. `create` → `createStripeClient`.')
  return notify(lines.join('\n'))
})

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  scope: 'convention',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
