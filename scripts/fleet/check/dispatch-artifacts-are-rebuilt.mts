#!/usr/bin/env node
/*
 * @file Fleet check — every BUILT dispatch artifact carries the routing of the
 *   CURRENT dispatch table.
 *
 *   Fleet hooks reach a running agent through a three-step chain, each step
 *   consuming the previous step's output:
 *
 *     gen/hook-dispatch.mts   -> _shared/dispatch-table*.mts   (routing)
 *     build-hook-bundle.mts   -> _dist/fleet-pack.cjs                (table INLINED)
 *     build-hook-snapshot.mts -> _shared/{snapshot,excluded}-fleet-pack.cjs + blob
 *     build-snapshot-launcher -> _shared/snapshot-blob.path, blob pin
 *
 *   `dispatch-table-is-current` asserts step 1's output matches the hook dirs.
 *   This gate asserts steps 2-4 were rebuilt AFTER it: the launcher prefers the
 *   pinned blob over everything else, so a stale snapshot BEATS a freshly built
 *   bundle and the session runs old routing while source and the table check
 *   both read green.
 *
 *   DETECTION IS CONTENT-DERIVED, never mtime (a checkout, a cascade copy, and
 *   `fs.cp` all rewrite timestamps in arbitrary order, so a fresh file can look
 *   older than its input). Rolldown emits the bundles UNMINIFIED with
 *   `//#region <module>` markers, so the inlined table is readable: this gate
 *   parses the routing out of each artifact and compares it to a FRESH REGEN
 *   over the current hook dirs — not to the on-disk table, which is itself
 *   rebuilt by the same commands and would agree with a stale sibling. The blob
 *   leg reuses the existing content keying: `build-hook-snapshot.mts` names the
 *   blob `dispatch-<sha256-16 of snapshot-fleet-pack.cjs>.blob`, so re-deriving that
 *   hash says whether `snapshot-blob.path` pins a blob built from the CURRENT
 *   snapshot bundle.
 *
 *   Every artifact here is gitignored generated output. ABSENT is a clean no-op
 *   (a fresh clone, CI, or a member that never ran setup dispatches through the
 *   portable baseline); only a PRESENT-but-stale artifact fails.
 *
 *   Usage: node scripts/fleet/check/dispatch-artifacts-are-rebuilt.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { computeSourceHash } from '../build-hook-snapshot.mts'
import {
  FLEET_HOOKS_DIR,
  generateDispatchTableSource,
} from '../gen/hook-dispatch.mts'
import type { TableVariant } from '../gen/hook-dispatch.mts'
import {
  DISPATCH_DIR,
  EXCLUDED_BUNDLE_PATH,
  HOOK_BUNDLE_PATH,
  REPO_ROOT,
} from '../paths.mts'
import { hasFleetHookSource } from '../_shared/fleet-source-present.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const SNAPSHOT_BUNDLE_PATH = path.join(DISPATCH_DIR, 'snapshot-fleet-pack.cjs')
const SNAPSHOT_BLOB_PIN_PATH = path.join(DISPATCH_DIR, 'snapshot-blob.path')

// The exact rebuild sequence, in order. Each step consumes the previous one's
// output, so a partial run leaves a later artifact serving older routing.
const REBUILD_SEQUENCE = [
  'node scripts/fleet/build-hook-bundle.mts',
  'node scripts/fleet/build-hook-snapshot.mts',
  'node scripts/fleet/build-snapshot-launcher.mts',
]

// One scan token matches EITHER a routing entry (`name: 'x', check: …, tools: …`)
// or an event key opening its array (`'PreToolUse': [`). The entry alternative
// comes first so an entry's own `tools: [` is consumed as part of the entry and
// never mistaken for an event key. `[^{}]` between name and tools keeps the
// match inside one entry object.
const ROUTING_TOKEN_RE =
  /name\s*:\s*["']([^"']+)["'][^{}]{0,200}?tools\s*:\s*(\[[^\]]*\]|undefined|void 0|null)|["']?([A-Za-z][A-Za-z0-9]*)["']?\s*:\s*\[/g

// Canonical `tools` value for an entry that declares no tool filter — the hook
// runs for every tool on its event.
const ALL_TOOLS = '*'

export interface DispatchRoutingEntry {
  readonly event: string
  readonly name: string
  readonly tools: string
}

export interface DispatchRoutingDiff {
  readonly changed: string[]
  readonly extra: string[]
  readonly missing: string[]
}

export type DispatchArtifactStatus = 'current' | 'no-table' | 'stale'

export interface DispatchArtifactVerdict {
  readonly diff: DispatchRoutingDiff
  readonly status: DispatchArtifactStatus
}

export type SnapshotBlobPinStatus = 'absent' | 'current' | 'stale'

export interface DispatchArtifactSpec {
  readonly artifactPath: string
  readonly moduleSuffix: string
  readonly variant: TableVariant
}

export interface DispatchScanResult {
  readonly failures: string[]
  readonly present: number
}

/**
 * The three built artifacts that inline a dispatch table, each paired with the
 * table variant it was built from and the `//#region` module marker rolldown
 * writes for that variant.
 */
export const DISPATCH_ARTIFACT_SPECS: readonly DispatchArtifactSpec[] = [
  {
    artifactPath: HOOK_BUNDLE_PATH,
    moduleSuffix: '_shared/dispatch-table.mts',
    variant: 'full',
  },
  {
    artifactPath: SNAPSHOT_BUNDLE_PATH,
    moduleSuffix: '_shared/dispatch-table-snapshot.mts',
    variant: 'snapshot',
  },
  {
    artifactPath: EXCLUDED_BUNDLE_PATH,
    moduleSuffix: '_shared/dispatch-table-excluded.mts',
    variant: 'excluded',
  },
]

/**
 * The body of one rolldown `//#region <module>` block, selected by a module
 * path suffix. Undefined when the bundle inlines no such module.
 */
export function sliceBundleModuleRegion(
  bundleText: string,
  moduleSuffix: string,
): string | undefined {
  const marker = '//#region '
  let from = 0
  for (;;) {
    const at = bundleText.indexOf(marker, from)
    if (at === -1) {
      return undefined
    }
    const eol = bundleText.indexOf('\n', at)
    if (eol === -1) {
      return undefined
    }
    const declared = normalizePath(bundleText.slice(at + marker.length, eol))
    if (declared.trim().endsWith(moduleSuffix)) {
      const end = bundleText.indexOf('\n//#endregion', eol)
      return bundleText.slice(eol + 1, end === -1 ? undefined : end)
    }
    from = eol + 1
  }
}

/**
 * The `DISPATCH_TABLE` object literal inside a table source or an inlined
 * bundle region, brace-matched so string contents can never end it early.
 */
export function extractDispatchTableLiteral(text: string): string | undefined {
  const at = text.indexOf('DISPATCH_TABLE')
  if (at === -1) {
    return undefined
  }
  const open = text.indexOf('{', at)
  if (open === -1) {
    return undefined
  }
  let depth = 0
  let quote = ''
  for (let i = open, { length } = text; i < length; i += 1) {
    const ch = text[i]!
    if (quote) {
      if (ch === '\\') {
        i += 1
      } else if (ch === quote) {
        quote = ''
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
    } else if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        return text.slice(open, i + 1)
      }
    }
  }
  return undefined
}

/**
 * Normalize a parsed `tools` literal to one comparable string. Rolldown writes
 * `void 0` where the table source writes `undefined`; both mean "every tool".
 */
function canonicalToolList(literal: string): string {
  if (!literal.startsWith('[')) {
    return ALL_TOOLS
  }
  return (
    literal
      .slice(1, -1)
      .split(',')
      // Strip one leading OR one trailing quote character: `^["']` matches a
      // single or double quote at the start, `["']$` the same at the end.
      .map(tool => tool.trim().replace(/^["']|["']$/g, ''))
      .filter(tool => tool.length > 0)
      .join(',')
  )
}

/**
 * The routing a dispatch table declares — one entry per, event, hook, tools.
 * Undefined when the text carries no `DISPATCH_TABLE` literal at all, which is
 * a different failure from an empty table.
 */
export function parseDispatchRouting(
  text: string,
): DispatchRoutingEntry[] | undefined {
  const literal = extractDispatchTableLiteral(text)
  if (literal === undefined) {
    return undefined
  }
  const entries: DispatchRoutingEntry[] = []
  let event = ''
  ROUTING_TOKEN_RE.lastIndex = 0
  let match = ROUTING_TOKEN_RE.exec(literal)
  while (match !== null) {
    if (match[3] === undefined) {
      entries.push({
        event,
        name: match[1]!,
        tools: canonicalToolList(match[2]!),
      })
    } else {
      event = match[3]
    }
    match = ROUTING_TOKEN_RE.exec(literal)
  }
  return entries
}

/**
 * Routing the artifact lacks (`missing`), routing it carries that the table no
 * longer declares (`extra`), and hooks whose tool filter drifted (`changed`).
 */
export function diffDispatchRouting(
  expected: readonly DispatchRoutingEntry[],
  actual: readonly DispatchRoutingEntry[],
): DispatchRoutingDiff {
  const expectedByKey = new Map(expected.map(e => [`${e.event}/${e.name}`, e]))
  const actualByKey = new Map(actual.map(e => [`${e.event}/${e.name}`, e]))
  const changed: string[] = []
  const extra: string[] = []
  const missing: string[] = []
  for (const [key, entry] of expectedByKey) {
    const found = actualByKey.get(key)
    if (!found) {
      missing.push(key)
    } else if (found.tools !== entry.tools) {
      changed.push(`${key} (tools ${found.tools} != ${entry.tools})`)
    }
  }
  for (const key of actualByKey.keys()) {
    if (!expectedByKey.has(key)) {
      extra.push(key)
    }
  }
  return { changed, extra, missing }
}

/**
 * Whether one built artifact's inlined routing matches the table it should have
 * been built from.
 */
export function compareDispatchArtifactRouting(config: {
  artifactText: string
  moduleSuffix: string
  tableSource: string
}): DispatchArtifactVerdict {
  const cfg = { __proto__: null, ...config } as typeof config
  const empty: DispatchRoutingDiff = { changed: [], extra: [], missing: [] }
  const region = sliceBundleModuleRegion(cfg.artifactText, cfg.moduleSuffix)
  if (region === undefined) {
    return { diff: empty, status: 'no-table' }
  }
  const actual = parseDispatchRouting(region)
  if (actual === undefined) {
    return { diff: empty, status: 'no-table' }
  }
  const expected = parseDispatchRouting(cfg.tableSource) ?? []
  const diff = diffDispatchRouting(expected, actual)
  const drifted =
    diff.changed.length > 0 || diff.extra.length > 0 || diff.missing.length > 0
  return { diff, status: drifted ? 'stale' : 'current' }
}

/**
 * Whether `snapshot-blob.path` pins a blob built from the CURRENT snapshot
 * bundle. A pin naming an older blob that still exists is the dangerous state —
 * the launcher execs it and the session runs that blob's routing. A pin whose
 * blob is gone, the cache was reaped, is safe: the launcher fails open to
 * `index.cjs`, so it reports absent rather than stale.
 */
export function classifySnapshotBlobPin(config: {
  blobExists: boolean
  expectedHash: string
  pinnedBlobPath: string
}): SnapshotBlobPinStatus {
  const cfg = { __proto__: null, ...config } as typeof config
  if (!cfg.blobExists) {
    return 'absent'
  }
  const pinned = path.basename(normalizePath(cfg.pinnedBlobPath.trim()))
  return pinned === `dispatch-${cfg.expectedHash}.blob` ? 'current' : 'stale'
}

function describeDiff(diff: DispatchRoutingDiff): string[] {
  const lines: string[] = []
  if (diff.missing.length) {
    lines.push(`         missing routing : ${diff.missing.join(', ')}`)
  }
  if (diff.extra.length) {
    lines.push(`         stale routing   : ${diff.extra.join(', ')}`)
  }
  if (diff.changed.length) {
    lines.push(`         changed routing : ${diff.changed.join(', ')}`)
  }
  return lines
}

function reportStale(failures: readonly string[]): void {
  logger.fail(
    '[dispatch-artifacts-are-rebuilt] a built dispatch artifact serves STALE routing.',
  )
  logger.error(failures.join('\n'))
  logger.error(
    `  Fix:   rebuild the chain, in order:\n` +
      REBUILD_SEQUENCE.map(cmd => `           ${cmd}`).join('\n') +
      `\n         Until that runs, hooks execute STALE routing while the source tree,\n` +
      `         dispatch-table-is-current, and the artifact you just rebuilt all look correct —\n` +
      `         the launcher prefers the pinned snapshot blob over every other path.`,
  )
}

/**
 * Read every present artifact and report the ones serving stale routing.
 * `tableSourceFor` is injected so a test can drive the whole scan over a
 * scratch tree without a real hook tree to regenerate from; `main()` passes
 * the live generator. Absent artifacts are skipped, never failed.
 */
export function scanDispatchArtifacts(config: {
  artifacts: readonly DispatchArtifactSpec[]
  repoRoot: string
  snapshotBlobPinPath: string
  snapshotBundlePath: string
  tableSourceFor: (variant: TableVariant) => string
}): DispatchScanResult {
  const cfg = { __proto__: null, ...config } as typeof config
  const failures: string[] = []
  let present = 0
  for (let i = 0, { length } = cfg.artifacts; i < length; i += 1) {
    const spec = cfg.artifacts[i]!
    // Gitignored generated output: absent means this tree never built it.
    if (!existsSync(spec.artifactPath)) {
      continue
    }
    present += 1
    const where = normalizePath(path.relative(cfg.repoRoot, spec.artifactPath))
    const verdict = compareDispatchArtifactRouting({
      artifactText: readFileSync(spec.artifactPath, 'utf8'),
      moduleSuffix: spec.moduleSuffix,
      tableSource: cfg.tableSourceFor(spec.variant),
    })
    if (verdict.status === 'no-table') {
      failures.push(
        `  Where: ${where}\n` +
          `  Saw:   no inlined ${spec.moduleSuffix} dispatch table in the artifact\n` +
          `         (wanted: the routing of a fresh regen over .claude/hooks/fleet/)`,
      )
      continue
    }
    if (verdict.status === 'stale') {
      failures.push(
        [
          `  Where: ${where}`,
          `  Saw:   routing that differs from a fresh regen over .claude/hooks/fleet/`,
          ...describeDiff(verdict.diff),
          `         (wanted: byte-for-byte the same set of event/hook/tools routes)`,
        ].join('\n'),
      )
    }
  }

  // Snapshot bundle -> blob -> sidecar. Only meaningful once both the snapshot
  // bundle and the launcher's pin exist; either absent means this host never
  // opted into the snapshot fast path.
  if (
    existsSync(cfg.snapshotBundlePath) &&
    existsSync(cfg.snapshotBlobPinPath)
  ) {
    const pinnedBlobPath = readFileSync(cfg.snapshotBlobPinPath, 'utf8').trim()
    const expectedHash = computeSourceHash(readFileSync(cfg.snapshotBundlePath))
    const pinStatus = classifySnapshotBlobPin({
      blobExists: pinnedBlobPath.length > 0 && existsSync(pinnedBlobPath),
      expectedHash,
      pinnedBlobPath,
    })
    if (pinStatus === 'stale') {
      present += 1
      failures.push(
        `  Where: ${normalizePath(path.relative(cfg.repoRoot, cfg.snapshotBlobPinPath))}\n` +
          `  Saw:   pins ${path.basename(normalizePath(pinnedBlobPath))}, an EXISTING blob built from a different snapshot bundle\n` +
          `         (wanted: dispatch-${expectedHash}.blob, the content key of the current snapshot-fleet-pack.cjs)`,
      )
    }
  }
  return { failures, present }
}

export function main(): number {
  const quiet = process.argv.includes('--quiet')
  // A bundle-only member has no per-hook SOURCE dirs, so a fresh regen would
  // render an EMPTY table and call the release-shipped bundle stale. The
  // artifacts are built and validated at the source repo.
  if (!hasFleetHookSource(REPO_ROOT)) {
    if (!quiet) {
      logger.log(
        '[dispatch-artifacts-are-rebuilt] no fleet hook source (bundle-only) — artifacts validated at the source repo.',
      )
    }
    return 0
  }

  const { failures, present } = scanDispatchArtifacts({
    artifacts: DISPATCH_ARTIFACT_SPECS,
    repoRoot: REPO_ROOT,
    snapshotBlobPinPath: SNAPSHOT_BLOB_PIN_PATH,
    snapshotBundlePath: SNAPSHOT_BUNDLE_PATH,
    tableSourceFor: variant =>
      generateDispatchTableSource(FLEET_HOOKS_DIR, variant),
  })

  if (failures.length) {
    reportStale(failures)
    return 1
  }
  if (!quiet) {
    if (present === 0) {
      logger.log(
        '[dispatch-artifacts-are-rebuilt] no built dispatch artifacts here — nothing to verify.',
      )
    } else {
      logger.success(
        `[dispatch-artifacts-are-rebuilt] ${present} built dispatch artifact(s) carry the current routing.`,
      )
    }
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every built dispatch artifact carries the current dispatch-table routing',
  help: `Usage: node scripts/fleet/check/dispatch-artifacts-are-rebuilt.mts [flags]

  --quiet  suppress the pass message`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
