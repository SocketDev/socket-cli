#!/usr/bin/env node
/**
 * @file Install Socket Firewall (sfw) into the Socket _dlx cache via
 *
 * @socketsecurity/lib-stable's downloadBinary helper. Matches the CI install
 *   path: same version source, same binary integrity check (SHA-256 inline),
 *   same on-disk layout (~/.socket/_dlx/<hash>/sfw). The dev-only piece is a
 *   stable shim symlink at ~/.socket/_wheelhouse/bin/sfw → _dlx-hashed path so
 *   existing shims in ~/.socket/_wheelhouse/shims/ continue to resolve.
 *
 *   Detects + migrates a pre-existing ~/.socket/sfw/ install in place on first
 *   run (rename to ~/.socket/_wheelhouse/). The `_` prefix matches the npm /
 *   lib-stable convention for "managed internal cache" (compare to _dlx,
 *   _cacache, etc.) — `sfw/` was the lone non-prefixed sibling, now
 *   regularized.
 *
 *   Reads version + per-platform sha256 from the repo's root
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
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { WIN32, getArch } from '@socketsecurity/lib-stable/constants/platform'
import { downloadBinary } from '@socketsecurity/lib-stable/dlx/binary'
import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { safeDelete, safeMkdirSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import {
  getSocketAppDir,
  getUserHomeDir,
} from '@socketsecurity/lib-stable/paths/socket'

const logger = getDefaultLogger()

// Resolve the repo-root external-tools.json. Scripts live at
// <repo-root>/scripts/install-sfw.mts, so go one dir up.
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.join(__dirname, '..')
const EXTERNAL_TOOLS_PATH = path.join(REPO_ROOT, 'external-tools.json')

// Resolve the user-home wheelhouse umbrella via the canonical lib-stable
// helper (getSocketAppDir('wheelhouse') → ~/.socket/_wheelhouse/). Cross-
// platform via getUserHomeDir() which handles HOME / USERPROFILE / fallback.
const WHEELHOUSE_DIR = getSocketAppDir('wheelhouse')
const WHEELHOUSE_BIN_DIR = path.join(WHEELHOUSE_DIR, 'bin')
// One-time migration: if a pre-rename ~/.socket/sfw/ install exists AND the
// new ~/.socket/_wheelhouse/ doesn't, rename the directory in place. Keeps
// existing shims valid (each will be regenerated on next setup pass to point
// at the new path). Idempotent: skips when either condition fails. Older
// fleet machines won't break across the rename.
const LEGACY_SFW_DIR = path.join(getUserHomeDir(), '.socket', 'sfw')
if (existsSync(LEGACY_SFW_DIR) && !existsSync(WHEELHOUSE_DIR)) {
  logger.log(`Migrating legacy ${LEGACY_SFW_DIR} → ${WHEELHOUSE_DIR}…`)
  renameSync(LEGACY_SFW_DIR, WHEELHOUSE_DIR)
}
// Ensure the expected subdir layout exists. safeMkdirSync is recursive +
// EEXIST-safe by default.
safeMkdirSync(WHEELHOUSE_BIN_DIR)

const SFW_BIN_DIR = WHEELHOUSE_BIN_DIR

interface ToolEntry {
  version: string
  repository?: string | undefined
  release?: string | undefined
  platforms?: Record<string, { asset: string; integrity: string }> | undefined
}

/**
 * Decode the Subresource Integrity form (`sha256-<base64>`) the canonical fleet
 * external-tools.json uses into the bare hex digest the downloadBinary helper
 * expects. Single-source-of-truth schema:
 * socket-btm/packages/build-infra/lib/external-tools-schema.json.
 */
function sriToHex(integrity: string): string {
  if (!integrity.startsWith('sha256-')) {
    throw new Error(
      `Unsupported integrity prefix in external-tools.json (expected 'sha256-'): ${integrity}`,
    )
  }
  return Buffer.from(integrity.slice('sha256-'.length), 'base64').toString(
    'hex',
  )
}

interface ExternalToolsFile {
  tools: Record<string, ToolEntry>
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
  const entry = tools.tools?.[toolKey]
  if (!entry) {
    logger.fail(
      `external-tools.json has no \`tools.${toolKey}\` entry at ${EXTERNAL_TOOLS_PATH}`,
    )
    process.exit(1)
    return
  }
  if (!entry.repository) {
    logger.fail(`tools.${toolKey} is missing the required \`repository\` field`)
    process.exit(1)
    return
  }

  // The canonical version field can carry a leading `v` (template ships
  // `v1.12.0`). Strip it for the URL; the wheelhouse-root mirror stores
  // it bare. downloadBinary expects the hex form so decode the SRI.
  const ver = entry.version.replace(/^v/, '')
  const platform = detectPlatform()
  const platformMeta = entry.platforms?.[platform]
  if (!platformMeta) {
    const supported = Object.keys(entry.platforms ?? {}).join(', ')
    logger.fail(
      `${toolKey} v${ver} is not published for ${platform}.\n` +
        `  Supported: ${supported || '(none)'}`,
    )
    process.exit(1)
    return
  }

  const repoSlug = entry.repository.replace(/^github:/, '')
  const url = `https://github.com/${repoSlug}/releases/download/v${ver}/${platformMeta.asset}`
  const binaryName = WIN32 ? 'sfw.exe' : 'sfw'
  const sha256 = sriToHex(platformMeta.integrity)

  if (!values['quiet']) {
    logger.info(`Installing ${toolKey} v${ver} (${platform})`)
    logger.log(`  from: ${url}`)
  }

  const { binaryPath, downloaded } = await downloadBinary({
    force: Boolean(values['force']),
    name: binaryName,
    sha256,
    url,
  })

  if (!values['quiet']) {
    logger.log(`  ${downloaded ? 'downloaded' : 'cached'}: ${binaryPath}`)
  }

  // Stable shim entry point: ~/.socket/_wheelhouse/bin/sfw → _dlx-hashed path.
  // The shims in ~/.socket/_wheelhouse/shims/ exec this symlink so the
  // _dlx hash is invisible to PATH-prepending consumers. Refresh on every
  // install so a version bump updates the link target.
  await fsPromises.mkdir(SFW_BIN_DIR, { recursive: true })
  const linkPath = path.join(SFW_BIN_DIR, binaryName)
  // oxlint-disable-next-line socket/prefer-exists-sync -- need lstat (not existsSync) to detect broken symlinks; existsSync follows the link and returns false if the target is gone, leaving the stale link in place.
  const linkExists = await fsPromises
    .lstat(linkPath)
    .then(() => true)
    .catch(() => false)
  if (linkExists) {
    await safeDelete(linkPath)
  }
  await fsPromises.symlink(binaryPath, linkPath)

  if (!values['quiet']) {
    logger.success(`sfw v${ver} ready at ${linkPath}`)
    logger.log(`  → ${binaryPath}`)
  }
}

main().catch((e: unknown) => {
  logger.fail(errorMessage(e))
  process.exitCode = 1
})
