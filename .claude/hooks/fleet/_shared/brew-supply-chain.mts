/**
 * @file Single source of truth for "is this machine's Homebrew hardened to the
 *   6.0.0 supply-chain posture?" — shared by the brew-supply-chain-guard hook
 *   (point-of-use block), the brew-supply-chain-is-hardened.mts check (drift
 *   report in `check --all`), and setup-security-tools (which sets the knobs).
 *   Homebrew 6.0.0 (https://brew.sh/2026/06/11/homebrew-6.0.0/) added two
 *   opt-in supply-chain controls plus the machinery they depend on:
 *
 *   - HOMEBREW_REQUIRE_TAP_TRUST: refuse to evaluate third-party tap code until
 *     it is explicitly trusted (`brew trust …`). Closes the tap-as-RCE surface
 *     — see docs.brew.sh/Tap-Trust.
 *   - HOMEBREW_CASK_OPTS_REQUIRE_SHA: refuse a cask whose download has no pinned
 *     checksum (`sha256 :no_check`). Closes the unverified-download surface —
 *     see docs.brew.sh/Supply-Chain-Security. Both knobs are silently IGNORED
 *     by an older Homebrew, so the only real enforcement is a version floor: a
 *     `brew` below 6.0.0 is not hardenable and the guard blocks it until the
 *     operator upgrades. This concern is DISTINCT from
 *     package-manager-auto-update.mts (which owns the "don't change a tool
 *     version mid-task" knob, HOMEBREW_NO_AUTO_UPDATE) — one module per
 *     concern, per the single-responsibility hook rule.
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- detection runs in a sync hook + sync audit script; needs typed string stdout, no async.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import os from 'node:os'
import process from 'node:process'

import { gte } from '@socketsecurity/lib-stable/versions/compare'
import { coerceVersion } from '@socketsecurity/lib-stable/versions/parse'

import { findInvocation } from './shell-command.mts'

// The Homebrew release that introduced the supply-chain knobs below. A `brew`
// older than this silently ignores the env vars, so the floor is the gate.
export const BREW_MIN_VERSION = '6.0.0'

// Docs the operator is pointed at when the guard / audit fires.
export const BREW_TAP_TRUST_DOCS = 'https://docs.brew.sh/Tap-Trust'
export const BREW_SUPPLY_CHAIN_DOCS =
  'https://docs.brew.sh/Supply-Chain-Security'

export interface BrewSecurityEnv {
  // The env-var name a shell `export` sets.
  name: string
  // The value that turns the control on (always '1' today).
  value: string
  // One-line description of what the control protects against, surfaced in
  // audit / guard output.
  protects: string
}

// The Homebrew 6.0.0 supply-chain knobs setup-security-tools persists into the
// managed shell-rc block on macOS. Single source of truth shared with the
// detector below — the shell-rc bridge imports this list instead of hardcoding
// a divergent copy, so a future brew knob added here flows into the persisted
// block automatically. Listed alphabetically by env name.
export const MACOS_BREW_SECURITY_ENV: readonly BrewSecurityEnv[] = [
  {
    name: 'HOMEBREW_CASK_OPTS_REQUIRE_SHA',
    value: '1',
    protects:
      'refuses a cask download with no pinned checksum (sha256 :no_check)',
  },
  {
    name: 'HOMEBREW_REQUIRE_TAP_TRUST',
    value: '1',
    protects:
      'refuses to evaluate an untrusted third-party tap until `brew trust` approves it',
  },
]

export interface BrewSecurityStatus {
  // 'hardened' = brew is >= the floor AND every knob is on (good); 'unhardened'
  // = brew present but the floor or a knob is unmet (blockable drift); 'absent'
  // = brew isn't on PATH, so the check is not applicable (never blocks).
  state: 'hardened' | 'unhardened' | 'absent'
  // The detected Homebrew version, or undefined when brew is absent / its
  // version couldn't be read.
  version: string | undefined
  // True when the detected version is >= BREW_MIN_VERSION.
  versionOk: boolean
  // Env knobs that are NOT set to their hardened value.
  missingEnv: readonly BrewSecurityEnv[]
  // One-line explanation of what was read.
  reason: string
}

// True when an env var is set to a truthy "on" value (1 / true / yes / on).
export function brewEnvIsOn(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

// True when `brew` resolves on PATH. `command -v` is a shell builtin (not
// spawnable directly), so probe with the platform PATH resolver: `where` on
// Windows, `which` elsewhere. Homebrew is macOS/Linux only; on win32 this is
// always false.
export function hasBrew(): boolean {
  const resolver = os.platform() === 'win32' ? 'where' : 'which'
  try {
    return spawnSync(resolver, ['brew'], { stdio: 'pipe' }).status === 0
  } catch {
    return false
  }
}

// Read the installed Homebrew version, or undefined when brew is missing / the
// call fails. `brew --version` prints e.g. "Homebrew 6.0.0\nHomebrew/..." — the
// first line's trailing token is the version. coerceVersion tolerates the
// occasional git-describe suffix (e.g. "6.0.0-1-gabc123").
export function readBrewVersion(): string | undefined {
  let stdout: unknown
  try {
    const result = spawnSync('brew', ['--version'], { stdio: 'pipe' })
    if (result.status !== 0) {
      return undefined
    }
    ;({ stdout } = result)
  } catch {
    return undefined
  }
  const text = typeof stdout === 'string' ? stdout : String(stdout)
  const firstLine = text.split(/\r?\n/u, 1)[0]?.trim() ?? ''
  const token = firstLine.replace(/^Homebrew\s+/iu, '').trim()
  const coerced = coerceVersion(token)
  return coerced ? String(coerced) : undefined
}

// Read the current machine's Homebrew supply-chain posture. Pure-ish: only
// reads env + `brew --version`. Never mutates.
export function detectBrewSecurity(): BrewSecurityStatus {
  if (!hasBrew()) {
    return {
      state: 'absent',
      version: undefined,
      versionOk: false,
      missingEnv: [],
      reason: 'brew not on PATH',
    }
  }
  const version = readBrewVersion()
  const versionOk = version !== undefined && gte(version, BREW_MIN_VERSION)
  const missingEnv = MACOS_BREW_SECURITY_ENV.filter(
    knob => !brewEnvIsOn(knob.name),
  )
  if (versionOk && missingEnv.length === 0) {
    return {
      state: 'hardened',
      version,
      versionOk,
      missingEnv: [],
      reason: `Homebrew ${version} with tap-trust + cask-SHA enforced`,
    }
  }
  const parts: string[] = []
  if (!versionOk) {
    parts.push(
      version === undefined
        ? 'Homebrew version unreadable'
        : `Homebrew ${version} is below the ${BREW_MIN_VERSION} floor`,
    )
  }
  if (missingEnv.length > 0) {
    parts.push(`unset: ${missingEnv.map(k => k.name).join(', ')}`)
  }
  return {
    state: 'unhardened',
    version,
    versionOk,
    missingEnv,
    reason: parts.join('; '),
  }
}

// True when the Bash command invokes `brew` (AST-matched, no regex). Used by
// the guard to decide whether to verify brew's posture before the call runs.
export function commandInvokesBrew(command: string): boolean {
  return findInvocation(command, { binary: 'brew' })
}

// The bypass phrase that suppresses the brew-supply-chain guard.
export const BREW_SUPPLY_CHAIN_BYPASS_PHRASE = 'Allow brew-supply-chain bypass'
