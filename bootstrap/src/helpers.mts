/*
 * @file Source module for the dep-0 fleet bundle installer. Holds the inline
 *   types + the pure/IO/verification helpers that the entry (`./fleet.mts`)
 *   and `./install.mts` share. Built (inlined) into the single distributed
 *   `bootstrap/fleet.mjs` by `scripts/fleet/build-bootstrap-fetcher.mts`; the
 *   modular source keeps each unit under the file-size cap while the consumer
 *   still copies one self-contained fetcher. Zero deps beyond node: builtins
 *   (no `@socketsecurity/*` — never the in-repo socket-lib).
 */

// socket-lint: allow source-method-order -- helpers grouped by concern (markers → splice → yaml → io → verify), mirroring the dep-0 fetcher's call-flow rather than alphabetized.

import crypto from 'node:crypto'
// oxlint-disable-next-line socket/prefer-spawn-over-execsync -- dep-0 bare-node fetcher (documented invariant: never imports in-repo socket-lib): gh/tar run via node:child_process, and execFileSync's throw-on-nonzero gates each sequential fetch step — the lib spawn wrapper (async, non-throwing) would re-plumb the pipeline's error handling.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export type FleetCommentStyle = 'hash' | 'html' | 'slash'

export interface BundleManifest {
  readonly files: Record<string, string>
  readonly segments?: readonly SegmentEntry[] | undefined
  readonly settingsSegment?: SettingsSegmentEntry | undefined
  readonly templateSha: string
  readonly version: string
  readonly workspaceSegment?: WorkspaceSegmentEntry | undefined
}

export interface InstallOptions {
  readonly bundle?: string | undefined
  readonly dest?: string | undefined
  readonly dryRun?: boolean | undefined
  // `fleet:status --exit-code`: terraform `-detailed-exitcode` style — exit 10
  // (not 0) when an update is available. OUT-OF-SYNC stays exit 1 regardless.
  readonly exitCode?: boolean | undefined
  // Skip the fetch when the pinned ref is already applied (idempotent — the
  // belt/prepare wire passes this so a warm `pnpm install` does no network).
  readonly ifCurrent?: boolean | undefined
  // `fleet:status --json`: emit a stable-keyed JSON object instead of the table.
  readonly json?: boolean | undefined
  readonly manifest?: string | undefined
  // `fleet:status --no-header`: drop the table header row (scripting-friendly).
  readonly noHeader?: boolean | undefined
  // `fleet:status --quiet`: exit-code only, no stdout.
  readonly quiet?: boolean | undefined
  // The release tag to install. Empty → resolved from the member's settings
  // file (`bundle.ref` in .config/socket-wheelhouse.json).
  readonly ref: string
  readonly repo?: string | undefined
  // `fleet:status`: read-only lock-step report (NEVER mutates). The three
  // states + exit codes live in ./lockstep.mts.
  readonly status?: boolean | undefined
  readonly thin?: boolean | undefined
  readonly wire?: boolean | undefined
}

export interface MergeWorkspaceOptions {
  readonly bundleFleetSections: string
  readonly consumerYaml: string
  readonly fleetKeys: readonly string[]
}

export interface ThinOptions {
  readonly dest: string
  readonly manifest: BundleManifest
}

export interface WorkspaceSegmentEntry {
  readonly fleetKeys: readonly string[]
  readonly path: string
  readonly sha256: string
}

export interface SegmentEntry {
  readonly commentStyle: FleetCommentStyle
  readonly path: string
  readonly sha256: string
}

export interface SettingsSegmentEntry {
  readonly path: string
  readonly sha256: string
}

export interface SpliceOptions {
  readonly commentStyle: FleetCommentStyle
  readonly fleetBlock: string
  readonly target: string
}

export interface TarExtractOptions {
  readonly archive: string
  readonly destination: string
  readonly platform: NodeJS.Platform
}

/**
 * Normalize bundle-manifest paths to their portable `/` wire format.
 */
export function normalizeBundlePath(filePath: string): string {
  return filePath.replaceAll('\\', '/')
}

export function tarExecutable(
  platform: NodeJS.Platform,
  systemRoot: string | undefined,
): string {
  return platform === 'win32'
    ? path.join(systemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar'
}

/**
 * Build extraction arguments for the platform-selected tar executable.
 */
export function tarExtractArgs(options: TarExtractOptions): string[] {
  const opts = { __proto__: null, ...options } as TarExtractOptions
  return ['-xzf', opts.archive, '-C', opts.destination]
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message
  }
  return String(e)
}

/**
 * Compute the SHA-256 hex digest of a Buffer — used for both files (byte-
 * identical verification) and fleet-block segments.
 */
export function computeSha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

/**
 * The open marker line for a given comment style — canonical bare-tag form,
 * matching the grammar used by fleet-markers.mts on the producer side. Inlined
 * here so this file stays dep-0 — it cannot import the wheelhouse's
 * fleet-markers module.
 */
export function beginMarker(style: FleetCommentStyle): string {
  if (style === 'html') {
    return '<!-- <fleet-canonical> -->'
  }
  if (style === 'slash') {
    return '// <fleet-canonical>'
  }
  return '# <fleet-canonical>'
}

/**
 * The close marker line for a given comment style — canonical bare-tag form.
 */
export function endMarker(style: FleetCommentStyle): string {
  if (style === 'html') {
    return '<!-- </fleet-canonical> -->'
  }
  if (style === 'slash') {
    return '// </fleet-canonical>'
  }
  return '# </fleet-canonical>'
}

/**
 * Returns the BEGIN/END marker form for a style. spliceFleetBlock matches it
 * alongside the bare-tag form, so a file carrying either form is re-spliced in
 * one pass.
 */
export function legacyBeginMarker(style: FleetCommentStyle): string {
  if (style === 'html') {
    return '<!-- BEGIN <fleet-canonical> -->'
  }
  if (style === 'slash') {
    return '// BEGIN <fleet-canonical>'
  }
  return '# BEGIN <fleet-canonical>'
}

export function legacyEndMarker(style: FleetCommentStyle): string {
  if (style === 'html') {
    return '<!-- END </fleet-canonical> -->'
  }
  if (style === 'slash') {
    return '// END </fleet-canonical>'
  }
  return '# END </fleet-canonical>'
}

/**
 * Splice the canonical fleet block into `target`. If `target` already contains
 * the open/close markers (bare-tag or legacy BEGIN/END form), the content
 * between them (markers inclusive) is replaced. If markers are absent:
 * - `html` style (CLAUDE.md, README): insert before the first level-2 heading
 * (`## `) with i > 0, or append at end.
 * - other styles: append with a leading blank line separator.
 */
export function spliceFleetBlock(options: SpliceOptions): string {
  const opts = { __proto__: null, ...options } as SpliceOptions
  const { commentStyle, fleetBlock, target } = opts
  const begin = beginMarker(commentStyle)
  const end = endMarker(commentStyle)
  const legacy0 = legacyBeginMarker(commentStyle)
  const legacy1 = legacyEndMarker(commentStyle)
  const lines = target.split('\n')
  const startIdx = lines.findIndex(l => l === begin || l === legacy0)
  const endIdx = lines.findIndex(l => l === end || l === legacy1)
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = lines.slice(0, startIdx)
    const after = lines.slice(endIdx + 1)
    return [...before, fleetBlock, ...after].join('\n')
  }
  if (commentStyle === 'html') {
    let insertIdx = lines.length
    for (const [i, line] of lines.entries()) {
      if (i > 0 && line.startsWith('## ')) {
        insertIdx = i
        break
      }
    }
    const before = lines.slice(0, insertIdx)
    const after = lines.slice(insertIdx)
    return [...before, fleetBlock, '', ...after].join('\n')
  }
  const trimmed = target.replace(/\n+$/, '')
  return `${trimmed}\n\n${fleetBlock}\n`
}

// Matches a column-0 top-level YAML key at the start of a line.
const COL0_KEY_RE = /^[A-Za-z][\w-]*:/

/**
 * Parse a YAML string into an ordered list of top-level key blocks. Each block
 * owns all lines from the key line up to (not including) the next column-0 key
 * line or EOF.
 */
export function parseYamlKeyBlocks(
  yaml: string,
): Array<{ key: string; lines: string[] }> {
  const lines = yaml.split('\n')
  const blocks: Array<{ key: string; lines: string[] }> = []
  let current: { key: string; lines: string[] } | undefined
  for (const line of lines) {
    if (COL0_KEY_RE.test(line)) {
      if (current !== undefined) {
        blocks.push(current)
      }
      const colonIdx = line.indexOf(':')
      current = { key: line.slice(0, colonIdx), lines: [line] }
    } else if (current !== undefined) {
      current.lines.push(line)
    }
  }
  if (current !== undefined) {
    blocks.push(current)
  }
  return blocks
}

/**
 * Merge the fleet-managed workspace sections from `bundleFleetSections` into
 * `consumerYaml`, replacing only the keys listed in `fleetKeys`. Non-fleet keys
 * (including `packages:`) are preserved byte-exact. Throws on ambiguous input.
 */
export function mergeWorkspaceYaml(options: MergeWorkspaceOptions): string {
  const opts = { __proto__: null, ...options } as MergeWorkspaceOptions
  const { bundleFleetSections, consumerYaml, fleetKeys } = opts

  const consumerBlocks = parseYamlKeyBlocks(consumerYaml)
  const bundleBlocks = parseYamlKeyBlocks(bundleFleetSections)

  // Fail-closed: check for duplicate fleet keys in consumer.
  const fleetKeySet = new Set(fleetKeys)
  const consumerKeyCounts = new Map<string, number>()
  for (const block of consumerBlocks) {
    if (fleetKeySet.has(block.key)) {
      consumerKeyCounts.set(
        block.key,
        (consumerKeyCounts.get(block.key) ?? 0) + 1,
      )
    }
  }
  for (const [key, count] of consumerKeyCounts) {
    if (count > 1) {
      throw new Error(
        `mergeWorkspaceYaml: fleet key "${key}" appears ${count} times at column 0 in consumerYaml — cannot merge safely`,
      )
    }
  }

  // Build a map of bundle blocks keyed by name.
  const bundleMap = new Map<string, { key: string; lines: string[] }>()
  for (const block of bundleBlocks) {
    bundleMap.set(block.key, block)
  }

  // Build result: iterate consumer blocks, replacing fleet-managed ones.
  const resultBlocks: Array<{ key: string; lines: string[] }> = []
  const handledFleetKeys = new Set<string>()
  for (const block of consumerBlocks) {
    if (fleetKeySet.has(block.key)) {
      const bundleBlock = bundleMap.get(block.key)
      if (bundleBlock !== undefined) {
        resultBlocks.push(bundleBlock)
      } else {
        resultBlocks.push(block)
      }
      handledFleetKeys.add(block.key)
    } else {
      resultBlocks.push(block)
    }
  }

  // Append any fleet keys from the bundle that don't exist in the consumer.
  for (const key of fleetKeys) {
    if (!handledFleetKeys.has(key)) {
      const bundleBlock = bundleMap.get(key)
      if (bundleBlock !== undefined) {
        resultBlocks.push(bundleBlock)
      }
    }
  }

  // Reconstruct YAML from blocks. Each block's lines already contain any
  // trailing blank lines that were part of the original block.
  const output = resultBlocks.map(b => b.lines.join('\n')).join('\n')
  // Normalise to a single trailing newline.
  return `${output.replace(/\n+$/, '')}\n`
}

export function run(cmd: string, args: readonly string[]): void {
  execFileSync(cmd, args as string[], { stdio: 'inherit' })
}

export function segmentFileName(relativePath: string): string {
  return `${relativePath.replace(/^\./, 'dot-')}.fleetblock`
}

export function readManifest(manifestPath: string): BundleManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as BundleManifest
}

export function walkFiles(dir: string, base: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs, base))
    } else if (entry.isFile()) {
      out.push(path.relative(base, abs))
    }
  }
  return out
}

/**
 * Verify every file in `manifest.files` against its expected SHA-256 digest.
 * Returns a list of problem descriptions — empty means all verified. A single
 * mismatch must abort the whole install (fail closed).
 */
export function verifyBundleFiles(
  filesDir: string,
  manifest: BundleManifest,
): string[] {
  const problems: string[] = []
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const abs = path.join(filesDir, rel)
    if (!existsSync(abs)) {
      problems.push(`missing from bundle: ${rel}`)
      continue
    }
    const actual = computeSha256(readFileSync(abs))
    if (actual !== expected) {
      problems.push(`sha256 mismatch: ${rel} (got ${actual}, want ${expected})`)
    }
  }
  return problems
}

/**
 * Verify every generic block segment and the specialized Claude settings
 * segment against its expected SHA-256. A mismatch is just as fatal as a file
 * mismatch — the merge result would silently differ from producer intent.
 */
export function verifySegments(
  segmentsDir: string,
  manifest: BundleManifest,
): string[] {
  const segments = manifest.segments
  const problems: string[] = []
  for (const entry of segments ?? []) {
    const destName = segmentFileName(entry.path)
    const abs = path.join(segmentsDir, destName)
    if (!existsSync(abs)) {
      problems.push(`missing segment: ${entry.path}`)
      continue
    }
    const actual = computeSha256(readFileSync(abs))
    if (actual !== entry.sha256) {
      problems.push(
        `sha256 mismatch for segment ${entry.path} (got ${actual}, want ${entry.sha256})`,
      )
    }
  }
  const settingsSegment = manifest.settingsSegment
  if (settingsSegment !== undefined) {
    const abs = path.join(segmentsDir, segmentFileName(settingsSegment.path))
    if (!existsSync(abs)) {
      problems.push(`missing settings segment: ${settingsSegment.path}`)
    } else {
      const actual = computeSha256(readFileSync(abs))
      if (actual !== settingsSegment.sha256) {
        problems.push(
          `sha256 mismatch for settings segment ${settingsSegment.path} (got ${actual}, want ${settingsSegment.sha256})`,
        )
      }
    }
  }
  return problems
}
