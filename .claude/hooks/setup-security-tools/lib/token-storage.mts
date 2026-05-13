/**
 * @fileoverview Cross-platform secure storage for the Socket API token.
 *
 * Wraps each OS's native credential store:
 *
 *   macOS    → `security add-generic-password` / `find-generic-password`
 *              (Keychain Access).
 *   Linux    → `secret-tool store` / `secret-tool lookup` (libsecret).
 *   Windows  → `cmdkey /add` plus PowerShell readback via `Get-StoredCredential`
 *              (CredentialManager module). Falls back to `DPAPI`-encrypted
 *              file under `%APPDATA%\\socket-cli\\token.enc` when neither
 *              CredentialManager module nor cmdkey-readback is available.
 *
 * The token is stored under service name `socket-cli` with account
 * `SOCKET_API_TOKEN` so it co-exists with other Socket credentials
 * (e.g. CLI-managed publish tokens) without collision.
 *
 * **Never read from or write to a plain file.** The point of this
 * module is to keep the token off the filesystem entirely. The
 * fallback DPAPI file on Windows is encrypted under the user's
 * machine key — still not plaintext.
 *
 * Returned values are the raw token string or `undefined`. Errors
 * during read are silent (returns undefined); errors during write
 * throw so the caller can surface why persistence failed.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import path from 'node:path'

const SERVICE = 'socket-cli'
const ACCOUNT = 'SOCKET_API_TOKEN'

type Platform = 'darwin' | 'linux' | 'win32' | 'other'

function detectPlatform(): Platform {
  const p = platform()
  if (p === 'darwin' || p === 'linux' || p === 'win32') {
    return p
  }
  return 'other'
}

/**
 * Read the token from the platform's secure store. Returns undefined
 * when the entry doesn't exist OR when the underlying tool isn't on
 * PATH — read paths never throw, so callers can fall through to the
 * next source (env, .env, prompt) cleanly.
 */
export function readTokenFromKeychain(): string | undefined {
  switch (detectPlatform()) {
    case 'darwin':
      return readMacOS()
    case 'linux':
      return readLinux()
    case 'win32':
      return readWindows()
    default:
      return undefined
  }
}

/**
 * Persist the token to the platform's secure store. Throws on write
 * failure — the caller is in a user-initiated setup flow and should
 * see why persistence failed, not silently continue.
 */
export function writeTokenToKeychain(token: string): void {
  if (!token || typeof token !== 'string') {
    throw new TypeError('writeTokenToKeychain: token must be a non-empty string')
  }
  switch (detectPlatform()) {
    case 'darwin':
      writeMacOS(token)
      return
    case 'linux':
      writeLinux(token)
      return
    case 'win32':
      writeWindows(token)
      return
    default:
      throw new Error(
        `Unsupported platform: ${platform()}. ` +
          'Token storage requires macOS, Linux, or Windows.',
      )
  }
}

/**
 * Remove the token from the platform's secure store. Idempotent —
 * succeeds whether the entry exists or not.
 */
export function deleteTokenFromKeychain(): void {
  switch (detectPlatform()) {
    case 'darwin':
      deleteMacOS()
      return
    case 'linux':
      deleteLinux()
      return
    case 'win32':
      deleteWindows()
      return
    default:
      return
  }
}

// ── macOS ────────────────────────────────────────────────────────────

function readMacOS(): string | undefined {
  // `-s service -a account -w` prints the password to stdout.
  // Non-zero exit when the entry doesn't exist.
  const r = spawnSync(
    'security',
    ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (r.status !== 0) {
    return undefined
  }
  const out = r.stdout.trim()
  return out || undefined
}

function writeMacOS(token: string): void {
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
      ACCOUNT,
      '-w',
      token,
      '-T',
      '', // -T '' allows any app to read; we don't want a per-app ACL
      '-D',
      'Socket API token',
      '-l',
      'Socket API token',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (r.status !== 0) {
    throw new Error(
      `security(1) add-generic-password failed (exit ${r.status}): ${r.stderr.trim()}`,
    )
  }
}

function deleteMacOS(): void {
  // Exit code 44 = entry not found, which is fine. Any other non-
  // zero is an error worth surfacing — but since delete is best-
  // effort we swallow it (a stale entry is annoying but not blocking).
  spawnSync(
    'security',
    ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT],
    { stdio: 'ignore' },
  )
}

// ── Linux (libsecret via secret-tool) ───────────────────────────────

function readLinux(): string | undefined {
  const r = spawnSync(
    'secret-tool',
    ['lookup', 'service', SERVICE, 'user', ACCOUNT],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (r.status !== 0) {
    // secret-tool exits 1 when the entry doesn't exist AND when the
    // command isn't on PATH — both map to "no token here, try the
    // next source." Don't try to distinguish.
    return undefined
  }
  const out = r.stdout.trim()
  return out || undefined
}

function writeLinux(token: string): void {
  // secret-tool reads the token from stdin so it never appears in
  // `ps` / `/proc/<pid>/cmdline`.
  const r = spawnSync(
    'secret-tool',
    [
      'store',
      '--label=Socket API token',
      'service',
      SERVICE,
      'user',
      ACCOUNT,
    ],
    {
      encoding: 'utf8',
      input: token,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  if (r.status !== 0) {
    throw new Error(
      `secret-tool store failed (exit ${r.status}): ${r.stderr.trim()}. ` +
        'Install libsecret-tools (apt install libsecret-tools / dnf install libsecret) ' +
        'or ensure a Secret Service provider (gnome-keyring, kwallet) is running.',
    )
  }
}

function deleteLinux(): void {
  spawnSync(
    'secret-tool',
    ['clear', 'service', SERVICE, 'user', ACCOUNT],
    { stdio: 'ignore' },
  )
}

// ── Windows ──────────────────────────────────────────────────────────

function readWindows(): string | undefined {
  // Try the CredentialManager PowerShell module first (clean
  // structured read). Falls back to the DPAPI file if the module
  // isn't installed.
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `try { (Get-StoredCredential -Target '${SERVICE}:${ACCOUNT}').Password | ConvertFrom-SecureString -AsPlainText } catch { exit 1 }`,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (ps.status === 0) {
    const out = ps.stdout.trim()
    if (out) {
      return out
    }
  }
  // Fallback: DPAPI-encrypted file (encrypted under the current
  // user's machine key — readable only by this user on this machine).
  return readWindowsDpapiFile()
}

function writeWindows(token: string): void {
  // Prefer CredentialManager PowerShell module — most idiomatic.
  // The token is passed via stdin to avoid leaking into command
  // history / ps output.
  const psScript = `
    $token = $input | Out-String
    $token = $token.Trim()
    $secure = ConvertTo-SecureString $token -AsPlainText -Force
    try {
      New-StoredCredential -Target '${SERVICE}:${ACCOUNT}' -UserName '${ACCOUNT}' -SecurePassword $secure -Persist LocalMachine | Out-Null
      exit 0
    } catch { exit 1 }
  `
  const ps = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', psScript],
    {
      encoding: 'utf8',
      input: token,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  if (ps.status === 0) {
    return
  }
  // Fallback: DPAPI-encrypted file. Used when the CredentialManager
  // module isn't installed (common on bare Windows; `Install-Module
  // CredentialManager` requires admin or a user-scope install).
  writeWindowsDpapiFile(token)
}

function deleteWindows(): void {
  // Try the PowerShell removal first, ignore failures.
  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `try { Remove-StoredCredential -Target '${SERVICE}:${ACCOUNT}' } catch {}`,
    ],
    { stdio: 'ignore' },
  )
  // Also remove the DPAPI file if present.
  const filePath = getWindowsDpapiFilePath()
  if (existsSync(filePath)) {
    try {
      // Don't import @socketsecurity/lib here — token-storage is
      // intentionally self-contained for the install bootstrap.
      // `fs.rmSync` is the dependency-free option.
      const { rmSync } = require('node:fs') as typeof import('node:fs')
      rmSync(filePath, { force: true })
    } catch {
      // best-effort
    }
  }
}

function getWindowsDpapiFilePath(): string {
  const appData = process.env['APPDATA'] ?? path.join(homedir(), 'AppData', 'Roaming')
  return path.join(appData, 'socket-cli', 'token.enc')
}

function readWindowsDpapiFile(): string | undefined {
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
  const ps = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', psScript],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (ps.status !== 0) {
    return undefined
  }
  const out = ps.stdout.trim()
  return out || undefined
}

function writeWindowsDpapiFile(token: string): void {
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
  const ps = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', psScript],
    {
      encoding: 'utf8',
      input: token,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  if (ps.status !== 0) {
    throw new Error(
      `DPAPI file write failed: ${ps.stderr.trim()}. ` +
        'Install the CredentialManager PowerShell module (' +
        '`Install-Module CredentialManager -Scope CurrentUser`) for a cleaner storage path.',
    )
  }
  // chmod-equivalent: NTFS ACLs default to user-only for AppData files
  // created this way, so no extra step needed.
}

/**
 * Diagnostic: report whether the platform's keychain tool is
 * available. Used by the install script to tell the operator
 * upfront if libsecret/CredentialManager need installing before
 * the prompt.
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
      return { available: true, toolName: 'security(1)', installHint: undefined }
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
        installHint: `Platform ${platform()} is not supported. Set SOCKET_API_TOKEN in your shell rc.`,
      }
  }
}

// Hide unused-import lint when readFileSync / writeFileSync aren't
// used (Windows-only fallback path). Reference them once at module
// scope so the bundler still tree-shakes correctly on non-Windows.
void readFileSync
void writeFileSync
