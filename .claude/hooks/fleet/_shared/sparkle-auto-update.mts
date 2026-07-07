/**
 * @file Single source of truth for "is this macOS app's Sparkle auto-updater
 *   disabled on this machine?" — shared by the sparkle-auto-update-is-disabled
 *   check (drift report in `check --all`) and setup-security-tools (which
 *   writes the disable). Companion to package-manager-auto-update.mts: that
 *   module owns package managers (`brew`/`npm`/…) whose binary an agent runs
 *   from Bash; this one owns GUI apps that self-update via the Sparkle
 *   framework (e.g. OrbStack) with no Bash invocation to gate — so the
 *   enforcement surfaces are persist + audit, not a PreToolUse guard. A Sparkle
 *   app that auto-updates can swap a tool version under a running build / scan
 *   (reproducibility + supply-chain hazard); the install also rides the app's
 *   own update channel, outside the fleet's soak gate. Sparkle reads
 *   `SUEnableAutomaticChecks` / `SUAutomaticallyUpdate` from the app's macOS
 *   defaults domain (the app bundle id); a user-level `defaults write`
 *   overrides the Info.plist default, so writing them `false` durably disables
 *   both the background check and silent install.
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- detection + apply run in a sync audit script + sync installer; need typed string stdout, no async.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import os from 'node:os'

export interface SparkleApp {
  // Stable id for messages, e.g. 'orbstack'.
  id: string
  // Human name for messages.
  name: string
  // The macOS defaults domain Sparkle reads — the app's CFBundleIdentifier.
  domain: string
}

// The Sparkle prefs that disable auto-update. `SUEnableAutomaticChecks` stops
// the background update check; `SUAutomaticallyUpdate` stops silent install of
// a found update. Both set false = fully off. Listed alphabetically.
export const SPARKLE_DISABLE_KEYS: readonly string[] = [
  'SUAutomaticallyUpdate',
  'SUEnableAutomaticChecks',
]

// macOS GUI apps the fleet uses for tooling that ship a Sparkle auto-updater.
// OrbStack's bundle id is `dev.kdrag0n.MacVirt` (NOT `dev.orbstack`) — read from
// its Info.plist CFBundleIdentifier. Listed alphabetically by id.
export const SPARKLE_APPS: readonly SparkleApp[] = [
  {
    id: 'orbstack',
    name: 'OrbStack',
    domain: 'dev.kdrag0n.MacVirt',
  },
]

export interface SparkleStatus {
  id: string
  name: string
  domain: string
  // 'disabled' = both keys read false (good); 'enabled' = at least one key is
  // not false (drift); 'absent' = not macOS / the app's defaults domain has no
  // Sparkle keys (app not installed or never launched) — not applicable.
  state: 'disabled' | 'enabled' | 'absent'
  // The disable keys whose value is not `false` (drives the fix list).
  enabledKeys: readonly string[]
  reason: string
}

// Read one `defaults read <domain> <key>` value, or undefined when the key /
// domain is unset (exit non-zero). Never throws. Array args — no shell parsing.
export function readDefault(domain: string, key: string): string | undefined {
  try {
    const result = spawnSync('defaults', ['read', domain, key], {
      stdio: 'pipe',
    })
    if (result.status !== 0) {
      return undefined
    }
    const { stdout } = result
    return (typeof stdout === 'string' ? stdout : String(stdout)).trim()
  } catch {
    return undefined
  }
}

// A defaults bool reads back as `0` (false) or `1` (true). True when the value
// is explicitly `0` — i.e. the key is set to false (auto-update disabled).
export function defaultIsFalse(value: string | undefined): boolean {
  return value === '0'
}

// Pure classifier: given an app + each disable key's read-back value (undefined
// = unset), decide the posture. Split from detectSparkle so the logic is
// unit-testable without spawning `defaults`. `notMacos` short-circuits to
// 'absent' (a non-macOS caller has nothing to read).
export function classifySparkle(
  app: SparkleApp,
  values: ReadonlyArray<{ key: string; value: string | undefined }>,
  notMacos: boolean = false,
): SparkleStatus {
  const base = { id: app.id, name: app.name, domain: app.domain }
  if (notMacos) {
    return { ...base, state: 'absent', enabledKeys: [], reason: 'not macOS' }
  }
  // If neither key is present in the domain at all, the app isn't installed /
  // never launched (no Sparkle prefs written) — not applicable.
  if (values.every(v => v.value === undefined)) {
    return {
      ...base,
      state: 'absent',
      enabledKeys: [],
      reason: `no Sparkle prefs in ${app.domain} (not installed / never launched)`,
    }
  }
  // A key that is unset OR not `false` leaves auto-update on. Sparkle defaults
  // an unset key to its Info.plist value (true for OrbStack), so unset = enabled.
  const enabledKeys = values
    .filter(v => !defaultIsFalse(v.value))
    .map(v => v.key)
  if (enabledKeys.length === 0) {
    return {
      ...base,
      state: 'disabled',
      enabledKeys: [],
      reason: `${app.name} Sparkle auto-update disabled (both keys false)`,
    }
  }
  return {
    ...base,
    state: 'enabled',
    enabledKeys,
    reason: `${app.name} Sparkle auto-update still on — not false: ${enabledKeys.join(', ')}`,
  }
}

// Read an app's Sparkle auto-update posture. macOS-only; off-macOS → absent.
export function detectSparkle(app: SparkleApp): SparkleStatus {
  if (os.platform() !== 'darwin') {
    return classifySparkle(app, [], true)
  }
  const values = SPARKLE_DISABLE_KEYS.map(key => ({
    key,
    value: readDefault(app.domain, key),
  }))
  return classifySparkle(app, values)
}

// Write `defaults write <domain> <key> -bool false` for every disable key.
// Returns true when all writes succeeded. macOS-only; off-macOS → false (no-op).
export function disableSparkle(app: SparkleApp): boolean {
  if (os.platform() !== 'darwin') {
    return false
  }
  let ok = true
  for (let i = 0, { length } = SPARKLE_DISABLE_KEYS; i < length; i += 1) {
    const key = SPARKLE_DISABLE_KEYS[i]!
    try {
      const result = spawnSync(
        'defaults',
        ['write', app.domain, key, '-bool', 'false'],
        { stdio: 'pipe' },
      )
      if (result.status !== 0) {
        ok = false
      }
    } catch {
      ok = false
    }
  }
  return ok
}

// Run every app's detector. Used by the audit; 'absent' is informational.
export function auditSparkleApps(): SparkleStatus[] {
  const out: SparkleStatus[] = []
  for (let i = 0, { length } = SPARKLE_APPS; i < length; i += 1) {
    out.push(detectSparkle(SPARKLE_APPS[i]!))
  }
  return out
}
