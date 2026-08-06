/**
 * @file Byte / value-shape arm of the fleet telemetry scan. The name arm in
 *   lib/telemetry-scan.mts matches package NAMES in a lockfile, so it is blind
 *   to a dependency that inlines its analytics client into its own shipped
 *   bundle: nothing named posthog/segment/sentry ever reaches the lockfile,
 *   and the gate reports green. This arm reads the installed payloads instead
 *   of their names and matches the value shapes a bundler cannot erase. The
 *   shapes themselves live in lib/telemetry-payload-shapes.mts.
 *   The live profile that motivated it: a config-loading CLI declares
 *   `"dependencies": {}`, bundles its whole runtime into `dist/` with
 *   treeshaking, hardcodes a `phc_` PostHog project key next to a vendor-proxy
 *   ingest host, and posts a usage event per invocation from a hand-rolled
 *   `fetch()`. No analytics package name appears in any lockfile, so the name
 *   arm passes it clean. The bundle still has to carry the literal host and
 *   the literal key, which is what this arm reads.
 *   Both arms run. The name arm stays the cheap first line, since it catches
 *   an SDK that ships un-bundled and names the offending package precisely,
 *   and this arm catches the residue it structurally cannot see.
 *   NO PACKAGE PRE-FILTER, ON PURPOSE. The obvious cheap path is to deep-scan
 *   only packages matching the profile above: few or no declared runtime
 *   dependencies plus a bundled output directory. Measured on the wheelhouse
 *   tree of 407 installed packages and 989 MiB of node_modules, that filter
 *   selects 194 of 407 packages but drops only 196 of 5,072 files and 3 of
 *   101 MiB, because the fleet's byte weight already sits in low-dep bundled
 *   packages — and the per-package manifest reads the filter needs cost MORE
 *   than the reads they avoid, 2.85s filtered against 2.50s unfiltered. It
 *   also opens a real blind spot, since a package with many declared
 *   dependencies that ALSO bundles an analytics client would be skipped to
 *   save 3% of the bytes. So the cost control here is per-file rather than
 *   per-package: a bundle-directory allowlist, a size cap that skips and
 *   counts oversized blobs, a streaming read that keeps peak memory flat, and
 *   the single combined screen regex in the shapes module that lets a chunk
 *   matching nothing cost one regex pass instead of 28. That screen is where
 *   the real saving is: it took a 101 MiB / 5,071-file scan of this tree from
 *   5.6s to 1.2s warm, 2.6s cold, with an identical finding set.
 */

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs'
import path from 'node:path'

import { resolvePnpmVirtualStoreDir } from '../paths.mts'
import {
  REVIEWED_TELEMETRY_PAYLOADS,
  scanTextForTelemetryShapes,
  telemetryPayloadBaselineKey,
} from './telemetry-payload-shapes.mts'

import type { TelemetryShapeHit } from './telemetry-payload-shapes.mts'

/**
 * One matched shape, located to the package and file that carried it.
 */
export interface TelemetryPayloadFinding {
  readonly baselineKey: string
  readonly file: string
  readonly kind: 'host' | 'key'
  readonly packageName: string
  readonly packageVersion: string
  readonly redacted: string
  readonly shapeId: string
  readonly vendor: string
}

/**
 * What a payload scan actually READ, so a run that opened nothing is visible
 * as a vacuous scan instead of a green.
 */
export interface TelemetryPayloadScanResult {
  readonly bytesScanned: number
  readonly elapsedMs: number
  readonly filesScanned: number
  readonly filesSkippedTooLarge: number
  readonly findings: readonly TelemetryPayloadFinding[]
  readonly installed: boolean
  readonly packagesScanned: number
  readonly packagesTruncated: number
  readonly storeDir: string
}

// Output directories a bundled payload ships in. A package's un-bundled source
// tree is not scanned: if it imports an analytics SDK un-bundled, the SDK is a
// real dependency and the NAME arm already names it.
const BUNDLE_DIR_NAMES: readonly string[] = [
  'bundle',
  'build',
  'cjs',
  'dist',
  'esm',
  'lib',
  'out',
]

// Chunk size for the streaming read. One MiB keeps peak memory flat across a
// multi-megabyte bundle.
const CHUNK_BYTES = 1024 * 1024

// Bytes of each chunk re-tested with the next one, so a match straddling a
// chunk boundary is still found. Comfortably longer than the longest run any
// shape can match.
const CHUNK_OVERLAP_BYTES = 512

const SCANNED_EXTENSIONS: ReadonlySet<string> = new Set(['.cjs', '.js', '.mjs'])

// Defensive cap so one pathological package cannot dominate the scan. Set
// well above any real package: the widest in the wheelhouse tree ships 682
// bundle files, and a cap that silently truncated a large lib would be the
// silent hole this scanner exists to close. Truncation is counted and
// reported, never quiet.
const MAX_FILES_PER_PACKAGE = 3000

// Bundle trees are shallow. Four levels reaches `dist/src/third_party/x.js`
// without walking a package's whole nested output.
const MAX_SCAN_DEPTH = 4

// Files past this are wasm blobs, JS with an inlined source map, and vendored
// data dumps. Skipped and COUNTED, so the cap shows up in the gate output
// rather than becoming a silent hole.
const MAX_SCAN_FILE_BYTES = 8 * 1024 * 1024

function collectBundleFiles(
  dir: string,
  depth: number,
  out: string[],
): string[] {
  if (depth > MAX_SCAN_DEPTH || out.length >= MAX_FILES_PER_PACKAGE) {
    return out
  }
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    if (out.length >= MAX_FILES_PER_PACKAGE) {
      break
    }
    const entry = entries[i]!
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectBundleFiles(full, depth + 1, out)
      continue
    }
    if (entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

// Every installed package directory in a pnpm virtual store, scope-aware.
function listInstalledPackageDirs(storeDir: string): string[] {
  const out: string[] = []
  let storeEntries
  try {
    storeEntries = readdirSync(storeDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (let i = 0, { length } = storeEntries; i < length; i += 1) {
    const storeEntry = storeEntries[i]!
    if (!storeEntry.isDirectory() || storeEntry.name === 'node_modules') {
      continue
    }
    const base = path.join(storeDir, storeEntry.name, 'node_modules')
    let inner
    try {
      inner = readdirSync(base, { withFileTypes: true })
    } catch {
      continue
    }
    for (let j = 0, innerLength = inner.length; j < innerLength; j += 1) {
      const dirent = inner[j]!
      if (!dirent.isDirectory()) {
        continue
      }
      if (!dirent.name.startsWith('@')) {
        out.push(path.join(base, dirent.name))
        continue
      }
      const scopeDir = path.join(base, dirent.name)
      let scoped
      try {
        scoped = readdirSync(scopeDir, { withFileTypes: true })
      } catch {
        continue
      }
      for (let k = 0, scopedLength = scoped.length; k < scopedLength; k += 1) {
        const scopedEntry = scoped[k]!
        if (scopedEntry.isDirectory()) {
          out.push(path.join(scopeDir, scopedEntry.name))
        }
      }
    }
  }
  return out
}

// `name` + `version` from an installed manifest, or undefined when the
// directory carries no readable package.json.
function readInstalledManifest(
  pkgDir: string,
): { name: string; version: string } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }
  const record = parsed as Record<string, unknown>
  const name = typeof record['name'] === 'string' ? record['name'] : ''
  if (!name) {
    return undefined
  }
  return {
    name,
    version: typeof record['version'] === 'string' ? record['version'] : '',
  }
}

/**
 * Stream one payload file and return the shapes it carries. Read in fixed
 * chunks with an overlap tail so peak memory stays flat on a multi-megabyte
 * bundle and a match straddling a chunk boundary is still found. Decoded
 * latin1: every shape is ASCII, and latin1 cannot corrupt a match by splitting
 * a multi-byte sequence across chunks the way utf8 can.
 */
export function scanPayloadFileForTelemetryShapes(
  filePath: string,
  fileSize: number,
): TelemetryShapeHit[] {
  const found = new Map<string, TelemetryShapeHit>()
  let fd: number
  try {
    fd = openSync(filePath, 'r')
  } catch {
    return []
  }
  try {
    const buf = Buffer.allocUnsafe(CHUNK_BYTES)
    let tail = ''
    let pos = 0
    while (pos < fileSize) {
      const read = readSync(fd, buf, 0, CHUNK_BYTES, pos)
      if (read <= 0) {
        break
      }
      pos += read
      const text = tail + buf.toString('latin1', 0, read)
      for (const hit of scanTextForTelemetryShapes(text)) {
        if (!found.has(hit.shape.id)) {
          found.set(hit.shape.id, hit)
        }
      }
      tail = text.slice(-CHUNK_OVERLAP_BYTES)
    }
  } finally {
    closeSync(fd)
  }
  return [...found.values()]
}

/**
 * Scan every installed dependency payload under a repo's pnpm virtual store
 * and return the shapes found, alongside the cost the scan paid to find them.
 *
 * `installed: false` means the store is absent, which is what a checkout with
 * no install looks like. That is an explicit SKIP for the caller to report,
 * never a pass, because the arm measured nothing.
 */
export function scanInstalledTelemetryPayloads(
  repoRoot: string,
): TelemetryPayloadScanResult {
  const startedAt = Date.now()
  const storeDir = resolvePnpmVirtualStoreDir(repoRoot)
  if (!existsSync(storeDir)) {
    return {
      bytesScanned: 0,
      elapsedMs: Date.now() - startedAt,
      filesScanned: 0,
      filesSkippedTooLarge: 0,
      findings: [],
      installed: false,
      packagesScanned: 0,
      packagesTruncated: 0,
      storeDir,
    }
  }
  const findings: TelemetryPayloadFinding[] = []
  const pkgDirs = listInstalledPackageDirs(storeDir)
  let bytesScanned = 0
  let filesScanned = 0
  let filesSkippedTooLarge = 0
  let packagesScanned = 0
  let packagesTruncated = 0
  for (let i = 0, { length } = pkgDirs; i < length; i += 1) {
    const pkgDir = pkgDirs[i]!
    const manifest = readInstalledManifest(pkgDir)
    if (!manifest) {
      continue
    }
    packagesScanned += 1
    const files: string[] = []
    for (
      let j = 0, dirLength = BUNDLE_DIR_NAMES.length;
      j < dirLength;
      j += 1
    ) {
      const bundleDir = path.join(pkgDir, BUNDLE_DIR_NAMES[j]!)
      if (existsSync(bundleDir)) {
        collectBundleFiles(bundleDir, 0, files)
      }
    }
    if (files.length >= MAX_FILES_PER_PACKAGE) {
      packagesTruncated += 1
    }
    // One finding per shape per package. A shape repeated across every chunk
    // of a dual esm/cjs build is the same fact, and the first file that
    // carried it is the receipt an operator needs.
    const seen = new Set<string>()
    for (let j = 0, fileLength = files.length; j < fileLength; j += 1) {
      const filePath = files[j]!
      let size: number
      try {
        size = statSync(filePath).size
      } catch {
        continue
      }
      if (size > MAX_SCAN_FILE_BYTES) {
        filesSkippedTooLarge += 1
        continue
      }
      filesScanned += 1
      bytesScanned += size
      for (const hit of scanPayloadFileForTelemetryShapes(filePath, size)) {
        if (seen.has(hit.shape.id)) {
          continue
        }
        seen.add(hit.shape.id)
        findings.push({
          baselineKey: telemetryPayloadBaselineKey(manifest.name, hit.shape.id),
          file: path.relative(repoRoot, filePath),
          kind: hit.shape.kind,
          packageName: manifest.name,
          packageVersion: manifest.version,
          redacted: hit.display,
          shapeId: hit.shape.id,
          vendor: hit.shape.vendor,
        })
      }
    }
  }
  findings.sort((a, b) => a.baselineKey.localeCompare(b.baselineKey))
  return {
    bytesScanned,
    elapsedMs: Date.now() - startedAt,
    filesScanned,
    filesSkippedTooLarge,
    findings,
    installed: true,
    packagesScanned,
    packagesTruncated,
    storeDir,
  }
}

/**
 * The fail set: findings with no reviewed-baseline entry.
 */
export function unreviewedPayloadFindings(
  findings: readonly TelemetryPayloadFinding[],
): TelemetryPayloadFinding[] {
  return findings.filter(f => !(f.baselineKey in REVIEWED_TELEMETRY_PAYLOADS))
}
