/*
 * @file Pure structural classifiers for a packed npm tarball, driven off the
 *   verbose (`tar -tvzf`) listing's mode column. Split out of
 *   `check/pack-contents-are-clean.mts` (soft 500-line cap) so the gate keeps
 *   one job per module: this file decides WHAT is wrong, the check decides
 *   what to do about it. No I/O — every function takes a listing and returns
 *   findings, so a synthetic listing drives them in tests.
 *
 *   The rules, each an extraction-time or install-time hazard an entry-list
 *   scan cannot see:
 *
 *   - Non-regular entries. A symlink, hardlink, device node, FIFO, or socket
 *     in a tarball is an escape primitive — the extractor resolves it.
 *   - Duplicate entry paths. Which copy survives is extractor-defined, so a
 *     benign first copy can be shadowed by a hostile second.
 *   - `..` path segments and backslashes. Both escape the package directory,
 *     the backslash only on Windows, which is exactly why it is missed.
 *   - A declared `bin` / `directories.bin` target without the executable bit.
 *     npm packs whatever mode is on disk; a non-executable bin ships a CLI
 *     that cannot run.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type { PackedManifest, PackListingEntry } from './pack-inspect.mts'

/**
 * One structural defect in the tarball, read from the verbose tar listing.
 */
export interface PackStructureFinding {
  /**
   * What is wrong with the entry, in fail-loud message terms.
   */
  readonly detail: string
  /**
   * Which structural rule the entry broke.
   */
  readonly kind:
    | 'backslash-path'
    | 'duplicate-path'
    | 'non-regular-entry'
    | 'path-traversal'
  /**
   * The tarball-relative entry path.
   */
  readonly path: string
}

// Mode-column type characters an npm tarball may legitimately carry: a
// regular file or a directory. Everything else (`l` symlink, `h` hardlink,
// `b`/`c` device, `p` FIFO, `s` socket) is an extraction-time escape
// primitive and never belongs in a published package.
const REGULAR_ENTRY_TYPES = new Set(['-', 'd'])

/**
 * Human-readable label for the entry type a mode column opens with.
 */
export function describePackEntryType(mode: string): string {
  switch (mode.charAt(0)) {
    case 'b':
      return 'block device'
    case 'c':
      return 'character device'
    case 'h':
      return 'hard link'
    case 'l':
      return 'symbolic link'
    case 'p':
      return 'FIFO (named pipe)'
    case 's':
      return 'socket'
    default:
      return `unknown entry type "${mode.charAt(0)}"`
  }
}

/**
 * Structural defects in a verbose tarball listing: non-regular entries,
 * duplicate entry paths, `..` path segments, and backslashes in a path. Pure —
 * drive it with a synthetic listing in tests.
 */
export function classifyPackStructure(
  listing: readonly PackListingEntry[],
): PackStructureFinding[] {
  const findings: PackStructureFinding[] = []
  const seen = new Set<string>()
  for (let i = 0, { length } = listing; i < length; i += 1) {
    const { mode, path: entryPath } = listing[i]!
    if (!REGULAR_ENTRY_TYPES.has(mode.charAt(0))) {
      findings.push({
        __proto__: null,
        detail: `mode "${mode}" — a ${describePackEntryType(mode)}, not a regular file or directory`,
        kind: 'non-regular-entry',
        path: entryPath,
      } as PackStructureFinding)
    }
    if (seen.has(entryPath)) {
      findings.push({
        __proto__: null,
        detail:
          'listed more than once — which copy an extractor keeps is extractor-defined',
        kind: 'duplicate-path',
        path: entryPath,
      } as PackStructureFinding)
    }
    seen.add(entryPath)
    // oxlint-disable-next-line socket/normalize-path-before-match -- normalizePath COLLAPSES `..` (`lib/../../x` → `../x`), which hides the interior traversal this arm exists to find; the raw listing path is the only honest input.
    if (entryPath.split('/').includes('..')) {
      findings.push({
        __proto__: null,
        detail:
          'carries a ".." path segment — extraction can escape the package directory',
        kind: 'path-traversal',
        path: entryPath,
      } as PackStructureFinding)
    }
    // oxlint-disable-next-line socket/normalize-path-before-match -- normalizePath REWRITES a backslash to a forward slash, erasing the exact character this arm looks for; the raw listing path is the only honest input.
    if (entryPath.includes('\\')) {
      findings.push({
        __proto__: null,
        detail:
          'carries a backslash — a path separator on Windows, so the entry lands somewhere else there',
        kind: 'backslash-path',
        path: entryPath,
      } as PackStructureFinding)
    }
  }
  return findings
}

/**
 * The tarball-relative paths a PACKED manifest declares as executables: every
 * `bin` target in either the string or the map form, plus every packed entry
 * under `directories.bin`. Paths are normalized and de-duplicated; a declared
 * target that is not in `entries` is skipped — the files-field gate above
 * already reports a missing declared file. Pure.
 */
export function findPackBinTargets(
  manifest: PackedManifest | undefined,
  entries: readonly string[],
): string[] {
  const entrySet = new Set(entries.map(e => normalizePath(e)))
  const targets = new Set<string>()
  const addTarget = (value: unknown): void => {
    if (typeof value !== 'string' || !value) {
      return
    }
    const rel = normalizePath(value).replace(/^\.\//, '')
    if (entrySet.has(rel)) {
      targets.add(rel)
    }
  }
  const { bin } = manifest ?? {}
  if (typeof bin === 'string') {
    addTarget(bin)
  } else if (bin && typeof bin === 'object') {
    const binValues = Object.values(bin)
    for (let i = 0, { length } = binValues; i < length; i += 1) {
      addTarget(binValues[i])
    }
  }
  const binDir = manifest?.directories?.bin
  if (typeof binDir === 'string' && binDir) {
    const prefix = `${normalizePath(binDir).replace(/^\.\//, '').replace(/\/+$/, '')}/`
    for (const entry of entrySet) {
      if (entry.startsWith(prefix)) {
        targets.add(entry)
      }
    }
  }
  return [...targets].toSorted()
}

/**
 * A declared bin target whose mode column is missing an executable bit.
 */
export interface NonExecutablePackBin {
  /**
   * The entry's full mode column, so the message shows what was seen.
   */
  readonly mode: string
  /**
   * The tarball-relative bin path.
   */
  readonly path: string
}

// Mode-string offsets of the user / group / other execute bits.
const EXEC_BIT_OFFSETS = [3, 6, 9] as const

/**
 * True when a mode column carries the user, group, AND other execute bits.
 * A setuid/setgid `s` is deliberately NOT accepted — a published tarball has
 * no business shipping one. Pure.
 */
export function packModeIsExecutable(mode: string): boolean {
  for (let i = 0, { length } = EXEC_BIT_OFFSETS; i < length; i += 1) {
    if (mode.charAt(EXEC_BIT_OFFSETS[i]!) !== 'x') {
      return false
    }
  }
  return true
}

/**
 * Declared bin targets in the tarball that are not executable. Pure.
 */
export function findNonExecutablePackBins(
  listing: readonly PackListingEntry[],
  binTargets: readonly string[],
): NonExecutablePackBin[] {
  const wanted = new Set(binTargets)
  const bad: NonExecutablePackBin[] = []
  for (let i = 0, { length } = listing; i < length; i += 1) {
    const { mode, path: entryPath } = listing[i]!
    if (wanted.has(entryPath) && !packModeIsExecutable(mode)) {
      bad.push({
        __proto__: null,
        mode,
        path: entryPath,
      } as NonExecutablePackBin)
    }
  }
  return bad
}

/**
 * The fail-loud report for structural tarball defects: What / Where /
 * Saw-vs-wanted / Fix. Pure, so the wording is unit-testable.
 */
export function formatPackStructureReport(
  pkgName: string,
  findings: readonly PackStructureFinding[],
): string {
  const lines = [
    `[pack-contents-are-clean] ${pkgName} tarball has ${findings.length} structural defect${findings.length === 1 ? '' : 's'} — an npm tarball must contain only regular files and directories, each listed once, under a relative forward-slash path:`,
  ]
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    lines.push(`  ${f.path}`, `    saw: ${f.detail}`)
  }
  lines.push(
    '',
    '  wanted: every entry a regular file or directory, no duplicate path, no',
    '  ".." segment, no backslash.',
    '  Fix: remove the offending path from the pack surface (tighten',
    '  package.json `files` or .npmignore). If a build step created a symlink',
    '  or a duplicate under a packed directory, make it emit a real file —',
    '  npm preserves link entries and extractors resolve them at install time.',
  )
  return lines.join('\n')
}

/**
 * The fail-loud report for declared bins that are not executable in the
 * tarball. Pure.
 */
export function formatNonExecutablePackBinReport(
  pkgName: string,
  bins: readonly NonExecutablePackBin[],
): string {
  const lines = [
    `[pack-contents-are-clean] ${pkgName} tarball ships ${bins.length} declared bin${bins.length === 1 ? '' : 's'} without the executable bit — the installed CLI shim cannot run:`,
  ]
  for (let i = 0, { length } = bins; i < length; i += 1) {
    const b = bins[i]!
    lines.push(`  ${b.path}`, `    saw mode: ${b.mode}`)
  }
  lines.push(
    '',
    '  wanted: mode with the user, group, and other execute bits set',
    '  (-rwxr-xr-x).',
    '  Fix: `chmod +x <bin>` and commit the mode (`git update-index',
    '  --chmod=+x <bin>`); a bin generated at build time must be chmod-ed by',
    '  the build step, npm packs whatever mode is on disk.',
  )
  return lines.join('\n')
}
