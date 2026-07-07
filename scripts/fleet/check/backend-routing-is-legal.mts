// Fleet check — every multi-agent skill's backend routing is legal.
//
// The fleet's review / scan / fix skills route each pass to a CLI backend via a
// per-role `preferenceOrder` array (e.g. `['codex', 'kimi', 'claude']`), then
// the shared `resolveBackendForRole` (`@socketsecurity/lib/ai/backends`) picks
// the first installed entry. Two ways a hand-edited preference order goes wrong:
//
//   1. It names a backend that isn't in the registry (a typo, or a backend that
//      was renamed/removed) — that entry is dead, silently skipped at runtime,
//      so the intended backend never runs.
//   2. It lists a HYBRID backend (opencode) in the order. Hybrid backends
//      dispatch to whatever provider their own config selects, so the resolver
//      NEVER auto-picks them (model attribution would be wrong); listing one in
//      a preference order is a no-op that reads as if it would run. opencode is
//      reachable only via an explicit override (`--pass role=opencode`).
//
// Why a check on top of the shared lib: the lib enforces the policy at RUNTIME
// (a bad entry is skipped), but a skill author reading a preference order can't
// tell a dead/no-op entry from a live one. This gate surfaces it at commit time,
// against the registry as the single source of truth — so the doc
// (`_shared/multi-agent-backends.md`), the lib, and every skill stay aligned.
//
// Scans `preferenceOrder: [ ... ]` literals across skills + scripts. Exit codes:
// 0 — every preference order references only known, non-hybrid backends; 1 — at
// least one names an unknown or hybrid backend.
//
// Usage: node scripts/fleet/check/backend-routing-is-legal.mts [--quiet]

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { globSync } from '@socketsecurity/lib-stable/globs/match'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// The legal backend name set + which are hybrid. This MIRRORS the runtime
// registry `BACKENDS` in `@socketsecurity/lib/ai/backends` — kept inline (not
// imported) because the published `-stable` snapshot may predate the
// `ai/backends` export, and a check must not break on an unresolvable import.
// The set is small and changes rarely; a future sync-invariant check can assert
// these match the lib once `-stable` carries the export.
const KNOWN_BACKENDS: ReadonlySet<string> = new Set([
  'claude',
  'codex',
  'kimi',
  'opencode',
])
const HYBRID_BACKENDS: ReadonlySet<string> = new Set(['opencode'])

const SCAN_GLOBS = ['scripts/**/*.mts', '.claude/skills/**/*.mts'] as const

const IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/*.test.mts',
  '**/test/**',
  // The check itself names the field + backend strings it scans for.
  '**/check/backend-routing-is-legal.mts',
] as const

// `preferenceOrder: [ 'codex', 'kimi', … ]` — captures the bracket body.
const PREFERENCE_ORDER_RE = /preferenceOrder\s*:\s*\[([^\]]*)\]/g
// A quoted backend name inside the bracket body.
const QUOTED_RE = /['"]([^'"]+)['"]/g

export interface RoutingViolation {
  readonly file: string
  readonly line: number
  readonly detail: string
}

// 1-based line number of byte offset `index` in `text`.
export function lineOf(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') {
      line += 1
    }
  }
  return line
}

// Scan one file's source for illegal preference-order entries.
export function scanRouting(text: string, file: string): RoutingViolation[] {
  const out: RoutingViolation[] = []
  for (const match of text.matchAll(PREFERENCE_ORDER_RE)) {
    const body = match[1] ?? ''
    const line = lineOf(text, match.index ?? 0)
    for (const q of body.matchAll(QUOTED_RE)) {
      const name = q[1] ?? ''
      if (!KNOWN_BACKENDS.has(name)) {
        // oxlint-disable-next-line unicorn/no-array-sort -- the spread copies KNOWN_BACKENDS into a fresh array (no shared mutation); .toSorted() would trip socket/no-runtime-features-below-engine-floor in cascaded Node-18 repos.
        const known = [...KNOWN_BACKENDS].sort().join(', ')
        out.push({
          detail: `preferenceOrder names unknown backend "${name}" — not in @socketsecurity/lib/ai/backends BACKENDS (${known}). Fix the name or add the backend to the registry.`,
          file,
          line,
        })
      } else if (HYBRID_BACKENDS.has(name)) {
        out.push({
          detail: `preferenceOrder lists hybrid backend "${name}" — hybrid backends are never auto-picked (model attribution would be wrong). Remove it from the order; it is reachable only via an explicit override.`,
          file,
          line,
        })
      }
    }
  }
  return out
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const files = globSync([...SCAN_GLOBS], {
    cwd: REPO_ROOT,
    ignore: [...IGNORE_GLOBS],
  })
  const violations: RoutingViolation[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    const abs = path.join(REPO_ROOT, rel)
    let text = ''
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    violations.push(...scanRouting(text, rel))
  }
  if (violations.length) {
    logger.fail(
      `[check-backend-routing-is-legal] ${violations.length} illegal preference-order entr${violations.length === 1 ? 'y' : 'ies'}:`,
    )
    for (let i = 0, { length } = violations; i < length; i += 1) {
      const v = violations[i]!
      logger.error(`  ${v.file}:${v.line} — ${v.detail}`)
    }
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-backend-routing-is-legal] all backend preference orders reference known, non-hybrid backends.',
    )
  }
}

main()
