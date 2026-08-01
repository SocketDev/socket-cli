/*
 * @file Deterministic dependency-diff narrower — the load-bearing pre-step for
 *   the keyless weekly-update supply-chain classifier. The odai `classify-deps`
 *   task only fits a small on-device model window when it is fed narrowed
 *   manifest facts, not a raw 10K-token lockfile diff. This module parses a
 *   working-tree dependency diff — git diff of package.json, member
 *   package.json files, pnpm-lock.yaml, and the pnpm-workspace.yaml catalog —
 *   into a structured model, then reduces it to a bounded JSON summary with a
 *   HARD size cap so the result always fits that window.
 *
 *   Split into two layers:
 *   1. PURE FUNCTIONS — parseDependencyDiff + narrowDependencyDiff and their
 *      helpers. No I/O, no clock, no git; unit-tested against fixtures.
 *   2. THIN CLI — reads a diff from stdin or builds one from --from/--to refs,
 *      narrows it, and prints one JSON line on stdout. Both a wheelhouse
 *      weekly-update step and odai call it the same way.
 *
 *   The narrowed shape is a strict superset of what odai `classify-deps`
 *   few-shots on: top-level addedDeps, newTransitiveCount, droppedLockfileBody,
 *   plus per-dependency kind/isNew/removed and a counts block. The classifier
 *   reads only the facts it needs; the extra fields serve humans and other
 *   consumers.
 *
 *   Registry-metadata enrichment such as new-maintainer detection needs network
 *   and is a documented non-goal here: the core narrower stays offline and
 *   deterministic so it can run in a keyless CI leg.
 *
 *   Usage:
 *     node scripts/fleet/weekly-update/diff-narrow.mts < some.diff
 *     node scripts/fleet/weekly-update/diff-narrow.mts --from HEAD~1 --to HEAD
 *     node scripts/fleet/weekly-update/diff-narrow.mts --from <sha>^ --to <sha> --pretty
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

/**
 * Where a changed dependency was declared. The first five mirror the pnpm /
 * npm manifest sections plus the pnpm-workspace catalog; `override` is the
 * pnpm-workspace overrides block — a forced transitive pin, a real
 * supply-chain lever the classifier should still see.
 */
export type DependencyKind =
  | 'dep'
  | 'devDep'
  | 'peer'
  | 'optional'
  | 'catalog'
  | 'override'

export interface DependencyChange {
  name: string
  from: string | null
  to: string | null
  kind: DependencyKind
  major: boolean
  isNew: boolean
  removed: boolean
  newInstallScripts: boolean
}

export interface TransitiveChange {
  name: string
  version: string
  newInstallScripts: boolean
}

export interface DependencyDiffModel {
  deps: DependencyChange[]
  transitives: TransitiveChange[]
}

export interface NarrowCounts {
  changed: number
  added: number
  removed: number
  major: number
  withInstallScripts: number
  newTransitives: number
}

export interface NarrowedSummary {
  addedDeps: DependencyChange[]
  newTransitives: TransitiveChange[]
  newTransitiveCount: number
  counts: NarrowCounts
  droppedLockfileBody: true
  truncated: boolean
}

export interface NarrowOptions {
  maxDeps?: number | undefined
  maxTransitives?: number | undefined
  maxChars?: number | undefined
}

// Default caps. The char budget keeps the compact JSON comfortably inside a
// small on-device model window; the count caps bound the arrays before the
// char pass even runs.
export const DEFAULT_MAX_DEPS = 40
export const DEFAULT_MAX_TRANSITIVES = 25
export const DEFAULT_MAX_CHARS = 4000

const MANIFEST_SECTIONS: Record<string, DependencyKind> = {
  __proto__: null,
  dependencies: 'dep',
  devDependencies: 'devDep',
  optionalDependencies: 'optional',
  peerDependencies: 'peer',
} as unknown as Record<string, DependencyKind>

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

/**
 * Split a lockfile package key into name and base version, dropping any
 * peer-context suffix. `@babel/parser@7.29.3` becomes name `@babel/parser`,
 * version `7.29.3`; `vite@8.1.5(@types/node@26.1.1)` drops the suffix. Returns
 * undefined for a key with no version segment.
 */
export function splitPackageNameVersion(
  nameVer: string,
): { name: string; version: string } | undefined {
  const clean = nameVer.replace(/^['"]|['"]$/g, '').trim()
  const base = clean.split('(')[0] ?? clean
  const at = base.lastIndexOf('@')
  if (at <= 0) {
    return undefined
  }
  const name = base.slice(0, at)
  const version = base.slice(at + 1)
  if (!name || !version) {
    return undefined
  }
  return { name, version }
}

/**
 * Drop a version-range selector suffix from an overrides key so it reads as a
 * bare package name: `lru-cache@>=10` becomes `lru-cache`, `semver@>=5.0.0`
 * becomes `semver`, while a scoped `@babel/core@>=7` keeps its scope.
 */
export function bareDependencyName(key: string): string {
  const at = key.indexOf('@', 1)
  return at === -1 ? key : key.slice(0, at)
}

/**
 * The semver-major number of a version spec, or undefined when the spec has no
 * comparable numeric version: a `catalog:` / `workspace:` / `npm:` alias, a git
 * or file protocol, or a wildcard. Range operators are stripped first.
 */
export function parseSpecMajor(spec: string): number | undefined {
  const trimmed = spec.trim()
  // A spec with no comparable numeric major: catalog / workspace / npm alias, a
  // git or file protocol, an http url, or a bare wildcard.
  const nonNumeric =
    /^(?:catalog:|workspace:|npm:|link:|file:|git|https?:|\*|x$)/i.test(trimmed)
  if (!trimmed || nonNumeric) {
    return undefined
  }
  // Strip a leading range operator so `^16.27.0` and `>=10` reduce to a number.
  const stripped = trimmed.replace(/^[~^>=<\s]+/, '')
  const match = /^(\d+)/.exec(stripped)
  if (!match) {
    return undefined
  }
  return Number(match[1])
}

/**
 * Whether the change from `from` to `to` crosses a semver major boundary. Both
 * specs must carry a comparable numeric major; an alias or protocol swap is not
 * treated as a major bump.
 */
export function isMajorBump(from: string | null, to: string | null): boolean {
  if (from === null || to === null) {
    return false
  }
  const fromMajor = parseSpecMajor(from)
  const toMajor = parseSpecMajor(to)
  if (fromMajor === undefined || toMajor === undefined) {
    return false
  }
  return fromMajor !== toMajor
}

// The signal weight of a dependency change — used to keep the highest-signal
// entries when the size cap forces truncation. A major bump outranks a new
// install script, which outranks a brand-new dep, which outranks a removal.
function dependencySignalScore(dep: DependencyChange): number {
  return (
    (dep.major ? 8 : 0) +
    (dep.newInstallScripts ? 4 : 0) +
    (dep.isNew ? 2 : 0) +
    (dep.removed ? 1 : 0)
  )
}

// ---------------------------------------------------------------------------
// Diff parsing.
// ---------------------------------------------------------------------------

type DiffFileKind = 'manifest' | 'workspace' | 'lockfile' | 'other'

function classifyDiffFile(pathText: string): DiffFileKind {
  if (pathText === 'pnpm-lock.yaml') {
    return 'lockfile'
  }
  if (pathText === 'pnpm-workspace.yaml') {
    return 'workspace'
  }
  if (pathText === 'package.json' || pathText.endsWith('/package.json')) {
    return 'manifest'
  }
  return 'other'
}

interface DepRecord {
  name: string
  kind: DependencyKind
  spec: string
}

type WorkspaceBlock = 'catalog' | 'catalogs' | 'overrides' | 'other'

function workspaceBlockFor(topKey: string): WorkspaceBlock {
  if (topKey === 'catalog' || topKey === 'catalogs' || topKey === 'overrides') {
    return topKey
  }
  return 'other'
}

// A package.json dependency entry `  "name": "spec"` — group 1 name, group 2 spec.
const MANIFEST_ENTRY_RE = /^\s*"(@?[^"]+)"\s*:\s*"([^"]*)"/
// A package.json dependency-section header; alternation sorted alphabetically.
const MANIFEST_SECTION_RE =
  /^\s*"(dependencies|devDependencies|optionalDependencies|peerDependencies)"\s*:/
const CLOSING_BRACE_RE = /^\s*\}/
// A pnpm-workspace top-level key: the catalog / catalogs / overrides blocks, or
// any other key that ends the block.
const WORKSPACE_TOP_KEY_RE = /^(catalog|catalogs|overrides|[A-Za-z]+)\s*:/
// A catalog or overrides entry `  name: spec`, optionally quoted, spec required.
const WORKSPACE_ENTRY_RE = /^\s+(['"]?)(@?[^'":\s]+)\1\s*:\s*(\S.*?)\s*$/
// A resolved lockfile package key: two-space-indented `name@version:`, no value.
const LOCK_ENTRY_RE = /^ {2}(['"]?)(@?[^'"].*?)\1:\s*$/
const REQUIRES_BUILD_RE = /^\s+requiresBuild:\s*true\b/

/**
 * Parse a concatenated dependency diff into a structured model. The parser
 * tolerates missing section context — the CLI feeds it full-context manifest
 * diffs so kinds resolve exactly, and a hand-piped diff degrades gracefully.
 * Pure over the diff text.
 */
export function parseDependencyDiff(diffText: string): DependencyDiffModel {
  const lines = diffText.split('\n')

  let fileKind: DiffFileKind = 'other'
  let manifestSection: DependencyKind | undefined
  let workspaceBlock: WorkspaceBlock = 'other'
  let currentLockName: string | undefined

  const additions = new Map<string, DepRecord>()
  const removals = new Map<string, DepRecord>()
  const lockAddedNames = new Set<string>()
  const lockRemovedNames = new Set<string>()
  const lockAddedEntries: Array<{ name: string; version: string }> = []
  const installScriptNames = new Set<string>()

  const key = (rec: DepRecord): string => `${rec.kind}::${rec.name}`

  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.startsWith('diff --git ')) {
      fileKind = 'other'
      manifestSection = undefined
      workspaceBlock = 'other'
      currentLockName = undefined
      continue
    }
    if (line.startsWith('+++ b/')) {
      fileKind = classifyDiffFile(line.slice('+++ b/'.length).trim())
      continue
    }
    if (line.startsWith('@@')) {
      // A hunk header carries the nearest preceding column-zero heading as its
      // trailer: `@@ … @@ overrides:`. With minimal context that trailer is the
      // only place a workspace block name appears, so drive block state off it.
      const trailer = line.slice(line.lastIndexOf('@@') + 2).trimStart()
      if (fileKind === 'workspace') {
        const top = WORKSPACE_TOP_KEY_RE.exec(trailer)
        if (top) {
          workspaceBlock = workspaceBlockFor(top[1]!)
        }
      }
      continue
    }
    if (
      line.startsWith('--- ') ||
      line.startsWith('index ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('rename ') ||
      line.startsWith('similarity ')
    ) {
      continue
    }

    const marker = line[0] ?? ' '
    const content = line.slice(1)

    if (fileKind === 'manifest') {
      const section = MANIFEST_SECTION_RE.exec(content)
      if (section) {
        manifestSection = MANIFEST_SECTIONS[section[1]!]
        continue
      }
      if (CLOSING_BRACE_RE.test(content)) {
        manifestSection = undefined
        continue
      }
      if (manifestSection && (marker === '-' || marker === '+')) {
        const entry = MANIFEST_ENTRY_RE.exec(content)
        if (entry) {
          const rec: DepRecord = {
            kind: manifestSection,
            name: entry[1]!,
            spec: entry[2]!,
          }
          ;(marker === '+' ? additions : removals).set(key(rec), rec)
        }
      }
      continue
    }

    if (fileKind === 'workspace') {
      const top = WORKSPACE_TOP_KEY_RE.exec(content)
      if (top && !/^\s/.test(content)) {
        workspaceBlock = workspaceBlockFor(top[1]!)
        continue
      }
      if (
        (workspaceBlock === 'catalog' ||
          workspaceBlock === 'catalogs' ||
          workspaceBlock === 'overrides') &&
        (marker === '-' || marker === '+')
      ) {
        const entry = WORKSPACE_ENTRY_RE.exec(content)
        if (entry?.[3]) {
          const rec: DepRecord = {
            kind: workspaceBlock === 'overrides' ? 'override' : 'catalog',
            name: bareDependencyName(entry[2]!),
            // Strip surrounding single or double quotes from a YAML value.
            spec: entry[3].replace(/^['"]|['"]$/g, ''),
          }
          ;(marker === '+' ? additions : removals).set(key(rec), rec)
        }
      }
      continue
    }

    if (fileKind === 'lockfile') {
      // A resolved package entry is detected by SHAPE — a two-space-indented
      // `name@version:` key — not by tracking the enclosing `packages:` block.
      // With the minimal lockfile context the block header lives only in the
      // hunk `@@ … @@ packages:` trailer, which the parser skips; entries under
      // `patchedDependencies` / `overrides` carry a value after the colon and so
      // never match this key shape.
      const entry = LOCK_ENTRY_RE.exec(content)
      if (entry) {
        const split = splitPackageNameVersion(entry[2]!)
        if (split) {
          currentLockName = split.name
          if (marker === '+') {
            lockAddedNames.add(split.name)
            lockAddedEntries.push(split)
          } else if (marker === '-') {
            lockRemovedNames.add(split.name)
          }
        }
        continue
      }
      if (currentLockName && REQUIRES_BUILD_RE.test(content)) {
        installScriptNames.add(currentLockName)
      }
    }
  }

  const deps = buildDependencyChanges(additions, removals, installScriptNames)
  const manifestNames = new Set(deps.map(d => d.name))
  const transitives = buildTransitiveChanges(
    lockAddedEntries,
    lockAddedNames,
    lockRemovedNames,
    manifestNames,
    installScriptNames,
  )
  return { deps, transitives }
}

function buildDependencyChanges(
  additions: Map<string, DepRecord>,
  removals: Map<string, DepRecord>,
  installScriptNames: Set<string>,
): DependencyChange[] {
  const keys = new Set<string>([...additions.keys(), ...removals.keys()])
  const deps: DependencyChange[] = []
  for (const k of keys) {
    const added = additions.get(k)
    const removed = removals.get(k)
    const rec = added ?? removed!
    // null is the classify-deps JSON contract: a new dep serializes `"from":null`
    // and a removed dep `"to":null`; undefined would drop the key entirely.
    // oxlint-disable-next-line socket/prefer-undefined-over-null -- JSON output contract for classify-deps.
    const from = removed ? removed.spec : null
    // oxlint-disable-next-line socket/prefer-undefined-over-null -- JSON output contract for classify-deps.
    const to = added ? added.spec : null
    deps.push({
      name: rec.name,
      from,
      to,
      kind: rec.kind,
      major: isMajorBump(from, to),
      isNew: !removed && !!added,
      removed: !added && !!removed,
      newInstallScripts: installScriptNames.has(rec.name),
    })
  }
  return deps.toSorted((a, b) => a.name.localeCompare(b.name))
}

function buildTransitiveChanges(
  lockAddedEntries: Array<{ name: string; version: string }>,
  lockAddedNames: Set<string>,
  lockRemovedNames: Set<string>,
  manifestNames: Set<string>,
  installScriptNames: Set<string>,
): TransitiveChange[] {
  const seen = new Set<string>()
  const transitives: TransitiveChange[] = []
  for (let i = 0, { length } = lockAddedEntries; i < length; i += 1) {
    const { name, version } = lockAddedEntries[i]!
    if (
      seen.has(name) ||
      lockRemovedNames.has(name) ||
      manifestNames.has(name) ||
      !lockAddedNames.has(name)
    ) {
      continue
    }
    seen.add(name)
    transitives.push({
      name,
      version,
      newInstallScripts: installScriptNames.has(name),
    })
  }
  return transitives.toSorted((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// Narrowing.
// ---------------------------------------------------------------------------

function countModel(model: DependencyDiffModel): NarrowCounts {
  let changed = 0
  let added = 0
  let removed = 0
  let major = 0
  let withInstallScripts = 0
  for (let i = 0, { length } = model.deps; i < length; i += 1) {
    const dep = model.deps[i]!
    if (dep.isNew) {
      added += 1
    } else if (dep.removed) {
      removed += 1
    } else {
      changed += 1
    }
    if (dep.major) {
      major += 1
    }
    if (dep.newInstallScripts) {
      withInstallScripts += 1
    }
  }
  return {
    changed,
    added,
    removed,
    major,
    withInstallScripts,
    newTransitives: model.transitives.length,
  }
}

/**
 * Reduce a parsed model to a bounded JSON-ready summary. Counts always reflect
 * the FULL change set; the addedDeps and newTransitives arrays are capped by
 * signal rank, and a final char-budget pass shrinks them further until the
 * compact JSON fits. `truncated` is set whenever any entry was dropped. Pure.
 */
export function narrowDependencyDiff(
  model: DependencyDiffModel,
  options?: NarrowOptions | undefined,
): NarrowedSummary {
  const opts = { __proto__: null, ...options } as NarrowOptions
  const maxDeps = opts.maxDeps ?? DEFAULT_MAX_DEPS
  const maxTransitives = opts.maxTransitives ?? DEFAULT_MAX_TRANSITIVES
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  const counts = countModel(model)

  const rankedDeps = model.deps.toSorted((a, b) => {
    const score = dependencySignalScore(b) - dependencySignalScore(a)
    return score !== 0 ? score : a.name.localeCompare(b.name)
  })
  const rankedTransitives = model.transitives.toSorted((a, b) => {
    const score = Number(b.newInstallScripts) - Number(a.newInstallScripts)
    return score !== 0 ? score : a.name.localeCompare(b.name)
  })

  let depCap = Math.min(maxDeps, rankedDeps.length)
  let transitiveCap = Math.min(maxTransitives, rankedTransitives.length)

  const build = (): NarrowedSummary => ({
    addedDeps: rankedDeps.slice(0, depCap),
    newTransitives: rankedTransitives.slice(0, transitiveCap),
    newTransitiveCount: counts.newTransitives,
    counts,
    droppedLockfileBody: true,
    truncated:
      depCap < rankedDeps.length || transitiveCap < rankedTransitives.length,
  })

  let summary = build()
  // Char-budget pass: drop the lowest-signal transitive, then the lowest-signal
  // dep, one at a time until the compact JSON fits the window or nothing is left
  // to drop. The counts stay intact so the classifier still sees the totals.
  while (
    JSON.stringify(summary).length > maxChars &&
    (transitiveCap > 0 || depCap > 0)
  ) {
    if (transitiveCap > 0) {
      transitiveCap -= 1
    } else {
      depCap -= 1
    }
    summary = build()
  }
  return summary
}

// ---------------------------------------------------------------------------
// Thin CLI.
// ---------------------------------------------------------------------------

interface CliArgs {
  from: string | undefined
  to: string | undefined
  maxDeps: number | undefined
  maxTransitives: number | undefined
  maxChars: number | undefined
  pretty: boolean
  help: boolean
}

const MANIFEST_CONTEXT_LINES = 1000
const LOCKFILE_CONTEXT_LINES = 3

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    from: undefined,
    to: undefined,
    maxDeps: undefined,
    maxTransitives: undefined,
    maxChars: undefined,
    pretty: false,
    help: false,
  }
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const token = argv[i]!
    const eq = token.indexOf('=')
    const flag =
      token.startsWith('--') && eq !== -1 ? token.slice(0, eq) : token
    const inlineValue =
      token.startsWith('--') && eq !== -1 ? token.slice(eq + 1) : undefined
    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) {
        return inlineValue
      }
      i += 1
      return argv[i]
    }
    switch (flag) {
      case '--from':
        args.from = takeValue()
        break
      case '--to':
        args.to = takeValue()
        break
      case '--max-deps':
        args.maxDeps = Number(takeValue())
        break
      case '--max-transitives':
        args.maxTransitives = Number(takeValue())
        break
      case '--max-chars':
        args.maxChars = Number(takeValue())
        break
      case '--pretty':
        args.pretty = true
        break
      case '--help':
      case '-h':
        args.help = true
        break
      default:
        break
    }
  }
  return args
}

function usageText(): string {
  return [
    'Usage: node scripts/fleet/weekly-update/diff-narrow.mts [options]',
    '',
    'Narrow a dependency diff into a bounded JSON summary for keyless',
    'classify-deps. Reads the diff from stdin, or builds one from git refs.',
    '',
    'Options:',
    '  --from <ref>          diff base ref; without --to, compares to the work tree',
    '  --to <ref>            diff target ref',
    '  --max-deps <n>        cap on emitted dependency entries',
    '  --max-transitives <n> cap on emitted new-transitive entries',
    '  --max-chars <n>       hard cap on the compact JSON size',
    '  --pretty              pretty-print the JSON instead of one line',
    '  -h, --help            show this help',
  ].join('\n')
}

async function buildGitDiff(
  from: string,
  to: string | undefined,
): Promise<string> {
  const range = to === undefined ? [from] : [from, to]
  const run = async (
    contextLines: number,
    paths: string[],
  ): Promise<string> => {
    const result = await spawn(
      'git',
      ['diff', `--unified=${contextLines}`, ...range, '--', ...paths],
      { cwd: REPO_ROOT, stdioString: true },
    )
    return String(result.stdout ?? '')
  }
  const manifest = await run(MANIFEST_CONTEXT_LINES, [
    'package.json',
    ':(glob)**/package.json',
    'pnpm-workspace.yaml',
  ])
  const lockfile = await run(LOCKFILE_CONTEXT_LINES, ['pnpm-lock.yaml'])
  return `${manifest}\n${lockfile}`
}

async function readDiffInput(args: CliArgs): Promise<string> {
  if (args.from !== undefined) {
    return await buildGitDiff(args.from, args.to)
  }
  if (process.stdin.isTTY) {
    return ''
  }
  return readFileSync(0, 'utf8')
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseCliArgs(argv)
  if (args.help) {
    logger.log(usageText())
    return 0
  }
  const diffText = await readDiffInput(args)
  if (diffText.trim() === '') {
    logger.error('diff-narrow: no diff on stdin and no --from ref given.')
    logger.error(usageText())
    return 2
  }
  const model = parseDependencyDiff(diffText)
  const summary = narrowDependencyDiff(model, {
    maxDeps: args.maxDeps,
    maxTransitives: args.maxTransitives,
    maxChars: args.maxChars,
  })
  logger.log(
    args.pretty ? JSON.stringify(summary, null, 2) : JSON.stringify(summary),
  )
  return 0
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(
    code => {
      process.exitCode = code
    },
    (e: unknown) => {
      logger.error(`diff-narrow: ${String(e)}`)
      process.exitCode = 1
    },
  )
}
