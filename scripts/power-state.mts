/**
 * @fileoverview Detect whether the host is currently on AC power
 * (vs battery). Used by long-running build/test scripts to size
 * timeouts adaptively — laptops on battery throttle CPU hard
 * (especially macOS), and a static timeout that fits AC will kill
 * an otherwise-healthy run on battery.
 *
 * Two paths, in priority order:
 *
 *   1. `node:smol-power` — when running inside a node-smol binary
 *      that ships the smol_power native binding (socket-btm's custom
 *      Node distribution). Pure C++ syscalls, sub-millisecond.
 *
 *   2. Shellout fallback — system Node doesn't have node:smol-power.
 *      Each platform has a different mechanism:
 *        * macOS:   `pmset -g batt` parses "AC Power" / "Battery Power"
 *        * Linux:   reads /sys/class/power_supply/<entry>/online
 *                   (no shellout, just open/read syscalls)
 *        * Windows: PowerShell `Get-CimInstance Win32_Battery`
 *
 * On detection failure we conservatively assume AC — the downstream
 * timeout becomes the shorter / more aggressive value, which is
 * appropriate for build servers and headless CI (those environments
 * are expected to run at full speed).
 *
 * Returns a Promise so callers don't block the event loop on shellout
 * paths.
 *
 * Byte-identical across the fleet via socket-wheelhouse's
 * sync-scaffolding (IDENTICAL_FILES).
 */

import { Buffer } from 'node:buffer'
import { existsSync, promises as fs } from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import { spawn } from '@socketsecurity/lib/spawn'

// Probe for node:smol-power. Lives in socket-btm's node-smol binary
// — `isBuiltin()` returns true on those builds and false on system
// Node, so we only attempt the dynamic import when the module is
// actually available.
interface SmolPower {
  isOnAcPower: () => boolean
}
let _smolPower: SmolPower | undefined
let _smolPowerProbed = false
export async function detectLinux(): Promise<boolean> {
  // Linux exposes power state under /sys/class/power_supply. Each
  // AC adapter is its own dir (`AC`, `ADP1`, `AC0`, `ACAD`, …)
  // with an `online` file holding "1" when power is connected.
  // Containers and headless servers often have no power_supply
  // tree at all — treat that as AC since those environments are
  // expected to run at full speed.
  const psDir = '/sys/class/power_supply'
  if (!existsSync(psDir)) {
    return true
  }
  try {
    const entries = await fs.readdir(psDir)
    for (const entry of entries) {
      const onlineFile = path.join(psDir, entry, 'online')
      if (!existsSync(onlineFile)) {
        continue
      }
      try {
        const value = await fs.readFile(onlineFile, 'utf8')
        if (value.trim() === '1') {
          return true
        }
      } catch {
        // Unreadable entry — skip; another entry may report.
      }
    }
  } catch {
    // Directory enumeration failed — fall through to AC.
    return true
  }
  return false
}

async function detectMacOs(): Promise<boolean> {
  try {
    // `pmset -g batt` on macOS prints lines like
    //   Now drawing from 'AC Power'
    //   Now drawing from 'Battery Power'
    // Match the AC variant; everything else (battery, unknown) is
    // treated as not-AC.
    const result = await spawn('pmset', ['-g', 'batt'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return /AC Power/.test(stdoutString(result.stdout))
  } catch {
    return true
  }
}

async function detectWindows(): Promise<boolean> {
  try {
    // Windows: query the battery status via PowerShell + CIM.
    // `Win32_Battery.BatteryStatus`:
    //   1 = Discharging        (battery)
    //   2 = On AC, not charging or fully charged
    //   3..5 = Various battery states
    //   6 = AC + charging
    // Desktops with no battery return an empty result; treat as AC.
    const result = await spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '(Get-CimInstance -ClassName Win32_Battery).BatteryStatus',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const trimmed = stdoutString(result.stdout).trim()
    if (trimmed === '') {
      return true
    }
    const status = Number.parseInt(trimmed, 10)
    if (Number.isNaN(status)) {
      return true
    }
    return status === 2 || status === 6
  } catch {
    return true
  }
}

async function getSmolPower(): Promise<SmolPower | undefined> {
  if (_smolPowerProbed) {
    return _smolPower
  }
  _smolPowerProbed = true
  if (!isBuiltin('node:smol-power')) {
    return undefined
  }
  // Cast through `unknown` because system Node's typings don't
  // declare the module — only node-smol's lib.d.ts does.
  _smolPower = (await import(
    'node:smol-power' as string
  )) as unknown as SmolPower
  return _smolPower
}

// Coerce spawn's stdout (string | Buffer | undefined) to a string.
function stdoutString(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('utf8')
  }
  return ''
}

/**
 * Returns `true` if the host is on AC power. Conservative on
 * detection failure (returns `true`) — callers using this for
 * timeout sizing prefer a longer timeout to a too-short one.
 *
 * Prefers the native binding (`node:smol-power`) when running
 * inside a node-smol binary; falls back to a per-platform path
 * (shellout on macOS / Windows, direct sysfs reads on Linux) on
 * system Node.
 */
export async function isOnAcPower(): Promise<boolean> {
  const native = await getSmolPower()
  if (native) {
    return native.isOnAcPower()
  }
  if (process.platform === 'darwin') {
    return await detectMacOs()
  }
  if (process.platform === 'linux') {
    return await detectLinux()
  }
  if (process.platform === 'win32') {
    return await detectWindows()
  }
  // Unsupported platform; conservative default.
  return true
}
