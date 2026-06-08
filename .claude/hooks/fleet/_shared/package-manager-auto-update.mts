/**
 * @file Single source of truth for "is this package manager's auto-update
 *   disabled on this machine?" — shared by the pkg-auto-update-guard hook
 *   (point-of-use block), the audit-pkg-auto-update.mts script (drift report in
 *   `check --all`), and setup-security-tools (which sets the knobs). A package
 *   manager that auto-updates mid-task can change a tool's version underneath a
 *   build/scan, add latency, or pull an unsoaked package — a reproducibility +
 *   supply-chain hazard. The knob lives OUTSIDE the repo (env vars, npmrc,
 *   chocolatey.config, winget settings) so it drifts per machine; this module
 *   centralizes the knob + how to read it so the three consumers never diverge.
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- detection runs in a sync hook + sync audit script; needs typed string stdout, no async.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { findInvocation } from './shell-command.mts'

export type PkgManagerPlatform = 'darwin' | 'linux' | 'win32' | 'all'

export interface AutoUpdateStatus {
  // The manager id (matches AutoUpdateCheck.id).
  id: string
  // 'disabled' = auto-update is off (good); 'enabled' = on (drift, blockable);
  // 'absent' = the manager isn't installed/configured on this machine, so the
  // check is not applicable (never blocks, never fails CI).
  state: 'disabled' | 'enabled' | 'absent'
  // One-line explanation of what was read.
  reason: string
  // Imperative fix the operator runs to disable auto-update.
  fix: string
}

export interface AutoUpdateCheck {
  // Stable id, e.g. 'homebrew'.
  id: string
  // Binary names whose Bash invocation should be guarded.
  binaries: readonly string[]
  // Platforms this manager runs on; 'all' = every platform.
  platform: PkgManagerPlatform
  // Imperative fix string surfaced to the operator.
  fix: string
  // Read current machine state. Pure-ish: only reads env / files / `<mgr>
  // config`. Never mutates.
  detect: () => AutoUpdateStatus
}

// Resolve an env var to its trimmed value, treating empty as unset.
export function envValue(name: string): string | undefined {
  const v = process.env[name]
  return v === undefined || v === '' ? undefined : v
}

// True when an env var is set to a truthy "on" value (1 / true / yes).
export function envIsOn(name: string): boolean {
  const v = envValue(name)?.toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

// Run a binary with args and return trimmed stdout, or undefined when the
// binary is missing / the call exits non-zero (manager absent). Never throws.
// Takes an arg array (not a shell string) so no shell parsing / injection.
export function readCommand(
  binary: string,
  args: readonly string[],
): string | undefined {
  try {
    const result = spawnSync(binary, args as string[], { stdio: 'pipe' })
    if (result.status !== 0) {
      return undefined
    }
    const { stdout } = result
    return typeof stdout === 'string' ? stdout.trim() : String(stdout).trim()
  } catch {
    return undefined
  }
}

// True when `binary` resolves on PATH (manager installed). `command -v` is a
// shell builtin (not spawnable directly), so probe with the platform's PATH
// resolver binary: `where` on Windows, `which` elsewhere.
export function hasBinary(binary: string): boolean {
  return os.platform() === 'win32'
    ? readCommand('where', [binary]) !== undefined
    : readCommand('which', [binary]) !== undefined
}

export const AUTO_UPDATE_CHECKS: readonly AutoUpdateCheck[] = [
  {
    id: 'homebrew',
    binaries: ['brew'],
    platform: 'darwin',
    fix: 'export HOMEBREW_NO_AUTO_UPDATE=1 (run setup-security-tools to persist it to ~/.zshenv)',
    detect(): AutoUpdateStatus {
      if (!hasBinary('brew')) {
        return {
          id: 'homebrew',
          state: 'absent',
          reason: 'brew not on PATH',
          fix: this.fix,
        }
      }
      const on = envIsOn('HOMEBREW_NO_AUTO_UPDATE')
      return {
        id: 'homebrew',
        state: on ? 'disabled' : 'enabled',
        reason: on
          ? 'HOMEBREW_NO_AUTO_UPDATE is set'
          : 'HOMEBREW_NO_AUTO_UPDATE is unset — `brew install` triggers `brew update`',
        fix: this.fix,
      }
    },
  },
  {
    id: 'chocolatey',
    binaries: ['choco'],
    platform: 'win32',
    fix: 'choco feature disable -n autoUpdate',
    detect(): AutoUpdateStatus {
      if (!hasBinary('choco')) {
        return {
          id: 'chocolatey',
          state: 'absent',
          reason: 'choco not on PATH',
          fix: this.fix,
        }
      }
      // `choco feature list` prints e.g. "autoUpdate - [Disabled] ...".
      const out = readCommand('choco', ['feature', 'list', '-r']) ?? ''
      const line = out
        .split(/\r?\n/u)
        .find(l => l.toLowerCase().startsWith('autoupdate'))
      const disabled = line ? /disabled/iu.test(line) : false
      return {
        id: 'chocolatey',
        state: disabled ? 'disabled' : 'enabled',
        reason: disabled
          ? 'choco autoUpdate feature is disabled'
          : 'choco autoUpdate feature is enabled',
        fix: this.fix,
      }
    },
  },
  {
    id: 'winget',
    binaries: ['winget'],
    platform: 'win32',
    fix: 'set winget settings.json `"network": { "downloader": "wininet" }` and disable source auto-update (autoUpdateIntervalInMinutes: 0)',
    detect(): AutoUpdateStatus {
      if (!hasBinary('winget')) {
        return {
          id: 'winget',
          state: 'absent',
          reason: 'winget not on PATH',
          fix: this.fix,
        }
      }
      const localAppData = process.env['LOCALAPPDATA'] ?? ''
      const settingsPath = path.join(
        localAppData,
        'Packages',
        'Microsoft.DesktopAppInstaller_8wekyb3d8bbwe',
        'LocalState',
        'settings.json',
      )
      let interval: number | undefined
      if (localAppData && existsSync(settingsPath)) {
        try {
          const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
            source?: { autoUpdateIntervalInMinutes?: number } | undefined
          }
          interval = parsed.source?.autoUpdateIntervalInMinutes
        } catch {}
      }
      const disabled = interval === 0
      return {
        id: 'winget',
        state: disabled ? 'disabled' : 'enabled',
        reason: disabled
          ? 'winget source auto-update interval is 0'
          : 'winget source auto-update interval is non-zero or unset',
        fix: this.fix,
      }
    },
  },
  {
    id: 'scoop',
    binaries: ['scoop'],
    platform: 'win32',
    fix: 'remove any scheduled `scoop update` task (Task Scheduler) and avoid `scoop update` in cron/CI',
    detect(): AutoUpdateStatus {
      if (!hasBinary('scoop')) {
        return {
          id: 'scoop',
          state: 'absent',
          reason: 'scoop not on PATH',
          fix: this.fix,
        }
      }
      // Scoop has no install-time auto-update; the drift is a scheduled
      // `scoop update` task. Look for one; absence = disabled.
      const tasks = readCommand('schtasks', ['/query', '/fo', 'csv']) ?? ''
      const hasTask = /scoop\s+update/iu.test(tasks)
      return {
        id: 'scoop',
        state: hasTask ? 'enabled' : 'disabled',
        reason: hasTask
          ? 'a scheduled `scoop update` task exists'
          : 'no scheduled `scoop update` task',
        fix: this.fix,
      }
    },
  },
  {
    id: 'npm',
    binaries: ['npm'],
    platform: 'all',
    fix: 'npm config set update-notifier false (or export NO_UPDATE_NOTIFIER=1)',
    detect(): AutoUpdateStatus {
      if (!hasBinary('npm')) {
        return { id: 'npm', state: 'absent', reason: 'npm not on PATH', fix: this.fix }
      }
      if (envIsOn('NO_UPDATE_NOTIFIER')) {
        return {
          id: 'npm',
          state: 'disabled',
          reason: 'NO_UPDATE_NOTIFIER is set',
          fix: this.fix,
        }
      }
      const cfg = readCommand('npm', ['config', 'get', 'update-notifier'])
      const disabled = cfg === 'false'
      return {
        id: 'npm',
        state: disabled ? 'disabled' : 'enabled',
        reason: disabled
          ? 'npm update-notifier is false'
          : 'npm update-notifier is not false',
        fix: this.fix,
      }
    },
  },
  {
    id: 'pnpm',
    binaries: ['pnpm'],
    platform: 'all',
    fix: 'export NO_UPDATE_NOTIFIER=1 (pnpm honors it)',
    detect(): AutoUpdateStatus {
      if (!hasBinary('pnpm')) {
        return { id: 'pnpm', state: 'absent', reason: 'pnpm not on PATH', fix: this.fix }
      }
      const disabled = envIsOn('NO_UPDATE_NOTIFIER')
      return {
        id: 'pnpm',
        state: disabled ? 'disabled' : 'enabled',
        reason: disabled
          ? 'NO_UPDATE_NOTIFIER is set'
          : 'NO_UPDATE_NOTIFIER is unset',
        fix: this.fix,
      }
    },
  },
]

// True when `name` (a platform string) applies to the current OS.
export function platformApplies(platform: PkgManagerPlatform): boolean {
  return platform === 'all' || platform === os.platform()
}

// The blanket bypass phrase that suppresses the guard for ALL managers.
export const BLANKET_BYPASS_PHRASE = 'Allow package-manager-auto-update bypass'

// The bypass phrases that authorize skipping the check for one manager: the
// blanket phrase OR a per-manager phrase `Allow <noun> auto-update bypass`
// (e.g. `Allow brew auto-update bypass`, `Allow homebrew auto-update bypass`).
// Per-manager lets an operator green one manager without disabling the guard
// for the rest. Both the id and the binary names are accepted nouns.
export function bypassPhrasesFor(check: AutoUpdateCheck): string[] {
  const nouns = [check.id, ...check.binaries]
  const phrases = [BLANKET_BYPASS_PHRASE]
  const seen = new Set<string>()
  for (let i = 0, { length } = nouns; i < length; i += 1) {
    const noun = nouns[i]!
    if (!seen.has(noun)) {
      seen.add(noun)
      phrases.push(`Allow ${noun} auto-update bypass`)
    }
  }
  return phrases
}

// The check whose binary the command invokes, if any (AST-matched, no regex).
// Used by the guard to map a Bash command → the manager to verify.
export function matchInvokedManager(
  command: string,
): AutoUpdateCheck | undefined {
  for (let i = 0, { length } = AUTO_UPDATE_CHECKS; i < length; i += 1) {
    const check = AUTO_UPDATE_CHECKS[i]!
    for (let j = 0, blen = check.binaries.length; j < blen; j += 1) {
      if (findInvocation(command, { binary: check.binaries[j]! })) {
        return check
      }
    }
  }
  return undefined
}

// Run every check that applies to the current platform. Used by the audit
// script; 'absent' results are informational (never a drift failure).
export function auditCurrentPlatform(): AutoUpdateStatus[] {
  const results: AutoUpdateStatus[] = []
  for (let i = 0, { length } = AUTO_UPDATE_CHECKS; i < length; i += 1) {
    const check = AUTO_UPDATE_CHECKS[i]!
    if (platformApplies(check.platform)) {
      results.push(check.detect())
    }
  }
  return results
}
