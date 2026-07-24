/**
 * @file Headroom-ai installer — the AI context-compression proxy that replaces
 *   the legacy socket-token-minifier. headroom-ai ships on PyPI; we pin it via
 *   a committed `headroom/pyproject.toml` + `headroom/uv.lock` (the [proxy]
 *   extra, no pytorch) and `uv sync --locked` the exact closure into the
 *   content- addressed `_dlx` hash store — never the project dir — so the
 *   install is fully `~/.socket/_dlx` contained and reuses the uv-managed
 *   CPython already there. Readable handles (rack alias + bin shim) layer over
 *   the hash, mirroring install-sfw.mts. Lives in its own file because
 *   installers.mts is at the 1000-line hard cap. The three-way pin (uv.lock +
 *   pyproject + external-tools.json version) is enforced by
 *   headroom-pin-is-consistent.mts.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { whichSync } from '@socketsecurity/lib-stable/bin/which'
import { generateCacheKey } from '@socketsecurity/lib-stable/dlx/cache'
import { ensureDlxDirSync } from '@socketsecurity/lib-stable/dlx/dir'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeMkdirSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import {
  getSocketDlxDir,
  getSocketWheelhouseDir,
} from '@socketsecurity/lib-stable/paths/socket'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The locked uv project sits beside this lib dir's parent (the hook root),
// next to external-tools.json: setup-security-tools then headroom.
export const HEADROOM_PROJECT_DIR = path.join(__dirname, '..', 'headroom')

// 🔒 TELEMETRY + MODEL-DOWNLOAD LOCKDOWN (see the telemetry audit report in
// the reports directory). headroom ships an anonymous
// telemetry beacon ENABLED BY DEFAULT (POSTs aggregate stats to a headroom
// Supabase) and fetches a compression model from HuggingFace on first use.
// These env settings disable BOTH at the source. The installed `bin/headroom`
// is a wrapper that exports them before exec'ing the venv entry, so EVERY
// invocation — including the proxy-start hook — is locked down, not just the
// ones that remember to opt out. The sfw CDN allowlist is the backstop.
export const HEADROOM_LOCKDOWN_ENV: Readonly<Record<string, string>> = {
  __proto__: null,
  // Kills the default-on Supabase telemetry beacon (beacon.py is_telemetry_enabled).
  HEADROOM_TELEMETRY: 'off',
  // Suppress the startup telemetry notice.
  HEADROOM_TELEMETRY_WARN: 'off',
  // No runtime HuggingFace model/tokenizer download (onnx_runtime.py local-first
  // fetch); the ONNX-Kompress text compressor degrades to a no-op rather than
  // phoning HuggingFace.
  HF_HUB_OFFLINE: '1',
} as unknown as Record<string, string>

// The security invariant the lockdown MUST satisfy: telemetry OFF and the model
// download OFF. Asserted at load time (fail-closed) so a future edit that drops
// either one fails the module import + the check, rather than silently
// re-enabling a phone-home. Paired with check/headroom-is-telemetry-locked-down.mts.
const REQUIRED_LOCKDOWN: Readonly<Record<string, string>> = {
  __proto__: null,
  HEADROOM_TELEMETRY: 'off',
  HF_HUB_OFFLINE: '1',
} as unknown as Record<string, string>

export function lockdownViolations(
  applied: Readonly<Record<string, string>>,
): string[] {
  const out: string[] = []
  const keys = Object.keys(REQUIRED_LOCKDOWN)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    const want = REQUIRED_LOCKDOWN[key]!
    if (applied[key] !== want) {
      out.push(
        `${key} must be "${want}" (telemetry/model phone-home); saw "${applied[key] ?? '(unset)'}"`,
      )
    }
  }
  return out
}

const SELF_VIOLATIONS = lockdownViolations(HEADROOM_LOCKDOWN_ENV)
if (SELF_VIOLATIONS.length) {
  throw new Error(
    `HEADROOM_LOCKDOWN_ENV weakened — headroom would phone home:\n  ${SELF_VIOLATIONS.join('\n  ')}`,
  )
}

// The POSIX wrapper script for `bin/headroom`: export the lockdown env, then
// exec the real venv entry. Pure (testable); the actual file write is
// writeLockdownWrapper.
export function lockdownWrapperScript(venvBin: string): string {
  const exports = Object.keys(HEADROOM_LOCKDOWN_ENV)
    .map(k => `export ${k}=${HEADROOM_LOCKDOWN_ENV[k]}`)
    .join('\n')
  return `#!/bin/sh\n${exports}\nexec "${venvBin}" "$@"\n`
}

// The Windows wrapper (`bin/headroom.cmd`): `set` the lockdown env, then call
// the venv entry forwarding all args.
export function lockdownWrapperScriptWin(venvBin: string): string {
  const sets = Object.keys(HEADROOM_LOCKDOWN_ENV)
    .map(k => `set ${k}=${HEADROOM_LOCKDOWN_ENV[k]}`)
    .join('\r\n')
  return `@echo off\r\n${sets}\r\n"${venvBin}" %*\r\n`
}

// Lock-step: LOCAL DUP of @socketsecurity/lib `getSocketRackToolDir`. The helper
// already lives in socket-lib (src/paths/socket.ts) but is NOT in the published
// lib-stable 6.0.8, so we vendor it here to avoid a lib-bump dependency — the
// `_dlx/<hash>` venv is fronted by a readable rack/<tool>/<version> handle, the
// 1-path-1-reference owner of a tool install destination. Byte-compatible with
// upstream; REPLACE this local def with the import once lib-stable ships it.
export function getSocketRackToolDir(config: {
  tool: string
  version: string
}): string {
  const cfg = { __proto__: null, ...config } as {
    tool: string
    version: string
  }
  return normalizePath(
    path.join(getSocketWheelhouseDir(), 'rack', cfg.tool, cfg.version),
  )
}

// The platform key used to content-address the install (a darwin-arm64 venv is
// not interchangeable with a linux-x64 one).
export function platformKey(): string {
  const os = process.platform === 'win32' ? 'win' : process.platform
  return `${os}-${process.arch}`
}

// The content-addressed dlx dir for a given headroom version + platform, keyed
// via the canonical lib helper (never a hand-rolled hash). Returns an absolute
// path under the `_dlx` store.
export function headroomDlxDir(version: string): string {
  const hash = generateCacheKey(`headroom-ai@${version}:proxy:${platformKey()}`)
  return path.join(getSocketDlxDir(), hash)
}

// The installed entry point inside the dlx-contained venv.
export function headroomVenvBin(version: string): string {
  const venv = path.join(headroomDlxDir(version), '.venv')
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'headroom.exe')
    : path.join(venv, 'bin', 'headroom')
}

// Verify the installed headroom reports the pinned version. Fail-closed: any
// error or a version mismatch means "not the right install".
export async function checkHeadroomVersion(
  binPath: string,
  version: string,
): Promise<boolean> {
  try {
    const result = await spawn(binPath, ['--version'], { stdio: 'pipe' })
    // `headroom --version` prints e.g. "headroom 0.24.0"; require the pinned
    // version to appear so a stale venv can't pass.
    return String(result.stdout).includes(version)
  } catch {
    return false
  }
}

// Refresh a symlink idempotently: lstat (not existsSync — it follows the link
// and would leave a stale broken link), delete if present, recreate.
async function refreshSymlink(
  target: string,
  linkPath: string,
  type: 'dir' | 'file',
): Promise<void> {
  // oxlint-disable-next-line socket/prefer-exists-sync -- lstat detects a broken symlink that existsSync (follows the link) would miss, leaving it stale.
  const linkExists = await fs
    .lstat(linkPath)
    .then(() => true)
    .catch(() => false)
  if (linkExists) {
    await safeDelete(linkPath)
  }
  await fs.symlink(target, linkPath, type)
}

// headroom-ai — installed from a LOCKED uv project into the content-addressed
// `_dlx` hash store. `uv sync --locked` installs the lock's exact closure (98
// packages, hashed) and hard-fails on lock drift. UV_PROJECT_ENVIRONMENT
// relocates the venv out of the project dir into the dlx hash dir, and
// UV_CACHE_DIR keeps the wheel cache `_dlx`-contained; the pyproject's
// `python-preference = "only-managed"` reuses the uv-managed CPython under
// `_dlx` (never a system Python).
//
// Requirements: uv on PATH (the bootstrap installs it). Fail-open OPTIONAL when
// uv is absent — matching setupSkillSpector.
export async function setupHeadroom(version: string): Promise<boolean> {
  logger.log('=== headroom-ai ===')
  if (!version) {
    logger.error('headroom entry in external-tools.json is missing `version`')
    return false
  }
  const pyproject = path.join(HEADROOM_PROJECT_DIR, 'pyproject.toml')
  const uvLock = path.join(HEADROOM_PROJECT_DIR, 'uv.lock')
  if (!existsSync(pyproject) || !existsSync(uvLock)) {
    logger.error('headroom uv project is missing its pyproject.toml/uv.lock')
    logger.error(`  where: ${HEADROOM_PROJECT_DIR}`)
    logger.error(
      '  fix:   restore the project files (run `uv lock` to rebuild)',
    )
    return false
  }

  const uvBin = whichSync('uv', { nothrow: true })
  if (!uvBin || typeof uvBin !== 'string') {
    logger.error('uv not on PATH. Run the from-scratch bootstrap first:')
    logger.error('  pnpm run setup    # installs uv (+ node, pnpm, sfw, …)')
    return false
  }

  ensureDlxDirSync()
  const dlxDir = headroomDlxDir(version)
  safeMkdirSync(dlxDir)
  const venvDir = path.join(dlxDir, '.venv')
  const cacheDir = path.join(getSocketDlxDir(), '_uv-cache')

  logger.log(`Syncing locked uv project (headroom-ai@${version}) → ${dlxDir}`)
  try {
    const result = await spawn(
      uvBin,
      ['sync', '--locked', '--project', HEADROOM_PROJECT_DIR],
      {
        env: {
          __proto__: null,
          ...process.env,
          ...HEADROOM_LOCKDOWN_ENV,
          UV_PROJECT_ENVIRONMENT: venvDir,
          UV_CACHE_DIR: cacheDir,
        } as unknown as Record<string, string>,
        stdio: 'pipe',
      },
    )
    const stdout = String(result.stdout).trim()
    if (stdout) {
      logger.log(stdout)
    }
  } catch (e) {
    logger.error(`uv sync --locked failed: ${errorMessage(e)}`)
    return false
  }

  const venvBin = headroomVenvBin(version)
  if (!existsSync(venvBin)) {
    logger.error('uv sync succeeded but the headroom entry point is absent.')
    logger.error(`  expected: ${venvBin}`)
    return false
  }
  if (!(await checkHeadroomVersion(venvBin, version))) {
    logger.error(`Installed but --version check failed: ${venvBin}`)
    return false
  }

  // Layer readable handles over the hash-named dlx venv (install-sfw pattern):
  //   1. rack alias: rack then headroom then version → the dlx hash dir.
  //   2. PATH handle: bin then headroom → a LOCKDOWN WRAPPER (not a bare
  //      symlink) that exports HEADROOM_LOCKDOWN_ENV then execs the venv entry,
  //      so telemetry + the HuggingFace model fetch are off for EVERY
  //      invocation — the proxy-start hook, manual runs, all of them. Refreshes
  //      on every install so a version bump repoints + re-locks.
  const wheelhouse = getSocketWheelhouseDir()
  const rackToolDir = getSocketRackToolDir({ tool: 'headroom', version })
  await fs.mkdir(path.dirname(rackToolDir), { recursive: true })
  await refreshSymlink(dlxDir, rackToolDir, 'dir')
  const binDir = path.join(wheelhouse, 'bin')
  await fs.mkdir(binDir, { recursive: true })
  const isWin = process.platform === 'win32'
  const binLink = path.join(binDir, isWin ? 'headroom.cmd' : 'headroom')
  // Replace any prior symlink/file before writing the wrapper.
  await safeDelete(binLink)
  await fs.writeFile(
    binLink,
    isWin ? lockdownWrapperScriptWin(venvBin) : lockdownWrapperScript(venvBin),
  )
  if (!isWin) {
    await fs.chmod(binLink, 0o755)
  }

  logger.log(
    `headroom-ai@${version} ready at ${binLink} (telemetry + model fetch locked off)`,
  )
  logger.log(`  → ${venvBin}`)
  return true
}
