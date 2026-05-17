#!/usr/bin/env node
/**
 * @fileoverview Install Socket Firewall (sfw) into the Socket _dlx cache
 * via @socketsecurity/lib-stable's downloadBinary helper.
 *
 * Matches the CI install path: same version source, same binary
 * integrity check (SHA-256 inline), same on-disk layout
 * (~/.socket/_dlx/<hash>/sfw). The dev-only piece is a stable shim
 * symlink at ~/.socket/sfw/bin/sfw → _dlx-hashed path so existing
 * shims in ~/.socket/sfw/shims/ continue to resolve.
 *
 * Reads version + per-platform sha256 from the repo's root
 * `external-tools.json` under `tools.sfw-free` / `tools.sfw-enterprise`.
 * That file is the single fleet source of truth — every consumer of
 * external tooling reads the same entries.
 *
 * Usage:
 *   pnpm run install:sfw                  # free flavor
 *   pnpm run install:sfw -- --enterprise  # requires SOCKET_API_TOKEN
 *   pnpm run install:sfw -- --force       # ignore cache, redownload
 *   pnpm run install:sfw -- --quiet
 */

import { existsSync, promises as fsPromises, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { WIN32, getArch } from '@socketsecurity/lib-stable/constants/platform'
import { downloadBinary } from '@socketsecurity/lib-stable/dlx/binary'
import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { safeDelete } from '@socketsecurity/lib-stable/fs'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

const logger = getDefaultLogger()

// Resolve the repo-root external-tools.json. Scripts live at
// <repo-root>/scripts/install-sfw.mts, so go one dir up.
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.join(__dirname, '..')
const EXTERNAL_TOOLS_PATH = path.join(REPO_ROOT, 'external-tools.json')

// HOME on POSIX, USERPROFILE on Windows. Both can be set to an empty
// string in degenerate shells (`HOME= some-cmd`) or to a non-absolute
// stub like `~`, which would resolve `path.join(HOME, ...)` to a path
// rooted at the current working directory — silently installing sfw
// somewhere unexpected. Insist on an absolute path before accepting
// either value.
const resolveHome = (): string | undefined => {
  for (const candidate of [process.env['HOME'], process.env['USERPROFILE']]) {
    if (candidate && path.isAbsolute(candidate)) {
      return candidate
    }
  }
  return undefined
}
const HOME = resolveHome()
if (!HOME) {
  logger.fail(
    'HOME / USERPROFILE not set to an absolute path — cannot resolve install dir',
  )
  process.exit(1)
}
const SFW_BIN_DIR = path.join(HOME, '.socket', 'sfw', 'bin')

interface ToolEntry {
  version: string
  repository?: string
  release?: string
  checksums?: Record<string, { asset: string; sha256: string }>
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

  if (values['enterprise'] && !process.env['SOCKET_API_TOKEN']) {
    logger.fail('--enterprise requires SOCKET_API_TOKEN in env')
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

  const platform = detectPlatform()
  const platformMeta = entry.checksums?.[platform]
  if (!platformMeta) {
    const supported = Object.keys(entry.checksums ?? {}).join(', ')
    logger.fail(
      `${toolKey} v${entry.version} is not published for ${platform}.\n` +
        `  Supported: ${supported || '(none)'}`,
    )
    process.exit(1)
    return
  }

  const repoSlug = entry.repository.replace(/^github:/, '')
  const url = `https://github.com/${repoSlug}/releases/download/v${entry.version}/${platformMeta.asset}`
  const binaryName = WIN32 ? 'sfw.exe' : 'sfw'
  const sha256 = platformMeta.sha256

  if (!values['quiet']) {
    logger.info(`Installing ${toolKey} v${entry.version} (${platform})`)
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

  // Stable shim entry point: ~/.socket/sfw/bin/sfw → _dlx-hashed path.
  // The shims in ~/.socket/sfw/shims/ exec this symlink so the _dlx
  // hash is invisible to PATH-prepending consumers. Refresh on every
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
    logger.success(`sfw v${entry.version} ready at ${linkPath}`)
    logger.log(`  → ${binaryPath}`)
  }
}

main().catch((e: unknown) => {
  logger.fail(errorMessage(e))
  process.exitCode = 1
})
