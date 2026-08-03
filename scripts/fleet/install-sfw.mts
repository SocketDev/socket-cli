#!/usr/bin/env node
/**
 * @file Install Socket Firewall (sfw) into the Socket _dlx cache via
 *
 * @socketsecurity/lib-stable's downloadBinary helper. Matches the CI install
 *   path: same version source, same binary integrity check (SRI-verified inline,
 *   same on-disk layout (~/.socket/_dlx/<hash>/sfw — the content-addressed
 *   binary store). Two dev-only handles layer readable paths over that hash:
 *   a rack alias `~/.socket/_wheelhouse/rack/sfw/<version>-<flavor>` → the _dlx
 *   dir, and the PATH handle `~/.socket/_wheelhouse/bin/sfw` → the rack alias.
 *   So PATH never sees the hash; consumers reference the stable readable rack
 *   path. The flavor is part of that path because sfw-free and sfw-enterprise
 *   ship the same version and the same binary name.
 *
 *   Detects + migrates a pre-existing ~/.socket/sfw/ install on first run (into
 *   ~/.socket/_wheelhouse/). The `_` prefix matches the npm / lib-stable
 *   convention for "managed internal cache" (compare to _dlx, _cacache, etc.) —
 *   `sfw/` was the lone non-prefixed sibling, now regularized. The persistent
 *   CA pair stays behind: ~/.socket/sfw is also where the firewall build reads
 *   it, so the migration drains the legacy payload around it.
 *
 *   Reads version + per-platform integrity (SRI) from the repo's root
 *   `external-tools.json` under `tools.sfw-free` / `tools.sfw-enterprise`.
 *   That file is the single fleet source of truth — every consumer of
 *   external tooling reads the same entries. Usage: pnpm run install:sfw #
 *   free flavor pnpm run install:sfw -- --enterprise # requires
 *   SOCKET_API_KEY (or SOCKET_API_TOKEN) plus GITHUB_TOKEN / GH_TOKEN
 *   pnpm run install:sfw -- --force # ignore cache, redownload pnpm run
 *   install:sfw -- --quiet.
 *
 *   The enterprise asset lives in a private repo, so its download carries a
 *   GitHub bearer token exactly as the dep-0 setup/lib/install-tool.mjs does —
 *   see downloadSfwAsset, which supplies the header seam lib-stable's
 *   downloadBinary lacks.
 */

import {
  existsSync,
  promises as fsPromises,
  readdirSync,
  readFileSync,
  renameSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { getArch, WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { DLX_BINARY_CACHE_TTL } from '@socketsecurity/lib-stable/constants/time'
import { downloadBinary } from '@socketsecurity/lib-stable/dlx/binary'
import {
  getDlxCachePath,
  isBinaryCacheValid,
  writeBinaryCacheMetadata,
} from '@socketsecurity/lib-stable/dlx/binary-cache'
import { generateCacheKey } from '@socketsecurity/lib-stable/dlx/cache'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete, safeMkdirSync } from '@socketsecurity/lib-stable/fs/safe'
import { getGitHubToken } from '@socketsecurity/lib-stable/github/token'
import { httpDownload } from '@socketsecurity/lib-stable/http-request/download'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import {
  getSocketAppDir,
  getUserHomeDir,
} from '@socketsecurity/lib-stable/paths/socket'

import { SFW_CA_FILENAMES } from '../../.claude/hooks/fleet/_shared/sfw-ca.mts'
import { REPO_ROOT } from './paths.mts'
import { sfwFlavorFor, sfwRackDirName } from './setup/lib/bootstrap-common.mjs'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

const EXTERNAL_TOOLS_PATH = path.join(
  REPO_ROOT,
  '.config/repo/external-tools.json',
)

// Resolve the user-home wheelhouse umbrella via the canonical lib-stable
// helper (getSocketAppDir('wheelhouse') → ~/.socket/_wheelhouse/). Cross-
// platform via getUserHomeDir() which handles HOME / USERPROFILE / fallback.
const WHEELHOUSE_DIR = getSocketAppDir('wheelhouse')
const WHEELHOUSE_BIN_DIR = path.join(WHEELHOUSE_DIR, 'bin')
// rack/ is the readable alias layer over the hash-named _dlx store: a real
// binary lives at _dlx/<hash>/sfw, rack/sfw/<version>-<flavor> symlinks to that
// dir, and bin/sfw → rack/sfw/<version>-<flavor>/sfw. Lock-step with
// @socketsecurity/lib src/paths/socket.ts getSocketRackToolDir({tool,version})
// (constructed here rather than imported until the lib-stable bump ships the
// helper); the flavor tail comes from sfwRackDirName().
const WHEELHOUSE_RACK_DIR = path.join(WHEELHOUSE_DIR, 'rack')
// One-time migration source: a pre-rename ~/.socket/sfw/ wheelhouse install.
//
// This directory has TWO owners. It is the pre-rename wheelhouse root here, and
// it is also where the firewall build reads its persistent CA pair
// (`getPersistentCaDir()` in the firewall's src/lib/cli/caPaths.ts, mirrored by
// SFW_CA_HOME_RELATIVE_DIR). So the migration moves only what IT owns — see
// ensureWheelhouseLayout.
const LEGACY_SFW_DIR = path.join(getUserHomeDir(), '.socket', 'sfw')

const SFW_BIN_DIR = WHEELHOUSE_BIN_DIR

/**
 * The entries of a legacy ~/.socket/sfw that belong to the pre-rename
 * wheelhouse install. The persistent CA pair lives in the same directory and
 * belongs to the firewall, so it is never part of the payload.
 */
export function legacySfwPayloadEntries(entries: readonly string[]): string[] {
  return entries
    .filter(entry => !(SFW_CA_FILENAMES as readonly string[]).includes(entry))
    .toSorted()
}

/**
 * Dir overrides for `ensureWheelhouseLayout`. Both default to the real
 * per-user locations; the specs pass temp dirs so every machine state is
 * exercised without touching `~/.socket`.
 */
export interface WheelhouseLayoutOptions {
  readonly legacyDir?: string | undefined
  readonly wheelhouseDir?: string | undefined
}

// Migrate a pre-rename legacy install, then ensure the expected subdir layout
// exists. Called from main() never at import time, so importing this module for
// its pure helpers never touches the filesystem. safeMkdirSync is recursive +
// EEXIST-safe by default.
//
// The migration moves the legacy payload ENTRY BY ENTRY rather than renaming
// the whole directory, because ~/.socket/sfw is also the firewall's persistent
// CA dir. A whole-dir rename would carry ca.{crt,key} into ~/.socket/_wheelhouse
// — out from under both the build that reads them and the OS trust entry the
// operator installed — and, on a machine that never had a legacy install, the
// mere existence of a CA dir would fake a migration into being.
//
// Already-migrated machine (~/.socket/_wheelhouse present): untouched, exactly
// as before. Unmigrated machine: the payload lands in the umbrella and the CA
// stays where sfw reads it.
export function ensureWheelhouseLayout(
  options?: WheelhouseLayoutOptions | undefined,
): void {
  const opts = { __proto__: null, ...options } as WheelhouseLayoutOptions
  const legacyDir = opts.legacyDir ?? LEGACY_SFW_DIR
  const wheelhouseDir = opts.wheelhouseDir ?? WHEELHOUSE_DIR
  if (existsSync(legacyDir) && !existsSync(wheelhouseDir)) {
    const payload = legacySfwPayloadEntries(readdirSync(legacyDir))
    if (payload.length > 0) {
      logger.log(`Migrating legacy ${legacyDir} → ${wheelhouseDir}…`)
      logger.log(
        `  Leaving the persistent CA behind — ${legacyDir} is where sfw reads it.`,
      )
      safeMkdirSync(wheelhouseDir)
      for (let i = 0, { length } = payload; i < length; i += 1) {
        const entry = payload[i]!
        renameSync(path.join(legacyDir, entry), path.join(wheelhouseDir, entry))
      }
    }
  }
  safeMkdirSync(path.join(wheelhouseDir, 'bin'))
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
 * socket-btm/scripts/fleet/build-infra/lib/external-tools-schema.json.
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
  // `<owner>/<repo>` with the `github:` prefix stripped. The enterprise repo is
  // private, so the token gate below names it in its failure message.
  repoSlug: string
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
export function resolveSfwTool(config: {
  platform: string
  tools: ExternalToolsFile
  toolKey: string
  win32: boolean
}): ResolveSfwToolResult {
  const { platform, tools, toolKey, win32 } = {
    __proto__: null,
    ...config,
  } as typeof config
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
    value: {
      binaryName,
      entry,
      platform,
      integrity,
      repoSlug,
      toolKey,
      url,
      version,
    },
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

/**
 * The header set a GitHub release-asset download carries. Lock-step with the
 * dep-0 `setup/lib/install-tool.mjs`, which sets exactly this bearer header
 * when a token is in env: a private repo's release assets 404 for an
 * unauthenticated fetch, and the same call site has to keep working for the
 * public sfw-free assets, so an absent token means no header rather than an
 * empty one.
 */
export function sfwAssetAuthHeaders(
  token: string | undefined,
): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * The refusal an `--enterprise` install gets when no GitHub token is reachable.
 * Fails BEFORE the fetch: unauthenticated, the private asset answers a bare
 * HTTP 404, which reads as "this version was never published" and sends the
 * operator hunting the version table instead of their credentials.
 */
export function missingEnterpriseTokenError(config: {
  repoSlug: string
  url: string
}): string {
  const { repoSlug, url } = { __proto__: null, ...config } as typeof config
  return (
    'sfw-enterprise cannot download without a GitHub token.\n' +
    `  Where:  ${url}\n` +
    `          (${repoSlug} is private — its release assets are not public)\n` +
    '  Saw:    neither GITHUB_TOKEN nor GH_TOKEN is set in this environment.\n' +
    `  Wanted: a token with \`contents: read\` on ${repoSlug}, forwarded as an\n` +
    '          Authorization bearer header the way the dep-0\n' +
    '          scripts/fleet/setup/lib/install-tool.mjs forwards it.\n' +
    '  Fix:    export GITHUB_TOKEN="$(gh auth token)" locally, or in CI supply a\n' +
    `          token that can read ${repoSlug} (a workflow's own\n` +
    '          secrets.GITHUB_TOKEN only reaches its own repo), then re-run\n' +
    '          `pnpm run install:sfw -- --enterprise`. Dropping --enterprise\n' +
    '          installs the free flavor from a public repo and needs no token.'
  )
}

export interface SfwAssetDownload {
  binaryPath: string
  downloaded: boolean
}

/**
 * Download an sfw release asset into the `_dlx` content-addressed store,
 * forwarding a GitHub token when one is available.
 *
 * Lib-stable's `downloadBinary` has no header seam — `DlxBinaryOptions` carries
 * none, and it hands `httpDownload` only the integrity fields — so a private
 * release asset can never authenticate through it. Without a token this
 * delegates to `downloadBinary` unchanged. With one, it reassembles the SAME
 * layout from the same public helpers: cache key `<url>:<name>`, entry dir
 * under `getDlxCachePath()`, SRI verified from the response stream, cache
 * metadata written the same way. Both paths therefore land the binary at the
 * identical `_dlx/<hash>/<name>` path and share cache hits.
 */
export async function downloadSfwAsset(config: {
  force: boolean
  integrity: string
  name: string
  token: string | undefined
  url: string
}): Promise<SfwAssetDownload> {
  const { force, integrity, name, token, url } = {
    __proto__: null,
    ...config,
  } as typeof config
  const headers = sfwAssetAuthHeaders(token)
  if (!Object.keys(headers).length) {
    const { binaryPath, downloaded } = await downloadBinary({
      force,
      integrity,
      name,
      url,
    })
    return { binaryPath, downloaded }
  }
  const cacheKey = generateCacheKey(`${url}:${name}`)
  const cacheEntryDir = path.join(getDlxCachePath(), cacheKey)
  const binaryPath = normalizePath(path.join(cacheEntryDir, name))
  if (
    !force &&
    existsSync(binaryPath) &&
    (await isBinaryCacheValid(cacheEntryDir, DLX_BINARY_CACHE_TTL))
  ) {
    return { binaryPath, downloaded: false }
  }
  await fsPromises.mkdir(cacheEntryDir, { recursive: true })
  const result = await httpDownload(url, binaryPath, { headers, integrity })
  if (!WIN32) {
    await fsPromises.chmod(binaryPath, 0o755)
  }
  // Size and integrity both come off the response the downloader streamed,
  // so the metadata describes the bytes that were verified rather than
  // whatever a later re-stat of the path would find.
  await writeBinaryCacheMetadata(
    cacheEntryDir,
    cacheKey,
    url,
    result.integrity,
    result.size,
  )
  return { binaryPath, downloaded: true }
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
  const flavor = sfwFlavorFor(Boolean(values['enterprise']))
  const toolKey = `sfw-${flavor}`
  const platform = detectPlatform()
  const resolved = resolveSfwTool({ platform, tools, toolKey, win32: WIN32 })
  if (!resolved.ok) {
    logger.fail(resolved.error)
    process.exit(1)
    return
  }
  const { binaryName, integrity, repoSlug, url, version: ver } = resolved.value

  // The SOCKET_API_KEY gate above picks the enterprise SKU; this one supplies
  // the credential that actually fetches it. Two different secrets, and only
  // this one reaches the private release repo.
  const githubToken = getGitHubToken()
  if (flavor === 'enterprise' && !githubToken) {
    logger.fail(missingEnterpriseTokenError({ repoSlug, url }))
    process.exit(1)
    return
  }

  if (!values['quiet']) {
    logger.info(`Installing ${toolKey} v${ver} (${platform})`)
    logger.log(`  from: ${url}`)
    if (githubToken) {
      logger.log('  auth: GitHub bearer token (from env)')
    }
  }

  const { binaryPath, downloaded } = await downloadSfwAsset({
    force: Boolean(values['force']),
    integrity,
    name: binaryName,
    token: githubToken,
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
    // oxlint-disable-next-line socket/prefer-exists-sync -- lstat detects a broken symlink that existsSync, follows the link, would miss, leaving it stale.
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
  //   1. rack alias: rack/sfw/<ver>-<flavor> → the _dlx/<hash> dir, the
  //      readable store.
  //   2. PATH handle: bin/sfw → rack/sfw/<ver>-<flavor>/sfw (so PATH never sees
  //      the hash; consumers reference the stable rack path). Both refresh on
  //      every install so a version OR flavor change repoints them.
  // The flavor is in the path via the same sfwRackDirName() the dep-0
  // bootstrap uses: the two flavors share a version and a binary name, so a
  // flavor-blind path left them indistinguishable on disk.
  const rackToolDir = path.join(
    WHEELHOUSE_RACK_DIR,
    'sfw',
    sfwRackDirName(ver, flavor),
  )
  await fsPromises.mkdir(path.dirname(rackToolDir), { recursive: true })
  await refreshSymlink(path.dirname(binaryPath), rackToolDir, 'dir')

  await fsPromises.mkdir(SFW_BIN_DIR, { recursive: true })
  const rackBinaryPath = path.join(rackToolDir, binaryName)
  const linkPath = path.join(SFW_BIN_DIR, binaryName)
  await refreshSymlink(rackBinaryPath, linkPath, 'file')

  if (!values['quiet']) {
    // The flavor here is the one whose asset was just verified and linked, not
    // the one the caller asked for — those diverge whenever a resolve fails.
    logger.success(`sfw ${flavor} v${ver} ready at ${linkPath}`)
    logger.log(`  → ${rackBinaryPath} → ${binaryPath}`)
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(errorMessage(e))
    process.exitCode = 1
  })
}
