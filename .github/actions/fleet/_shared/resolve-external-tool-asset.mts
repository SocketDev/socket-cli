/**
 * @file Resolve a pinned external-tool asset + SRI integrity for THIS runner,
 *   from scripts/fleet/setup/external-tools.json. Replaces the curl-with-no-
 *   checksum download dance repeated across setup-go-toolchain /
 *   setup-rust-toolchain / setup-odai. Emits one JSON line on stdout:
 *   {"asset":"<url>","integrity":"<sri>","version":"<v>"}
 *   The caller passes `asset` + `integrity` to install-tool.mjs, which
 *   downloads + SRI-verifies BEFORE extract/execute. Usage:
 *   node resolve-external-tool-asset.generated.mjs --tool <name>
 *   [--version <v>] [--version-file <path>] [--tools-file <path>]
 *   [--platform-key <key>]
 *   --version "stable" (or omitted) → the entry's pinned `version`.
 *   --version-file → read a `go <version>` line (go.mod) and use that version.
 *   For `go` ONLY, a version that differs from the pin is resolved live
 *   against the go.dev release manifest (https://go.dev/dl/?mode=json) so a
 *   custom Go version still gets a SHA-256-verified download; every other tool
 *   requires the pinned version (the pin IS the integrity source). Exits 1 on
 *   any resolution failure. A validated catalog with no asset for the selected
 *   platform exits with PLATFORM_UNAVAILABLE_EXIT_CODE for optional callers.
 *   Runs on the raw runner before setup-node (composite-action helper), so it
 *   uses built-ins only (node:fs, node:path, node:process, fetch) — no
 *   socket-lib, no node_modules.
 *   Testability: the pure helpers (canonicalPlatformKey, resolvePlatformEntry,
 *   integrityValue, readVersionFromFile, resolveGoAssetFromManifest) are
 *   EXPORTED and the side-effectful CLI orchestration is guarded by
 *   isMainModule(), so unit tests import them without triggering a network
 *   fetch or a process.exit. Every composite-action _shared helper follows this
 *   pattern (see check-fleet-shared-scripts-are-testable).
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { integrityValue, resolveCatalogAsset } from './release-asset.mts'
import type { ReleaseAssetTool } from './release-asset.mts'
import {
  canonicalPlatformKey,
  readVersionFromFile,
  resolveGoAssetFromManifest,
  resolvePlatformEntry,
} from './resolve-external-tool-platform.mts'
import type { PlatformEntry } from './resolve-external-tool-platform.mts'

export const PLATFORM_UNAVAILABLE_EXIT_CODE = 42

export {
  integrityProvenance,
  integrityValue,
  resolveCatalogAsset,
  resolveGithubReleaseAsset,
} from './release-asset.mts'
export {
  GO_OS_ARCH,
  canonicalPlatformKey,
  readVersionFromFile,
  resolveGoAssetFromManifest,
  resolvePlatformEntry,
} from './resolve-external-tool-platform.mts'

interface CatalogTool extends ReleaseAssetTool {
  readonly manager?: unknown | undefined
  readonly platforms?: Readonly<Record<string, PlatformEntry>> | undefined
}

interface ToolsCatalog {
  readonly tools: Readonly<Record<string, CatalogTool>>
  readonly toolsFile: string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || 'Unknown error'
  }
  if (error === null || error === undefined) {
    return 'Unknown error'
  }
  const message = String(error)
  if (message === '' || message === '[object Object]') {
    return 'Unknown error'
  }
  return message
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || prototype === Object.prototype
}

// Composite-action helper runs on the raw runner BEFORE setup-node finishes
// resolving node_modules — @socketsecurity/lib-stable is not on disk yet, so
// the logger.fail path the rest of the fleet uses is unavailable. Fall back to
// a tiny inline fail that mirrors install-tool.mjs's bootstrap logger.
function fail(msg: string): void {
  // oxlint-disable-next-line socket/no-console-prefer-logger -- no lib yet
  console.error(msg)
}

// Emit the resolver result as one JSON line on stdout (the caller reads it via
// jq.mjs). Wrapped so the stream is reached inside a function, not at module
// eval (not V8-snapshot-safe).
function emit(obj: unknown): void {
  // oxlint-disable-next-line socket/no-direct-stream-write -- dep-0
  process.stdout.write(JSON.stringify(obj))
}

// ── CLI orchestration (guarded) ───────────────────────────────────────────

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  try {
    // realpath both sides before comparing. Node normalizes `..` in argv[1]
    // but leaves symlinks in place, while import.meta.url is fully resolved, so
    // a launch path under a symlinked prefix (macOS /tmp and /var/folders, a
    // symlinked checkout) compares unequal and the CLI silently does nothing
    // while exiting 0.
    return pathToFileURL(realpathSync(entry)).href === import.meta.url
  } catch {
    return false
  }
}

function argValue(name: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length
    ? (process.argv[i + 1] ?? '')
    : ''
}

// The external-tools.json path and its parsed `tools` map. Every failure
// here is terminal, so this exits rather than returning a verdict.
function loadToolsCatalog(toolsFileArg: string): ToolsCatalog {
  const toolsFile =
    toolsFileArg ||
    fileURLToPath(
      new URL('../setup/external-tools.generated.json', import.meta.url),
    )
  if (!existsSync(toolsFile)) {
    fail(`× external-tools.json not found at ${toolsFile}`)
    process.exit(1)
  }
  let toolsData
  try {
    toolsData = JSON.parse(readFileSync(toolsFile, 'utf8'))
  } catch (e) {
    fail(`× could not parse ${toolsFile}: ${errorMessage(e)}`)
    process.exit(1)
  }
  const tools = isPlainObject(toolsData) ? toolsData['tools'] : undefined
  if (!isPlainObject(tools)) {
    fail(`× ${toolsFile} has no valid tools map`)
    process.exit(1)
  }
  return { __proto__: null, tools, toolsFile } as ToolsCatalog
}

// The named tool's catalog entry. A missing tool or a tool with no platforms
// map is terminal.
function selectToolEntry(
  tools: Readonly<Record<string, CatalogTool>>,
  toolName: string,
  toolsFile: string,
): CatalogTool {
  const tool = tools[toolName]
  if (!isPlainObject(tool)) {
    fail(`× no '${toolName}' entry in ${toolsFile}`)
    process.exit(1)
  }
  const platforms = tool['platforms']
  if (!isPlainObject(platforms)) {
    fail(`× '${toolName}' has no platforms map in ${toolsFile}`)
    process.exit(1)
  }
  for (const [platformKey, entry] of Object.entries(platforms)) {
    if (
      !isPlainObject(entry) ||
      typeof entry['asset'] !== 'string' ||
      entry['asset'].length === 0 ||
      !integrityValue(entry['integrity'])
    ) {
      fail(
        `× '${toolName}' has a malformed ${platformKey} platform entry in ${toolsFile}`,
      )
      process.exit(1)
    }
  }
  return tool as CatalogTool
}

// The version to install, in precedence order: the version file, then an
// explicit non-`stable` argument, then the catalog pin. No version at all is
// terminal.
function resolveToolVersion({
  tool,
  toolName,
  versionArg,
  versionFile,
}: {
  readonly tool: CatalogTool
  readonly toolName: string
  readonly versionArg: string
  readonly versionFile: string
}): string {
  const fileVersion = readVersionFromFile(versionFile)
  let resolvedVersion = ''
  if (fileVersion) {
    resolvedVersion = fileVersion
  } else if (versionArg && versionArg !== 'stable') {
    resolvedVersion = versionArg
  }
  if (!resolvedVersion) {
    resolvedVersion = typeof tool.version === 'string' ? tool.version : ''
  }
  if (!resolvedVersion) {
    fail(`× no version resolved for '${toolName}' (no pin, no input)`)
    process.exit(1)
  }
  const isGo = toolName === 'go' || tool.manager === 'go'
  if (!isGo && resolvedVersion !== tool.version) {
    fail(
      `× '${toolName}' only accepts its pinned catalog version ${tool.version}`,
    )
    process.exit(1)
  }
  return resolvedVersion
}

// Emit the catalog entry's own asset + integrity. Forwards the object-form
// provenance (src/date) so install-tool.mjs can run the live src + staleness
// checks after the static SRI check. Empty for the string form (no
// provenance) — install-tool.mjs no-ops them.
function emitPinnedAsset(
  tool: CatalogTool,
  entry: PlatformEntry,
  {
    canonicalKey,
    resolvedVersion,
    toolsFile,
  }: {
    readonly canonicalKey: string
    readonly resolvedVersion: string
    readonly toolsFile: string
  },
): void {
  try {
    const resolved = resolveCatalogAsset(tool, entry, canonicalKey)
    emit({ ...resolved, version: resolvedVersion })
  } catch (error) {
    fail(`× ${errorMessage(error)} in ${toolsFile}`)
    process.exit(1)
  }
}

// The go.dev release manifest, the integrity source for a `go` version that
// is not the catalog pin. Any fetch failure is terminal.
async function fetchGoDlManifest(): Promise<unknown> {
  try {
    // pre-setup-node helper: built-in fetch only.
    // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- bootstrap
    const res = await fetch('https://go.dev/dl/?mode=json&include=all', {
      redirect: 'follow',
    })
    if (!res.ok) {
      fail(`× go.dev manifest fetch failed: HTTP ${res.status}`)
      process.exit(1)
    }
    return await res.json()
  } catch (e) {
    fail(`× go.dev manifest fetch failed: ${errorMessage(e)}`)
    process.exit(1)
  }
  return undefined
}

async function main(): Promise<void> {
  const toolName = argValue('--tool')
  const versionArg = argValue('--version')
  const versionFile = argValue('--version-file')
  const toolsFileArg = argValue('--tools-file')
  const platformArg = argValue('--platform-key')

  if (!toolName) {
    fail(
      'usage: resolve-external-tool-asset.generated.mjs --tool <name> [--version <v>] [--version-file <path>] [--tools-file <path>]',
    )
    process.exit(1)
  }

  const { tools, toolsFile } = loadToolsCatalog(toolsFileArg)
  const tool = selectToolEntry(tools, toolName, toolsFile)

  const canonicalKey = platformArg || canonicalPlatformKey()

  const { entry, fallbackKey } = resolvePlatformEntry(
    tool.platforms!,
    canonicalKey,
  )
  if (fallbackKey) {
    fail(
      `· ${toolName}: no ${canonicalKey} asset, falling back to ${fallbackKey} (statically linked, runs on musl)`,
    )
  }
  if (!entry) {
    fail(
      `× '${toolName}' has no platform asset for ${canonicalKey} in ${toolsFile}`,
    )
    process.exit(PLATFORM_UNAVAILABLE_EXIT_CODE)
  }

  const resolvedVersion = resolveToolVersion({
    tool,
    toolName,
    versionArg,
    versionFile,
  })

  // Pinned-version fast path: emit the entry's asset + integrity. A version
  // override on `go` is resolved live against go.dev below; every other tool
  // requires the pinned version (the pin IS the integrity source).
  const isGo = toolName === 'go' || tool.manager === 'go'
  const pinVersion = tool.version || ''
  if (!isGo || resolvedVersion === pinVersion) {
    emitPinnedAsset(tool, entry, {
      canonicalKey,
      resolvedVersion,
      toolsFile,
    })
    return
  }

  // go custom-version path: resolve the SHA-256 from the go.dev manifest.
  const manifest = await fetchGoDlManifest()

  try {
    emit(resolveGoAssetFromManifest(manifest, resolvedVersion, canonicalKey))
  } catch (e) {
    fail(`× ${errorMessage(e)}`)
    process.exit(1)
  }
}

if (isMainModule()) {
  void main()
}
