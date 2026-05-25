/**
 * @file Cross-platform secure storage for the Socket API token. Wraps each OS's
 *   native credential store: macOS → `security add-generic-password` /
 *   `find-generic-password` (Keychain Access). Linux → `secret-tool store` /
 *   `secret-tool lookup` (libsecret). Windows → `cmdkey /add` plus PowerShell
 *   readback via `Get-StoredCredential` (CredentialManager module). Falls back
 *   to `DPAPI`-encrypted file under `%APPDATA%\\socket-cli\\token.enc` when
 *   neither CredentialManager module nor cmdkey-readback is available. The
 *   token is stored under service name `socket-cli` with account
 *   `SOCKET_API_KEY` so it co-exists with other Socket credentials (e.g.
 *   CLI-managed publish tokens) without collision. **Never read from or write
 *   to a plain file.** The point of this module is to keep the token off the
 *   filesystem entirely. The fallback DPAPI file on Windows is encrypted under
 *   the user's machine key — still not plaintext. Returned values are the raw
 *   token string or `undefined`. Errors during read are silent (returns
 *   undefined); errors during write throw so the caller can surface why
 *   persistence failed.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SERVICE = 'socket-cli'

// Keychain account names. SOCKET_API_KEY is the primary slot we read + write
// (universally supported across Socket tools — CLI, SDK, sfw, fleet scripts).
// SOCKET_API_TOKEN appears in DELETE_SLOTS only, to purge stale entries from
// older hook versions that mirrored the value to both slots. Each
// `security add-generic-password` call on macOS triggers a Keychain auth
// prompt, so we write one slot to keep rotation to a single prompt.
const WRITE_SLOTS = ['SOCKET_API_KEY'] as const
const READ_SLOTS = ['SOCKET_API_KEY'] as const
const DELETE_SLOTS = ['SOCKET_API_KEY', 'SOCKET_API_TOKEN'] as const

export function deleteLinux(account: string): void {
  spawnSync('secret-tool', ['clear', 'service', SERVICE, 'user', account], {
    stdio: 'ignore',
  })
}

export function deleteMacOS(account: string): void {
  // Exit code 44 = entry not found, which is fine. Any other non-
  // zero is an error worth surfacing — but since delete is best-
  // effort we swallow it (a stale entry is annoying but not blocking).
  spawnSync(
    'security',
    ['delete-generic-password', '-s', SERVICE, '-a', account],
    { stdio: 'ignore' },
  )
}

/**
 * Remove the token from the platform's secure store. Idempotent — succeeds
 * whether the entry exists or not. Clears both the primary account
 * (`SOCKET_API_KEY`) and the forward-canonical mirror (`SOCKET_API_TOKEN`), so
 * a rotate/wipe purges stale entries left by older versions of this hook that
 * mirrored to both slots.
 */
export function deleteTokenFromKeychain(): void {
  const platform_ = detectPlatform()
  for (let i = 0, { length } = DELETE_SLOTS; i < length; i += 1) {
    const slot = DELETE_SLOTS[i]!
    switch (platform_) {
      case 'darwin':
        deleteMacOS(slot)
        break
      case 'linux':
        deleteLinux(slot)
        break
      case 'win32':
        deleteWindows(slot)
        break
      default:
        return
    }
  }
}

export function deleteWindows(account: string): void {
  // Try the PowerShell removal first, ignore failures.
  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `try { Remove-StoredCredential -Target '${SERVICE}:${account}' } catch {}`,
    ],
    { stdio: 'ignore' },
  )
  // Also remove the DPAPI file if present.
  const filePath = getWindowsDpapiFilePath()
  if (existsSync(filePath)) {
    try {
      rmSync(filePath, { force: true })
    } catch {
      // best-effort
    }
  }
}

type Platform = 'darwin' | 'linux' | 'win32' | 'other'

export function detectPlatform(): Platform {
  const p = os.platform()
  if (p === 'darwin' || p === 'linux' || p === 'win32') {
    return p
  }
  return 'other'
}

export function getWindowsDpapiFilePath(): string {
  const appData =
    process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(appData, 'socket-cli', 'token.enc')
}

/**
 * Diagnostic: report whether the platform's keychain tool is available. Used by
 * the install script to tell the operator upfront if
 * libsecret/CredentialManager need installing before the prompt.
 */
export function keychainAvailable(): {
  available: boolean
  toolName: string
  installHint: string | undefined
} {
  const p = detectPlatform()
  switch (p) {
    case 'darwin': {
      // security(1) ships with macOS — always present.
      return {
        available: true,
        toolName: 'security(1)',
        installHint: undefined,
      }
    }
    case 'linux': {
      const r = spawnSync('secret-tool', ['--version'], { stdio: 'ignore' })
      return r.status === 0
        ? { available: true, toolName: 'secret-tool', installHint: undefined }
        : {
            available: false,
            toolName: 'secret-tool',
            installHint:
              'apt install libsecret-tools  (Debian/Ubuntu) | ' +
              'dnf install libsecret  (Fedora/RHEL)',
          }
    }
    case 'win32': {
      // PowerShell is always present on Windows 10+.
      return {
        available: true,
        toolName: 'PowerShell (CredentialManager / DPAPI)',
        installHint: undefined,
      }
    }
    default:
      return {
        available: false,
        toolName: 'n/a',
        installHint: `Platform ${os.platform()} is not supported. Set SOCKET_API_KEY in your shell rc.`,
      }
  }
}

export function readLinux(account: string): string | undefined {
  const r = spawnSync(
    'secret-tool',
    ['lookup', 'service', SERVICE, 'user', account],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (r.status !== 0) {
    // secret-tool exits 1 when the entry doesn't exist AND when the
    // command isn't on PATH — both map to "no token here, try the
    // next source." Don't try to distinguish.
    return undefined
  }
  const out = String(r.stdout).trim()
  return out || undefined
}

export function readMacOS(account: string): string | undefined {
  // `-s service -a account -w` prints the password to stdout.
  // Non-zero exit when the entry doesn't exist.
  const r = spawnSync(
    'security',
    ['find-generic-password', '-s', SERVICE, '-a', account, '-w'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (r.status !== 0) {
    return undefined
  }
  const out = String(r.stdout).trim()
  return out || undefined
}

/**
 * Read the token from the platform's secure store. Returns undefined when the
 * entry doesn't exist OR when the underlying tool isn't on PATH — read paths
 * never throw, so callers can fall through to the next source (env, .env,
 * prompt) cleanly.
 *
 * Reads the primary `SOCKET_API_KEY` slot only. One stored slot, one read, one
 * macOS Keychain ACL check.
 */
export function readTokenFromKeychain(): string | undefined {
  const platform_ = detectPlatform()
  for (let i = 0, { length } = READ_SLOTS; i < length; i += 1) {
    const slot = READ_SLOTS[i]!
    let value: string | undefined
    switch (platform_) {
      case 'darwin':
        value = readMacOS(slot)
        break
      case 'linux':
        value = readLinux(slot)
        break
      case 'win32':
        value = readWindows(slot)
        break
      default:
        return undefined
    }
    if (value) {
      return value
    }
  }
  return undefined
}

export function readWindows(account: string): string | undefined {
  // Try the CredentialManager PowerShell module first (clean
  // structured read). Falls back to the DPAPI file if the module
  // isn't installed.
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `try { (Get-StoredCredential -Target '${SERVICE}:${account}').Password | ConvertFrom-SecureString -AsPlainText } catch { exit 1 }`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (ps.status === 0) {
    const out = String(ps.stdout).trim()
    if (out) {
      return out
    }
  }
  // Fallback: DPAPI-encrypted file (encrypted under the current
  // user's machine key — readable only by this user on this machine).
  // The DPAPI file uses one filename regardless of slot; we only fall
  // back when the CredentialManager read missed entirely, so a single
  // file is enough.
  return readWindowsDpapiFile()
}

export function readWindowsDpapiFile(): string | undefined {
  const filePath = getWindowsDpapiFilePath()
  if (!existsSync(filePath)) {
    return undefined
  }
  // Decrypt via DPAPI (System.Security.Cryptography.ProtectedData).
  // The file holds base64(DPAPI-protected UTF8(token)).
  const psScript = `
    $bytes = [Convert]::FromBase64String((Get-Content -Raw '${filePath.replace(/'/g, "''")}'))
    $plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser')
    [System.Text.Encoding]::UTF8.GetString($plain)
  `
  const ps = spawnSync('powershell', ['-NoProfile', '-Command', psScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (ps.status !== 0) {
    return undefined
  }
  const out = String(ps.stdout).trim()
  return out || undefined
}

export function writeLinux(token: string, account: string): void {
  // secret-tool reads the token from stdin so it never appears in
  // `ps` / `/proc/<pid>/cmdline`.
  const r = spawnSync(
    'secret-tool',
    ['store', '--label=Socket API token', 'service', SERVICE, 'user', account],
    {
      input: token,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  if (r.status !== 0) {
    throw new Error(
      `secret-tool store failed (exit ${r.status}, user=${account}): ${String(r.stderr).trim()}. ` +
        'Install libsecret-tools (apt install libsecret-tools / dnf install libsecret) ' +
        'or ensure a Secret Service provider (gnome-keyring, kwallet) is running.',
    )
  }
}

export function writeMacOS(token: string, account: string): void {
  // `-U` updates the entry if it already exists; without -U a second
  // `add-generic-password` call would error.
  const r = spawnSync(
    'security',
    [
      'add-generic-password',
      '-U',
      '-s',
      SERVICE,
      '-a',
      account,
      '-w',
      token,
      '-T',
      '', // -T '' allows any app to read; we don't want a per-app ACL
      '-D',
      'Socket API token',
      '-l',
      'Socket API token',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (r.status !== 0) {
    throw new Error(
      `security(1) add-generic-password failed (exit ${r.status}, account=${account}): ${String(r.stderr).trim()}`,
    )
  }
}

/**
 * Persist the token to the platform's secure store. Throws on write failure —
 * the caller is in a user-initiated setup flow and should see why persistence
 * failed, not silently continue.
 *
 * Writes the token under the primary account (`SOCKET_API_KEY`) only. Every
 * Socket tool reads SOCKET_API_KEY without a fallback chain, so one stored slot
 * covers the whole surface — and one slot keeps macOS rotation to a single
 * Keychain auth prompt.
 */
export function writeTokenToKeychain(token: string): void {
  if (!token || typeof token !== 'string') {
    throw new TypeError(
      'writeTokenToKeychain: token must be a non-empty string',
    )
  }
  const platform_ = detectPlatform()
  if (platform_ === 'other') {
    throw new Error(
      `Unsupported platform: ${os.platform()}. ` +
        'Token storage requires macOS, Linux, or Windows.',
    )
  }
  for (let i = 0, { length } = WRITE_SLOTS; i < length; i += 1) {
    const slot = WRITE_SLOTS[i]!
    switch (platform_) {
      case 'darwin':
        writeMacOS(token, slot)
        break
      case 'linux':
        writeLinux(token, slot)
        break
      case 'win32':
        writeWindows(token, slot)
        break
    }
  }
}

export function writeWindows(token: string, account: string): void {
  // Prefer CredentialManager PowerShell module — most idiomatic.
  // The token is passed via stdin to avoid leaking into command
  // history / ps output.
  const psScript = `
    $token = $input | Out-String
    $token = $token.Trim()
    $secure = ConvertTo-SecureString $token -AsPlainText -Force
    try {
      New-StoredCredential -Target '${SERVICE}:${account}' -UserName '${account}' -SecurePassword $secure -Persist LocalMachine | Out-Null
      exit 0
    } catch { exit 1 }
  `
  const ps = spawnSync('powershell', ['-NoProfile', '-Command', psScript], {
    input: token,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (ps.status === 0) {
    return
  }
  // Fallback: DPAPI-encrypted file. Used when the CredentialManager
  // module isn't installed (common on bare Windows; `Install-Module
  // CredentialManager` requires admin or a user-scope install). The
  // file is written once on the canonical slot's pass; the legacy
  // slot's pass also calls this but writeWindowsDpapiFile rewrites
  // the same file with the same value, so the second call is a no-op
  // in effect.
  writeWindowsDpapiFile(token)
}

export function writeWindowsDpapiFile(token: string): void {
  const filePath = getWindowsDpapiFilePath()
  const dir = path.dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const psScript = `
    $token = $input | Out-String
    $token = $token.Trim()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($token)
    $protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')
    [Convert]::ToBase64String($protected) | Set-Content -Path '${filePath.replace(/'/g, "''")}' -NoNewline
  `
  const ps = spawnSync('powershell', ['-NoProfile', '-Command', psScript], {
    input: token,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (ps.status !== 0) {
    throw new Error(
      `DPAPI file write failed: ${String(ps.stderr).trim()}. ` +
        'Install the CredentialManager PowerShell module (' +
        '`Install-Module CredentialManager -Scope CurrentUser`) for a cleaner storage path.',
    )
  }
  // chmod-equivalent: NTFS ACLs default to user-only for AppData files
  // created this way, so no extra step needed.
}

// Hide unused-import lint when readFileSync / writeFileSync aren't
// used (Windows-only fallback path). Reference them once at module
// scope so the bundler still tree-shakes correctly on non-Windows.
void readFileSync
void writeFileSync
