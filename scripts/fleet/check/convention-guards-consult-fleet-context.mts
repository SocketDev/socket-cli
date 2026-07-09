#!/usr/bin/env node
/*
 * @file Code-is-law: fleet CONVENTION guards must consult the `isFleetTarget`
 *   detector (`.claude/hooks/fleet/_shared/fleet-context.mts`) so they no-op
 *   outside a fleet repo, while UNIVERSAL-SAFETY guards must NOT (they fire
 *   everywhere — secrets, injection, supply-chain, work-loss).
 *
 *   This enforces a bidirectional invariant over the curated CONVENTION_GUARDS
 *   set and the guards that actually import `isFleetTarget`:
 *     - a convention guard that DROPS the import (silent regression) fails, and
 *     - a guard that STARTS importing the detector without being registered
 *       here fails.
 *   Either way the convention-vs-safety classification stays explicit + current
 *   — a new guard can't quietly lighten itself, and a threaded guard can't
 *   quietly un-thread.
 *
 *   v1 scope: enforces the KNOWN convention set. The exhaustive "every guard
 *   declares convention-vs-safety" classification is future work (it needs a
 *   judgement pass over the whole hook set; see the no-pm-exec case — npx/dlx
 *   fetch-and-execute is universal safety, NOT a convention, so it must stay
 *   off this list).
 *
 *   Exit: 0 — invariant holds; 1 — at least one discrepancy.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { REPO_ROOT } from '../paths.mts'

// Guards that MUST consult `isFleetTarget` (they lighten outside a fleet repo).
// Sorted. Thread the detector into a guard, then add it here — the check fails
// until both are true.
export const CONVENTION_GUARDS: readonly string[] = [
  'markdown-filename-guard',
  'module-noun-name-guard',
  'no-corepack-guard',
  'no-direct-linter-guard',
  'no-glob-run-s-guard',
  'no-new-config-guard',
  'no-other-linters-guard',
  'no-revert-guard',
  'private-name-nudge',
  'shallow-clone-guard',
  'test-script-defers-guard',
  'version-bump-order-guard',
]

const FLEET_HOOKS_DIR = path.join(REPO_ROOT, '.claude', 'hooks', 'fleet')

// The detector's identifier; a guard that imports it is "convention-aware".
const DETECTOR_TOKEN = 'isFleetTarget'

// A guard CONSULTS the detector when it IMPORTS `isFleetTarget` (a named import
// binding) — NOT when it only mentions the token in a comment (e.g.
// dirty-worktree-stop-guard documents that it intentionally does NOT consult
// it). Brace-bounded (`import { … isFleetTarget … }`) so a comment or an
// unrelated destructure never produces a false positive.
const DETECTOR_IMPORT_RE = new RegExp(
  `import\\s*\\{[^}]*\\b${DETECTOR_TOKEN}\\b`,
)

export function guardConsultsDetector(hooksDir: string, name: string): boolean {
  const indexPath = path.join(hooksDir, name, 'index.mts')
  if (!existsSync(indexPath)) {
    return false
  }
  return DETECTOR_IMPORT_RE.test(readFileSync(indexPath, 'utf8'))
}

export function listConsultingGuards(hooksDir: string): string[] {
  if (!existsSync(hooksDir)) {
    return []
  }
  const out: string[] = []
  const entries = readdirSync(hooksDir)
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (name.startsWith('_')) {
      continue
    }
    const dir = path.join(hooksDir, name)
    if (!statSync(dir).isDirectory()) {
      continue
    }
    if (guardConsultsDetector(hooksDir, name)) {
      out.push(name)
    }
  }
  out.sort()
  return out
}

export interface Discrepancy {
  name: string
  problem: string
}

export function findDiscrepancies(
  consultingGuards: readonly string[],
): Discrepancy[] {
  const convention = new Set(CONVENTION_GUARDS)
  const consulting = new Set(consultingGuards)
  const out: Discrepancy[] = []
  for (let i = 0, { length } = CONVENTION_GUARDS; i < length; i += 1) {
    const name = CONVENTION_GUARDS[i]!
    if (!consulting.has(name)) {
      out.push({
        name,
        problem:
          'registered as a convention guard but does NOT import isFleetTarget ' +
          '(thread the detector in, or remove it from CONVENTION_GUARDS)',
      })
    }
  }
  for (let i = 0, { length } = consultingGuards; i < length; i += 1) {
    const name = consultingGuards[i]!
    if (!convention.has(name)) {
      out.push({
        name,
        problem:
          'imports isFleetTarget but is NOT in CONVENTION_GUARDS — add it so ' +
          'the convention classification stays explicit',
      })
    }
  }
  return out
}

function main(): void {
  const consulting = listConsultingGuards(FLEET_HOOKS_DIR)
  const discrepancies = findDiscrepancies(consulting)
  if (discrepancies.length === 0) {
    process.stdout.write(
      `[convention-guards-consult-fleet-context] OK: ${CONVENTION_GUARDS.length} ` +
        `convention guard(s) all consult isFleetTarget, and no unregistered ` +
        `consumer exists.\n`,
    )
    return
  }
  process.stderr.write(
    `[convention-guards-consult-fleet-context] ${discrepancies.length} ` +
      `discrepancy(ies) in the convention-guard ⟺ isFleetTarget invariant:\n\n`,
  )
  for (let i = 0, { length } = discrepancies; i < length; i += 1) {
    const d = discrepancies[i]!
    process.stderr.write(`  • ${d.name}: ${d.problem}\n`)
  }
  process.stderr.write(
    `\n  Convention guards lighten outside a fleet repo via isFleetTarget; ` +
      `universal-safety guards must NOT consult it. Keep CONVENTION_GUARDS in ` +
      `scripts/fleet/check/convention-guards-consult-fleet-context.mts in sync.\n`,
  )
  process.exit(1)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
