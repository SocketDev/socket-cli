#!/usr/bin/env node
/**
 * @file Build-integrity gate: assert the fleet `socket/` oxlint plugin actually
 *   LOADS at runtime and registers every rule. If `oxlint-plugin/index.mts`
 *   throws on import (a bad transitive import, a syntax error in a `lib/`
 *   helper, a renamed export), every `socket/` rule is disabled. oxlint
 *   surfaces this only as a `Failed to load JS plugin` warning on stderr —
 *   whether that warning gates the run depends on oxlint's exit behavior, which
 *   has varied by version + invocation mode (the originating incident saw a
 *   green lint with the plugin silently not loaded). Relying on that incidental
 *   exit code is fragile; this gate asserts load EXPLICITLY and fails closed
 *   with a clear "every socket/ rule is disabled" message. The static surfaces
 *   don't help: `sync-oxlint-rules` and the `oxlint-rule-activations` check
 *   only verify a rule is imported in `index.mts` and activated in
 *   `oxlintrc.json` — a statically-present import that throws at runtime passes
 *   both. Checks (the second is something oxlint NEVER does):
 *
 *   1. `await import(index.mts)` does not throw, and the default export has a
 *      non-empty `rules` object.
 *   2. The registered rule count matches the number of rule FILES in `rules/` —
 *      catches a rule that silently dropped out of the `index.mts` registry
 *      (file present, never wired). oxlint loads such a plugin happily and
 *      lints green; this is the only gate that notices. No magic number — the
 *      expected count is derived from the file listing. Pairs with the
 *      edit-time `.claude/hooks/fleet/oxlint-plugin-load-guard/` (defense in
 *      depth). Exit codes: 0 — plugin loads + count matches; 1 — load threw,
 *      empty rules, or count mismatch. **Why:** memory
 *      `project_oxlint_plugin_load_silent_fail` — a bad import in any rule
 *      disables ALL socket rules; green lint ≠ plugin loaded. Promoted to a
 *      gate after verifying plugin load by hand one too many times
 *      (2026-06-03).
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()
const pluginDir = path.join(REPO_ROOT, '.config', 'fleet', 'oxlint-plugin')
const indexPath = path.join(pluginDir, 'index.mts')
const rulesDir = path.join(pluginDir, 'rules')

// Count the rule source files. Every file directly under `rules/` is one rule
// (lib helpers live in `lib/`, tests in `test/` — neither is here).
export function countRuleFiles(dir: string): number {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  let count = 0
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (name.endsWith('.mts') && !name.endsWith('.test.mts')) {
      count += 1
    }
  }
  return count
}

async function main(): Promise<void> {
  const expected = countRuleFiles(rulesDir)
  if (expected === 0) {
    // No plugin in this repo (scaffolding-only) — nothing to verify.
    logger.success('No oxlint-plugin rules to verify (scaffolding-only repo).')
    return
  }

  let plugin: { rules?: Record<string, unknown> | undefined } | undefined
  try {
    const mod = (await import(indexPath)) as {
      default?: { rules?: Record<string, unknown> | undefined } | undefined
    }
    plugin = mod.default
  } catch (e) {
    logger.error(
      'socket oxlint plugin FAILED TO LOAD — every socket/ rule is silently disabled. Fix the import/syntax error in .config/fleet/oxlint-plugin/ and re-run.',
    )
    logger.error(`  ${errorMessage(e)}`)
    process.exitCode = 1
    return
  }

  const registered = plugin?.rules ? Object.keys(plugin.rules).length : 0
  if (registered === 0) {
    logger.error(
      'socket oxlint plugin loaded but registered 0 rules — the `rules` map is empty or missing. Every socket/ rule is disabled.',
    )
    process.exitCode = 1
    return
  }

  if (registered !== expected) {
    logger.error(
      `socket oxlint plugin rule-count mismatch: ${expected} rule file(s) in rules/, but ${registered} registered in index.mts. A rule is unwired (file present, not in the registry) — run \`pnpm run sync-oxlint-rules\`.`,
    )
    process.exitCode = 1
    return
  }

  logger.success(
    `socket oxlint plugin loads — ${registered} rules registered (matches rules/).`,
  )
}

main().catch((e: unknown) => {
  logger.error(`check-oxlint-plugin-loads failed: ${errorMessage(e)}`)
  process.exitCode = 1
})
