#!/usr/bin/env node
/**
 * @file Install Socket Firewall (sfw) into the Socket _dlx cache via
 *
 * @socketsecurity/lib-stable's downloadBinary helper. Matches the CI install
 *   path: same version source, same binary integrity check (SRI-verified inline,
 *   same on-disk layout (~/.socket/_dlx/<hash>/sfw — the content-addressed
 *   binary store). Two dev-only handles layer readable paths over that hash:
 *   a rack alias `~/.socket/_wheelhouse/rack/sfw/<version>` → the _dlx dir, and
 *   the PATH handle `~/.socket/_wheelhouse/bin/sfw` → the rack alias. So PATH
 *   never sees the hash; consumers reference the stable readable rack path.
 *
 *   Detects + migrates a pre-existing ~/.socket/sfw/ install in place on first
 *   run (rename to ~/.socket/_wheelhouse/). The `_` prefix matches the npm /
 *   lib-stable convention for "managed internal cache" (compare to _dlx,
 *   _cacache, etc.) — `sfw/` was the lone non-prefixed sibling, now
 *   regularized.
 *
 *   Reads version + per-platform integrity (SRI) from the repo's root
 *   `external-tools.json` under `tools.sfw-free` / `tools.sfw-enterprise`.
 *   That file is the single fleet source of truth — every consumer of
 *   external tooling reads the same entries. Usage: pnpm run install:sfw #
 *   free flavor pnpm run install:sfw -- --enterprise # requires
 *   SOCKET_API_KEY (or SOCKET_API_TOKEN) pnpm run install:sfw -- --force #
 *   ignore cache, redownload pnpm run install:sfw -- --quiet.
 */

import {
  existsSync,
  promises as fsPromises,
  readFileSync,
  renameSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { getArch, WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { downloadBinary } from '@socketsecurity/lib-stable/dlx/binary'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete, safeMkdirSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import {
  getSocketAppDir,
  getUserHomeDir,
} from '@socketsecurity/lib-stable/paths/socket'

import { REPO_ROOT } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

const EXTERNAL_TOOLS_PATH = path.join(REPO_ROOT, 'external-tools.json')

// Resolve the user-home wheelhouse umbrella via the canonical lib-stable
// helper (getSocketAppDir('wheelhouse') → ~/.socket/_wheelhouse/). Cross-
// platform via getUserHomeDir() which handles HOME / USERPROFILE / fallback.
const WHEELHOUSE_DIR = getSocketAppDir('wheelhouse')
const WHEELHOUSE_BIN_DIR = path.join(WHEELHOUSE_DIR, 'bin')
// rack/ is the readable alias layer over the hash-named _dlx store: a real
// binary lives at _dlx/<hash>/sfw, rack/sfw/<version> symlinks to that dir, and
// bin/sfw → rack/sfw/<version>/sfw. Lock-step with @socketsecurity/lib
// src/paths/socket.ts getSocketRackToolDir({tool,version}) (constructed here
// rather than imported until the lib-stable bump ships the helper).
const WHEELHOUSE_RACK_DIR = path.join(WHEELHOUSE_DIR, 'rack')
// One-time migration: if a pre-rename ~/.socket/sfw/ install exists AND the
// new ~/.socket/_wheelhouse/ doesn't, rename the directory in place. Keeps
// existing shims valid (each will be regenerated on next setup pass to point
// at the new path). Idempotent: skips when either condition fails. Older
// fleet machines won't break across the rename.
const LEGACY_SFW_DIR = path.join(getUserHomeDir(), '.socket', 'sfw')

const SFW_BIN_DIR = WHEELHOUSE_BIN_DIR

// Migrate a pre-rename legacy install in place, then ensure the expected
// subdir layout exists. Called from main() (never at import time) so
// importing this module for its pure helpers never touches the filesystem.
// safeMkdirSync is recursive + EEXIST-safe by default.
export function ensureWheelhouseLayout(): void {
  if (existsSync(LEGACY_SFW_DIR) && !existsSync(WHEELHOUSE_DIR)) {
    logger.log(`Migrating legacy ${LEGACY_SFW_DIR} → ${WHEELHOUSE_DIR}…`)
    renameSync(LEGACY_SFW_DIR, WHEELHOUSE_DIR)
  }
  safeMkdirSync(WHEELHOUSE_BIN_DIR)
}

interface ToolEntry {
  version: string
  repository?: string | undefined
  release?: string | undefined
  platforms?: Record<string, { asset: string; integrity: string }> | undefined
}

const SUPPORTED_SRI_RE = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/

/**
 * Validate the Subresource Integrity string the canonical fleet
 * external-tools.json uses and return it UNCHANGED. downloadBinary verifies the
 * raw SRI natively across sha-2 variants, so the whole pipeline passes the SRI
 * through rather than pre-decoding to a bare sha256 hex — which is why the sfw
 * assets' `sha512-` pins now install instead of being rejected (the old
 * sha256-only decoder threw on anything but sha256, stranding sfw at whatever
 * stale build was last installed and, with it, a proxy CA the client no longer
 * trusts — `tlsv1 alert unknown ca`). Single-source-of-truth schema:
 * socket-btm/packages/build-infra/lib/external-tools-schema.json.
 */
export function assertIntegrity(integrity: string): string {
  if (!SUPPORTED_SRI_RE.test(integrity)) {
    throw new Error(
      `Unsupported integrity in external-tools.json (expected sha256-/sha384-/sha512-<base64>): ${integrity}`,
    )
  }
  return integrity
}

export interface ExternalToolsFile {
  tools: Record<string, ToolEntry>
}

export interface ResolvedSfwTool {
  binaryName: string
  entry: ToolEntry
  platform: string
  integrity: string
  toolKey: string
  url: string
  version: string
}

export type ResolveSfwToolResult =
  | { ok: true; value: ResolvedSfwTool }
  | { ok: false; error: string }

// Resolve the tool entry + platform asset for the requested flavor
// (sfw-free / sfw-enterprise) out of a parsed external-tools.json — pure
// validation/derivation, no I/O. main() turns a `{ ok: false }` result into a
// `logger.fail` + exit(1).
export function resolveSfwTool(options: {
  platform: string
  tools: ExternalToolsFile
  toolKey: string
  win32: boolean
}): ResolveSfwToolResult {
  const { platform, tools, toolKey, win32 } = options
  const entry = tools.tools?.[toolKey]
  if (!entry) {
    return {
      error: `external-tools.json has no \`tools.${toolKey}\` entry at ${EXTERNAL_TOOLS_PATH}`,
      ok: false,
    }
  }
  if (!entry.repository) {
    return {
      error: `tools.${toolKey} is missing the required \`repository\` field`,
      ok: false,
    }
  }

  // The canonical version field can carry a leading `v` (template ships
  // `v1.12.0`). Strip it for the URL; the wheelhouse-root mirror stores
  // it bare. downloadBinary verifies the raw SRI (any sha-2 variant) directly.
  const version = entry.version.replace(/^v/, '')
  const platformMeta = entry.platforms?.[platform]
  if (!platformMeta) {
    const supported = Object.keys(entry.platforms ?? {}).join(', ')
    return {
      error:
        `${toolKey} v${version} is not published for ${platform}.\n` +
        `  Supported: ${supported || '(none)'}`,
      ok: false,
    }
  }

  const repoSlug = entry.repository.replace(/^github:/, '')
  const url = `https://github.com/${repoSlug}/releases/download/v${version}/${platformMeta.asset}`
  const binaryName = win32 ? 'sfw.exe' : 'sfw'
  const integrity = assertIntegrity(platformMeta.integrity)

  return {
    ok: true,
    value: { binaryName, entry, platform, integrity, toolKey, url, version },
  }
}

export function detectPlatform(): string {
  const arch = getArch()
  if (process.platform === 'darwin') {
    return `darwin-${arch}`
  }
  if (process.platform === 'win32') {
    return `win-${arch}`
  }
  if (process.platform === 'linux') {
    // Detect musl vs glibc via the loader presence — same heuristic
    // the CI install-tool.mjs uses.
    const isMusl =
      existsSync('/lib/ld-musl-x86_64.so.1') ||
      existsSync('/lib/ld-musl-aarch64.so.1')
    return `linux-${arch}${isMusl ? '-musl' : ''}`
  }
  throw new Error(`Unsupported platform: ${process.platform}`)
}

async function main(): Promise<void> {
  ensureWheelhouseLayout()

  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      enterprise: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
    strict: false,
  })

  // Install bootstrap reads both the local keychain slot (SOCKET_API_KEY) and
  // the canonical CI/docs name (SOCKET_API_TOKEN); this is the one place both
  // legacy + canonical names legitimately appear, and it runs before the
  // keychain helper's deps are guaranteed present, so it gates on raw env.
  // socket-api-token-env: bootstrap
  // socket-api-token-getter: allow direct-env
  const apiKeyInEnv = process.env['SOCKET_API_KEY']
  // socket-api-token-env: bootstrap
  // socket-api-token-getter: allow direct-env
  const apiTokenInEnv = process.env['SOCKET_API_TOKEN']
  if (values['enterprise'] && !apiKeyInEnv && !apiTokenInEnv) {
    logger.fail(
      '--enterprise requires SOCKET_API_KEY (or SOCKET_API_TOKEN) in env',
    )
    process.exit(1)
    return
  }

  if (!values['quiet']) {
    logger.info(`Reading version table from ${EXTERNAL_TOOLS_PATH}`)
  }

  if (!existsSync(EXTERNAL_TOOLS_PATH)) {
    logger.fail(
      `external-tools.json not found at ${EXTERNAL_TOOLS_PATH}\n` +
        '  Every fleet repo ships this file at its root via the wheelhouse cascade.',
    )
    process.exit(1)
    return
  }
  const tools = JSON.parse(
    readFileSync(EXTERNAL_TOOLS_PATH, 'utf8'),
  ) as ExternalToolsFile
  const toolKey = values['enterprise'] ? 'sfw-enterprise' : 'sfw-free'
  const platform = detectPlatform()
  const resolved = resolveSfwTool({ platform, tools, toolKey, win32: WIN32 })
  if (!resolved.ok) {
    logger.fail(resolved.error)
    process.exit(1)
    return
  }
  const { binaryName, integrity, url, version: ver } = resolved.value

  if (!values['quiet']) {
    logger.info(`Installing ${toolKey} v${ver} (${platform})`)
    logger.log(`  from: ${url}`)
  }

  const { binaryPath, downloaded } = await downloadBinary({
    force: Boolean(values['force']),
    integrity,
    name: binaryName,
    url,
  })

  if (!values['quiet']) {
    logger.log(`  ${downloaded ? 'downloaded' : 'cached'}: ${binaryPath}`)
  }

  // Refresh a symlink idempotently: lstat (not existsSync — it follows the
  // link and would leave a stale broken link in place), delete if present,
  // recreate. `type` matters only on Windows.
  async function refreshSymlink(
    target: string,
    linkPath: string,
    type: 'dir' | 'file',
  ): Promise<void> {
    // oxlint-disable-next-line socket/prefer-exists-sync -- lstat detects a broken symlink that existsSync (follows the link) would miss, leaving it stale.
    const linkExists = await fsPromises
      .lstat(linkPath)
      .then(() => true)
      .catch(() => false)
    if (linkExists) {
      await safeDelete(linkPath)
    }
    await fsPromises.symlink(target, linkPath, type)
  }

  // Layer two readable handles over the hash-named _dlx binary:
  //   1. rack alias: rack/sfw/<ver> → the _dlx/<hash> dir (the readable store).
  //   2. PATH handle: bin/sfw → rack/sfw/<ver>/sfw (so PATH never sees the
  //      hash; consumers reference the stable rack path). Both refresh on every
  //      install so a version bump repoints them.
  const rackToolDir = path.join(WHEELHOUSE_RACK_DIR, 'sfw', ver)
  await fsPromises.mkdir(path.dirname(rackToolDir), { recursive: true })
  await refreshSymlink(path.dirname(binaryPath), rackToolDir, 'dir')

  await fsPromises.mkdir(SFW_BIN_DIR, { recursive: true })
  const rackBinaryPath = path.join(rackToolDir, binaryName)
  const linkPath = path.join(SFW_BIN_DIR, binaryName)
  await refreshSymlink(rackBinaryPath, linkPath, 'file')

  if (!values['quiet']) {
    logger.success(`sfw v${ver} ready at ${linkPath}`)
    logger.log(`  → ${rackBinaryPath} → ${binaryPath}`)
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(errorMessage(e))
    process.exitCode = 1
  })
}
