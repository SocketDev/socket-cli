/**
 * @file The one pack-and-inspect plumbing for the tarball release gates —
 *   `pnpm pack` into a temp dir, list the entries both plain AND verbose so
 *   the mode column is available, read the PACKED manifest, and extract one
 *   entry's bytes on demand. Two checks consume it:
 *   `pack-contents-are-clean.mts` for the files-field and structure gates,
 *   `pack-bytes-have-no-private-refs.mts` for the leak scan of the packed
 *   bytes. Factored out the same way `_shared/pack-files.mts` was, so the
 *   pack surface has one implementation and the gates cannot drift.
 *   Each check packs independently when run standalone; there is no
 *   cross-check cache. Dependency-light: node builtins plus the fleet spawn +
 *   tar-executable helpers.
 */

import { existsSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// oxlint-disable-next-line socket/prefer-async-spawn -- sync CLI checks; pack, listing, and extraction are sequential by nature.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { tarExecutable } from './tar-executable.mts'

/**
 * The directory prefix every npm/pnpm tarball entry carries.
 */
export const PACK_ENTRY_PREFIX = 'package/'

/**
 * Per-entry byte ceiling for a text scan of packed bytes. An entry whose
 * decompressed bytes exceed this is skipped rather than buffered — a
 * multi-megabyte wasm/binary blob is not a text-leak surface, and an
 * unbounded read would let a large tarball OOM the gate.
 */
export const PACK_ENTRY_SCAN_MAX_BYTES = 16 * 1024 * 1024

/**
 * One tarball entry as `tar -tvzf` reported it.
 */
export interface PackListingEntry {
  /**
   * The 10-character mode column, e.g. `-rw-r--r--` or `lrwxr-xr-x`. The
   * first character is the entry type (`-` regular, `d` directory, `l`
   * symlink, `h` hardlink, `b`/`c` device, `p` FIFO).
   */
  readonly mode: string
  /**
   * The tarball-relative path, leading `package/` stripped.
   */
  readonly path: string
  /**
   * The path exactly as tar listed it — what an extraction must pass.
   */
  readonly rawPath: string
}

/**
 * The subset of a PACKED package.json the tarball gates read.
 */
export interface PackedManifest {
  readonly bin?: Record<string, unknown> | string | undefined
  readonly directories?: { bin?: unknown | undefined } | undefined
  readonly files?: string[] | undefined
  readonly name?: string | undefined
  readonly private?: boolean | undefined
  readonly scripts?: Record<string, unknown> | undefined
}

export interface PackInspection {
  /**
   * Tarball entries, stripped of the leading `package/`.
   */
  readonly entries: string[]
  /**
   * The same entries paired with their mode column, in archive order.
   */
  readonly listing: PackListingEntry[]
  /**
   * The PACKED package.json — what consumers actually install.
   */
  readonly packedManifest: PackedManifest | undefined
  /**
   * The `scripts` map of the PACKED package.json.
   */
  readonly packedScripts: Record<string, unknown> | undefined
  /**
   * Absolute path to the packed tarball, for on-demand entry extraction.
   */
  readonly tarball: string
}

// The mode column tar prints for one entry: a type character then nine
// permission characters, optionally trailed by a `+`/`@` ACL/xattr marker
// (bsdtar) before the first space.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const TAR_MODE_RE = /^([-bcdhlps][-rwxsStTlL]{9})[+@.]?(?:\s|$)/

/**
 * The mode column of one `tar -tvzf` line, or undefined when the line does
 * not open with a parseable mode. A caller that cannot parse every line must
 * fail loud rather than assume the entry is regular.
 */
export function parseTarModeColumn(line: string): string | undefined {
  const m = TAR_MODE_RE.exec(line)
  return m ? m[1] : undefined
}

/**
 * Strip the leading `package/` from a tarball entry path. A path that does
 * not carry the prefix is returned unchanged.
 */
export function stripPackEntryPrefix(rawPath: string): string {
  return rawPath.startsWith(PACK_ENTRY_PREFIX)
    ? rawPath.slice(PACK_ENTRY_PREFIX.length)
    : rawPath
}

/**
 * Pair a plain `tar -tzf` path list with a verbose `tar -tvzf` listing, in
 * archive order — tar lists the same archive in the same order both times, so
 * index `i` of one is index `i` of the other. Undefined when the two listings
 * disagree in length or a verbose line has no parseable mode column; the
 * caller fails loud instead of guessing an entry's type. Pure.
 */
export function pairTarListings(
  rawPaths: readonly string[],
  verboseLines: readonly string[],
): PackListingEntry[] | undefined {
  if (rawPaths.length !== verboseLines.length) {
    return undefined
  }
  const listing: PackListingEntry[] = []
  for (let i = 0, { length } = rawPaths; i < length; i += 1) {
    const rawPath = rawPaths[i]!
    const mode = parseTarModeColumn(verboseLines[i]!)
    if (!mode) {
      return undefined
    }
    listing.push({
      __proto__: null,
      mode,
      path: stripPackEntryPrefix(rawPath),
      rawPath,
    } as PackListingEntry)
  }
  return listing
}

function splitLines(stdout: unknown): string[] {
  return String(stdout ?? '')
    .split('\n')
    .map(s => s.trimEnd())
    .filter(Boolean)
}

/**
 * Pack the package at `pkgRoot` into a temp dir and return its entry list
 * (plain + mode-paired), the packed manifest, and the tarball path. Undefined
 * on any pack / listing / manifest-parse failure — the caller fails loud.
 */
export function packAndInspect(pkgRoot: string): PackInspection | undefined {
  const dest = mkdtempSync(path.join(os.tmpdir(), 'pack-inspect-'))
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', dest], {
    cwd: pkgRoot,
    timeout: 180_000,
  })
  if (packed.status !== 0) {
    return undefined
  }
  // pnpm prints the tarball path as the last non-empty stdout line.
  const tarball = splitLines(packed.stdout)
    .map(s => s.trim())
    .at(-1)
  if (!tarball || !existsSync(tarball)) {
    return undefined
  }
  const tar = tarExecutable()
  const listed = spawnSync(tar, ['-tzf', tarball], { timeout: 60_000 })
  if (listed.status !== 0) {
    return undefined
  }
  const rawPaths = splitLines(listed.stdout).map(s => s.trim())
  // The VERBOSE listing carries the mode column the structure gate needs
  // (entry type + exec bits). Same archive, same order, so the two listings
  // pair by index.
  const listedVerbose = spawnSync(tar, ['-tvzf', tarball], { timeout: 60_000 })
  if (listedVerbose.status !== 0) {
    return undefined
  }
  const listing = pairTarListings(rawPaths, splitLines(listedVerbose.stdout))
  if (!listing) {
    return undefined
  }
  // The manifest consumers actually install is the one INSIDE the tarball —
  // the on-disk manifest can differ (pnpm's exportable rewrite, the publish
  // pipeline's pack-time pruning), so read the packed bytes.
  const manifestRead = spawnSync(
    tar,
    ['-xzOf', tarball, `${PACK_ENTRY_PREFIX}package.json`],
    { timeout: 60_000 },
  )
  if (manifestRead.status !== 0) {
    return undefined
  }
  let packedManifest: PackedManifest | undefined
  try {
    packedManifest = JSON.parse(String(manifestRead.stdout ?? '')) as
      | PackedManifest
      | undefined
  } catch {
    return undefined
  }
  return {
    entries: rawPaths.map(stripPackEntryPrefix),
    listing,
    packedManifest,
    packedScripts: packedManifest?.scripts,
    tarball,
  }
}

/**
 * Extract one tarball entry's bytes as UTF-8 text. Undefined when tar fails
 * or the decompressed entry exceeds `maxBytes` — an oversized entry is
 * skipped, never truncated-and-scanned, because a partial scan is a false
 * green.
 */
export function readPackEntryText(
  tarball: string,
  rawPath: string,
  maxBytes: number = PACK_ENTRY_SCAN_MAX_BYTES,
): string | undefined {
  const result = spawnSync(tarExecutable(), ['-xzOf', tarball, rawPath], {
    maxBuffer: maxBytes,
    timeout: 60_000,
  })
  if (result.error || result.status !== 0) {
    return undefined
  }
  return String(result.stdout ?? '')
}
