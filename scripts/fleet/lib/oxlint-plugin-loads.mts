/**
 * @file Shared assertion that the fleet `socket/` oxlint plugin actually LOADS
 *   and registers every rule. If `oxlint-plugin/index.mts` throws on import (a
 *   bad transitive import, a missing dep, a renamed export) oxlint disables
 *   every `socket/` rule and STILL exits 0 — a green lint with no rules
 *   running. The originating incidents: a rule importing `regjsparser` that
 *   wasn't installed, and a `lib/` helper with a bad import; both left the
 *   whole plugin dead while `pnpm run lint` passed vacuously. Two consumers
 *   share this so the writer (the `oxlint-plugin-loads` check) and the gate
 *   (`lint.mts`, which runs oxlint and must not trust a vacuous pass) can't
 *   disagree (1 path, 1 reference). The function is pure-ish — it imports the
 *   plugin and returns a structured verdict; the caller logs. Mirrors
 *   `lib/coverage-badge.mts` (one helper, a writer + a check).
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import type { Dirent } from 'node:fs'

export interface PluginLoadResult {
  // 'ok' — loads + rule count matches. 'no-plugin' — scaffolding-only repo,
  // nothing to verify (not a failure). 'load-threw' — import threw (dead
  // plugin). 'empty' — loaded but registered 0 rules. 'count-mismatch' — a rule
  // dir exists but isn't wired into the index registry.
  readonly status:
    | 'ok'
    | 'no-plugin'
    | 'load-threw'
    | 'empty'
    | 'count-mismatch'
  readonly expected: number
  readonly registered: number
  // The import error message when status is 'load-threw'.
  readonly error: string | undefined
}

// Count the rules: each is a dir under `fleet/` holding an index.mts (mirrors
// .claude/hooks/fleet/<name>/). lib helpers + _shared/ are not rule dirs.
export function countRuleDirs(dir: string): number {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  let count = 0
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const d = entries[i]!
    if (
      d.isDirectory() &&
      !d.name.startsWith('_') &&
      existsSync(path.join(dir, d.name, 'index.mts'))
    ) {
      count += 1
    }
  }
  return count
}

// Import a plugin entry (source index.mts OR the bundled .mjs) and count the
// rules its default export registers. Never throws — a failed import returns an
// error string so the caller can classify it `load-threw`.
async function loadPluginRules(
  entryPath: string,
): Promise<{ error: string | undefined; registered: number }> {
  try {
    const mod = (await import(entryPath)) as {
      default?: { rules?: Record<string, unknown> | undefined } | undefined
    }
    const rules = mod.default?.rules
    return {
      error: undefined,
      registered: rules ? Object.keys(rules).length : 0,
    }
  } catch (e) {
    return { error: errorMessage(e), registered: 0 }
  }
}

/**
 * Verify the fleet oxlint plugin actually loads + registers its rules. Two
 * shapes, one gate:
 *
 * - SOURCE present (the wheelhouse): the plugin ships as ~100 rule dirs under
 *   `<repoRoot>/.config/fleet/oxlint-plugin/fleet/`. Import the source index
 *   and assert it registers exactly that many rules (`count-mismatch` catches a
 *   rule dir that isn't wired into the registry).
 * - SOURCE absent, BUNDLE present (a bundle-only member): the runtime artifact is
 *   `<repoRoot>/.config/fleet/oxlint-plugin.mjs`. Import it and assert a
 *   non-empty rules map — a dead bundle is exactly the vacuous pass this gate
 *   exists to catch. There is no source count to compare against, so `ok` means
 *   "registered ≥ 1".
 *
 * Returns a structured verdict; never throws (a load failure is `load-threw`).
 * A repo with neither source nor bundle returns `no-plugin` (not a failure).
 */
export async function assertPluginLoads(
  repoRoot: string,
): Promise<PluginLoadResult> {
  const pluginDir = path.join(repoRoot, '.config', 'fleet', 'oxlint-plugin')
  const sourceIndexPath = path.join(pluginDir, 'index.mts')
  const bundlePath = path.join(
    repoRoot,
    '.config',
    'fleet',
    'oxlint-plugin.mjs',
  )
  const fleetDir = path.join(pluginDir, 'fleet')
  const expected = countRuleDirs(fleetDir)

  if (expected > 0) {
    const { error, registered } = await loadPluginRules(sourceIndexPath)
    if (error !== undefined) {
      return { error, expected, registered: 0, status: 'load-threw' }
    }
    if (registered === 0) {
      return { error: undefined, expected, registered: 0, status: 'empty' }
    }
    if (registered !== expected) {
      return {
        error: undefined,
        expected,
        registered,
        status: 'count-mismatch',
      }
    }
    return { error: undefined, expected, registered, status: 'ok' }
  }

  if (existsSync(bundlePath)) {
    const { error, registered } = await loadPluginRules(bundlePath)
    if (error !== undefined) {
      return { error, expected: 0, registered: 0, status: 'load-threw' }
    }
    if (registered === 0) {
      return { error: undefined, expected: 0, registered: 0, status: 'empty' }
    }
    return { error: undefined, expected: registered, registered, status: 'ok' }
  }

  return { error: undefined, expected: 0, registered: 0, status: 'no-plugin' }
}
