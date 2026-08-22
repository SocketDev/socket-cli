/**
 * @file Resolve a pinned external-tool asset + SRI integrity for THIS runner,
 *   from scripts/fleet/setup/external-tools.json. Replaces the curl-with-no-
 *   checksum download dance repeated across setup-go-toolchain /
 *   setup-rust-toolchain / setup-odai. Emits one JSON line on stdout:
 *   {"asset":"<url>","integrity":"<sri>","version":"<v>"}
 *   The caller passes `asset` + `integrity` to install-tool.mjs, which
 *   downloads + SRI-verifies BEFORE extract/execute. Usage:
 *   node resolve-external-tool-asset.mjs --tool <name>
 *   [--version <v>] [--version-file <path>] [--tools-file <path>]
 *   --version "stable" (or omitted) → the entry's pinned `version`.
 *   --version-file → read a `go <version>` line (go.mod) and use that version.
 *   For `go` ONLY, a version that differs from the pin is resolved live
 *   against the go.dev release manifest (https://go.dev/dl/?mode=json) so a
 *   custom Go version still gets a SHA-256-verified download; every other tool
 *   requires the pinned version (the pin IS the integrity source). Exits 1 on
 *   any resolution failure — set -e turns a missing platform entry into a loud
 *   error rather than an empty-asset install-tool.mjs invocation.
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

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

// Composite-action helper runs on the raw runner BEFORE setup-node finishes
// resolving node_modules — @socketsecurity/lib-stable is not on disk yet, so
// the logger.fail path the rest of the fleet uses is unavailable. Fall back to
// a tiny inline fail that mirrors install-tool.mjs's bootstrap logger.
function fail(msg) {
  // oxlint-disable-next-line socket/no-console-prefer-logger -- no lib yet
  console.error(msg)
}

// Emit the resolver result as one JSON line on stdout (the caller reads it via
// jq.mjs). Wrapped so the stream is reached inside a function, not at module
// eval (not V8-snapshot-safe).
function emit(obj) {
  // oxlint-disable-next-line socket/no-module-eval-side-effects -- bootstrap
  process.stdout.write(JSON.stringify(obj))
}

// ── pure helpers (exported for unit tests) ────────────────────────────────

// Canonical → Go os/arch. Go ships no musl tarball — the glibc archive is
// statically linked and runs on musl too, so musl keys map to the glibc
// os/arch. Exported so resolveGoAssetFromManifest can use it and tests can
// assert the mapping.
export const GO_OS_ARCH = {
  __proto__: null,
  'darwin-arm64': { os: 'darwin', arch: 'arm64' },
  'darwin-x64': { os: 'darwin', arch: 'amd64' },
  'linux-arm64': { os: 'linux', arch: 'arm64' },
  'linux-arm64-musl': { os: 'linux', arch: 'arm64' },
  'linux-x64': { os: 'linux', arch: 'amd64' },
  'linux-x64-musl': { os: 'linux', arch: 'amd64' },
  'win32-arm64': { os: 'windows', arch: 'arm64' },
  'win32-x64': { os: 'windows', arch: 'amd64' },
}

// The canonical Socket platform string for THIS runner, matching the
// external-tools.json `platforms` keys (linux-x64, linux-arm64-musl,
// darwin-arm64, win32-x64, …). process.platform is `win32` on Windows (the
// schema keys are win32-*, NOT win-* — so do NOT use platform.mjs's win-
// output here). Detects musl via Node's own process.report so we don't shell
// out to ldd; falls back to probing for the musl loader when the report has
// no glibcVersionRuntime (mirrors platform.mjs).
export function canonicalPlatformKey() {
  const archMap = { __proto__: null, arm64: 'arm64', x64: 'x64' }
  const arch = archMap[process.arch]
  if (!arch) {
    throw new Error(`unsupported arch: ${process.arch}`)
  }
  let platform
  if (process.platform === 'darwin') {
    platform = 'darwin'
  } else if (process.platform === 'linux') {
    platform = 'linux'
  } else if (process.platform === 'win32') {
    platform = 'win32'
  } else {
    throw new Error(`unsupported platform: ${process.platform}`)
  }
  let suffix = ''
  if (platform === 'linux') {
    const libc = process.report?.getReport?.().header.glibcVersionRuntime
    if (libc === 'musl') {
      suffix = '-musl'
    } else if (!libc) {
      const isMusl = ['/lib', '/lib64'].some(d => {
        if (!existsSync(d)) {
          return false
        }
        try {
          return readdirSync(d).some(f => f.startsWith('ld-musl-'))
        } catch {
          return false
        }
      })
      if (isMusl) {
        suffix = '-musl'
      }
    }
  }
  return `${platform}-${arch}${suffix}`
}

// Resolve a platform entry from a `platforms` map, with a musl → glibc
// fallback for tools that ship no musl asset (e.g. Go — the glibc archive is
// statically linked and runs on musl too). Returns { entry, fallbackKey } —
// entry is the matched PlatformEntry or undefined; fallbackKey is the glibc
// key the lookup fell back to (undefined when the canonical key hit directly
// or no fallback applied). Pure.
export function resolvePlatformEntry(platforms, canonicalKey) {
  const entry = platforms[canonicalKey]
  if (entry) {
    return { entry, fallbackKey: undefined }
  }
  // musl → glibc sibling fallback (linux-x64-musl → linux-x64).
  if (canonicalKey.endsWith('-musl')) {
    const glibcKey = canonicalKey.slice(0, -5)
    const fallback = platforms[glibcKey]
    if (fallback) {
      return { entry: fallback, fallbackKey: glibcKey }
    }
  }
  return { entry: undefined, fallbackKey: undefined }
}

// Normalize an integrity field (string SRI form OR the object provenance form
// { value, src?, date? }) to the SRI string install-tool.mjs verifies. Pure.
export function integrityValue(integrity) {
  if (typeof integrity === 'object' && integrity !== null) {
    return integrity.value
  }
  return integrity
}

// Extract the provenance fields (src, date) from an integrity field. Returns
// { src: '', date: '' } for the string form (no provenance) so install-tool.mjs
// can forward them as --src/--date flags unconditionally. Pure.
export function integrityProvenance(integrity) {
  if (typeof integrity === 'object' && integrity !== null) {
    return {
      src: typeof integrity.src === 'string' ? integrity.src : '',
      date: typeof integrity.date === 'string' ? integrity.date : '',
    }
  }
  return { src: '', date: '' }
}

// Read a `go <version>` line from a go.mod file (the only --version-file
// consumer today). Returns '' when the file is absent or has no go directive.
// Pure given the file path (reads the filesystem).
export function readVersionFromFile(file) {
  if (!file || !existsSync(file)) {
    return ''
  }
  const src = readFileSync(file, 'utf8')
  // `go <major>.<minor>[.<patch>]` from a go.mod — the optional .patch is the
  // only alternation, so the regex is self-evident in context.
  // oxlint-disable-next-line socket/require-regex-comment -- go.mod directive
  const m = /^go\s+(\d+\.\d+(?:\.\d+)?)/m.exec(src)
  return m ? m[1] : ''
}

// Resolve a Go asset URL + SHA-256 SRI for a custom version from the go.dev
// release manifest (https://go.dev/dl/?mode=json). Go publishes checksums for
// EVERY release, so a custom go-version still gets SRI-verified before
// extract. Returns { asset, integrity, version } or throws when the manifest
// has no matching stable release or no archive for the platform. Pure given
// the manifest object (no network).
export function resolveGoAssetFromManifest(manifest, version, canonicalKey) {
  const goOsArch = GO_OS_ARCH[canonicalKey]
  if (!goOsArch) {
    throw new Error(`go: no os/arch mapping for ${canonicalKey}`)
  }
  const want = `go${version}`
  const release = Array.isArray(manifest)
    ? manifest.find(r => r.version === want && r.stable)
    : undefined
  if (!release) {
    throw new Error(
      `go.dev manifest has no stable release '${want}' (resolved version ${version})`,
    )
  }
  const file = Array.isArray(release.files)
    ? release.files.find(
        f =>
          f.os === goOsArch.os &&
          f.arch === goOsArch.arch &&
          f.kind === 'archive',
      )
    : undefined
  if (!file || !file.sha256 || !file.filename) {
    throw new Error(
      `go.dev release ${want} has no archive for ${goOsArch.os}-${goOsArch.arch}`,
    )
  }
  return {
    asset: `https://go.dev/dl/${file.filename}`,
    integrity: `sha256-${file.sha256}`,
    version: String(version),
  }
}

// ── CLI orchestration (guarded) ───────────────────────────────────────────

function isMainModule() {
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

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : ''
}

async function main() {
  const toolName = argValue('--tool')
  const versionArg = argValue('--version')
  const versionFile = argValue('--version-file')
  const toolsFileArg = argValue('--tools-file')

  if (!toolName) {
    fail(
      'usage: resolve-external-tool-asset.mjs --tool <name> [--version <v>] [--version-file <path>] [--tools-file <path>]',
    )
    process.exit(1)
  }

  const toolsFile =
    toolsFileArg ||
    path.join(
      process.env['GITHUB_WORKSPACE'] ?? '.',
      'scripts/fleet/setup/external-tools.json',
    )

  if (!existsSync(toolsFile)) {
    fail(`× external-tools.json not found at ${toolsFile}`)
    process.exit(1)
  }

  let toolsData
  try {
    toolsData = JSON.parse(readFileSync(toolsFile, 'utf8'))
  } catch (e) {
    fail(`× could not parse ${toolsFile}: ${e?.message ?? e}`)
    process.exit(1)
  }

  const tools = toolsData?.tools || {}
  const tool = tools[toolName]
  if (!tool) {
    fail(`× no '${toolName}' entry in ${toolsFile}`)
    process.exit(1)
  }
  if (!tool.platforms) {
    fail(`× '${toolName}' has no platforms map in ${toolsFile}`)
    process.exit(1)
  }

  const canonicalKey = canonicalPlatformKey()

  const { entry, fallbackKey } = resolvePlatformEntry(
    tool.platforms,
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
    process.exit(1)
  }

  let resolvedVersion = ''
  const fileVersion = readVersionFromFile(versionFile)
  if (fileVersion) {
    resolvedVersion = fileVersion
  } else if (versionArg && versionArg !== 'stable') {
    resolvedVersion = versionArg
  }
  if (!resolvedVersion) {
    resolvedVersion = tool.version
  }
  if (!resolvedVersion) {
    fail(`× no version resolved for '${toolName}' (no pin, no input)`)
    process.exit(1)
  }

  // Pinned-version fast path: emit the entry's asset + integrity. A version
  // override on `go` is resolved live against go.dev below; every other tool
  // requires the pinned version (the pin IS the integrity source).
  const isGo = toolName === 'go' || tool.manager === 'go'
  const pinVersion = tool.version || ''
  if (!isGo || resolvedVersion === pinVersion) {
    const asset = entry.asset
    const integrity = integrityValue(entry.integrity)
    if (!asset || !integrity) {
      fail(
        `× '${toolName}' ${canonicalKey} entry is missing asset or integrity in ${toolsFile}`,
      )
      process.exit(1)
    }
    // Forward the object-form provenance (src/date) so install-tool.mjs can
    // run the live src + staleness checks after the static SRI check. Empty
    // for the string form (no provenance) — install-tool.mjs no-ops them.
    const { src, date } = integrityProvenance(entry.integrity)
    emit({ asset, integrity, version: resolvedVersion, src, date })
    return
  }

  // go custom-version path: resolve the SHA-256 from the go.dev manifest.
  let manifest
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
    manifest = await res.json()
  } catch (e) {
    fail(`× go.dev manifest fetch failed: ${e?.message ?? e}`)
    process.exit(1)
  }

  try {
    emit(resolveGoAssetFromManifest(manifest, resolvedVersion, canonicalKey))
  } catch (e) {
    fail(`× ${e?.message ?? e}`)
    process.exit(1)
  }
}

if (isMainModule()) {
  void main()
}
