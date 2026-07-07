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

import { errorMessage } from '@socketsecurity/lib-stable/errors'

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

/**
 * Import the plugin at `<repoRoot>/.config/fleet/oxlint-plugin/index.mts` and
 * verify it loads + registers exactly the number of rules present under
 * `fleet/`. Returns a structured verdict; never throws (a load failure is
 * `load-threw`). A repo with no plugin returns `no-plugin` (status quo, not a
 * failure).
 */
export async function assertPluginLoads(
  repoRoot: string,
): Promise<PluginLoadResult> {
  const pluginDir = path.join(repoRoot, '.config', 'fleet', 'oxlint-plugin')
  const indexPath = path.join(pluginDir, 'index.mts')
  const fleetDir = path.join(pluginDir, 'fleet')
  const expected = countRuleDirs(fleetDir)
  if (expected === 0) {
    return { error: undefined, expected: 0, registered: 0, status: 'no-plugin' }
  }
  let plugin: { rules?: Record<string, unknown> | undefined } | undefined
  try {
    const mod = (await import(indexPath)) as {
      default?: { rules?: Record<string, unknown> | undefined } | undefined
    }
    plugin = mod.default
  } catch (e) {
    return {
      error: errorMessage(e),
      expected,
      registered: 0,
      status: 'load-threw',
    }
  }
  const registered = plugin?.rules ? Object.keys(plugin.rules).length : 0
  if (registered === 0) {
    return { error: undefined, expected, registered: 0, status: 'empty' }
  }
  if (registered !== expected) {
    return { error: undefined, expected, registered, status: 'count-mismatch' }
  }
  return { error: undefined, expected, registered, status: 'ok' }
}
