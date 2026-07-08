// Fleet-wide public-API-surface audit: find published exports that nobody
// consumes.
//
// A core infra lib (socket-lib has 500+ subpath exports) accumulates dead
// surface — subpaths exported in `package.json#exports` that no other fleet
// repo imports, and that even the lib's own `src/` never references. Dead
// surface is pure carrying cost: bundle weight, a wider type-check graph, and a
// maintenance tax on every refactor. Nothing tells us which exports are dead,
// so they never get pruned.
//
// This script reads the HOST repo's export map, then for each subpath grep the
// rest of the lib (internal use) and every sibling fleet repo under $PROJECTS
// (external use). It classifies each subpath and emits a ranked report. It is
// REPO-GENERIC: it reads the host's own `package.json#name` + export map, so
// the same code audits any lib-shaped fleet repo, not just socket-lib.
//
// Read-only by construction: it NEVER deletes an export. Pruning dead surface
// stays a human decision (a "dead" subpath may be a deliberate public entry
// point a not-yet-cloned consumer depends on). Mirrors `auditing-gha`, which
// reports drift but never flips a setting.
//
// Usage (run from the repo being audited, or pass --repo):
//   node audit-api-surface.mts                      # report for cwd's repo
//   node audit-api-surface.mts --repo socket-lib    # report for a named repo under $PROJECTS
//   node audit-api-surface.mts --json               # machine-readable to stdout
//   node audit-api-surface.mts --report             # write markdown (default)
//   PROJECTS=/path/to/checkouts node audit-api-surface.mts
//
// Consumer discovery is local-first: it greps sibling checkouts present under
// $PROJECTS. A fleet repo on the roster but ABSENT from $PROJECTS is reported
// `unscanned` — never silently treated as a non-consumer (an absent repo is not
// proof of non-consumption). In CI the wrapping workflow clones the roster
// first, so coverage is complete there.

import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isSpawnError } from '@socketsecurity/lib-stable/process/spawn/errors'
import { naturalCompare } from '@socketsecurity/lib-stable/sorts/natural'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

// Canonical fleet roster — the single source of truth, owned by the shared
// _shared/scripts/fleet-roster.mts (1 path, 1 reference). Never duplicate it.
import { readRoster } from '../../_shared/scripts/fleet-roster.mts'

const logger = getDefaultLogger()

const PROJECTS = process.env['PROJECTS'] || path.join(os.homedir(), 'projects')

export { readRoster }

// Source extensions a consumer import could live in.
const CONSUMER_GLOBS = ['*.ts', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs']

// Directories never worth grepping in a consumer scan — generated or vendored.
const CONSUMER_IGNORE_DIRS = ['node_modules', 'dist', 'build', 'coverage']

export type SurfaceClass =
  | 'consumed'
  | 'dead'
  | 'internal-only'
  | 'single-consumer'
  | 'unverifiable'

export type SubpathFinding = {
  readonly subpath: string
  readonly sourceFile: string | undefined
  readonly internalRefs: number
  readonly consumers: readonly string[]
  readonly classification: SurfaceClass
}

export type AuditResult = {
  readonly hostRepo: string
  readonly hostPackage: string
  readonly importPrefixes: readonly string[]
  readonly scannedConsumers: readonly string[]
  readonly unscannedConsumers: readonly string[]
  readonly totalSubpaths: number
  readonly findings: readonly SubpathFinding[]
}

export type CliOptions = {
  readonly emit: 'json' | 'report'
  readonly repo: string | undefined
  readonly projects: string
}

export function parseArgs(argv: readonly string[]): CliOptions {
  let emit: 'json' | 'report' = 'report'
  let repo: string | undefined
  const projects = PROJECTS
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') {
      emit = 'json'
    } else if (arg === '--report') {
      emit = 'report'
    } else if (arg === '--repo') {
      repo = argv[i + 1]
      i += 1
    }
  }
  return { emit, projects, repo }
}

// The two import forms a consumer can use for a fleet lib: the package name and
// its `-stable` alias (defined in every consumer's pnpm-workspace.yaml as
// `<name>-stable: npm:<name>@<pinned>`). Both resolve to the same exports, so
// the consumer scan must match either.
export function importPrefixesFor(packageName: string): string[] {
  return [packageName, `${packageName}-stable`]
}

// Every subpath export, paired with its `source` src file. The export map value
// carries `source` (e.g. `./src/ai/discover.mts`); a few entries (assets,
// `./package.json`) have no source — those are skipped from the dead-code pass
// but still listed.
export function enumerateSubpaths(
  exportsMap: Record<string, unknown>,
): Array<{ subpath: string; sourceFile: string | undefined }> {
  const out: Array<{ subpath: string; sourceFile: string | undefined }> = []
  for (const key of Object.keys(exportsMap)) {
    if (!key.startsWith('./') || key === './package.json') {
      continue
    }
    const value = exportsMap[key]
    let sourceFile: string | undefined
    if (value && typeof value === 'object' && 'source' in value) {
      const src = (value as { source?: unknown | undefined }).source
      if (typeof src === 'string') {
        sourceFile = src
      }
    }
    // `./ai/discover` -> import suffix `ai/discover`.
    out.push({ sourceFile, subpath: key.slice(2) })
  }
  out.sort((a, b) => naturalCompare(a.subpath, b.subpath))
  return out
}

// Count references to a source file from elsewhere in the same repo's `src/`.
// We grep for the file's import stem (its path minus extension) so both
// `./discover` and `../ai/discover.mts` style relative imports are caught. The
// source file itself and its co-located test are excluded from the count.
export async function countInternalRefs(
  repoDir: string,
  sourceFile: string | undefined,
): Promise<number> {
  if (!sourceFile) {
    return 0
  }
  // `./src/ai/discover.mts` -> stem `discover`. Matching the basename stem is
  // intentionally loose; a positive count means "referenced somewhere", which
  // is all the classification needs. False positives keep an export, which is
  // the safe direction (never auto-deletes).
  const base = path.basename(sourceFile).replace(/\.[cm]?[jt]s$/u, '')
  if (!base) {
    return 0
  }
  const rel = sourceFile.replace(/^\.\//u, '')
  const result = await runRg(
    [
      '--count-matches',
      '--glob',
      '!' + rel,
      '--glob',
      '*.ts',
      '--glob',
      '*.mts',
      '--glob',
      '*.cts',
      `(from|import)\\s+['"][^'"]*/${escapeForRg(base)}(\\.[cm]?[jt]s)?['"]`,
      path.join(repoDir, 'src'),
    ],
    repoDir,
  )
  // --count-matches prints `file:count` per file; sum them.
  let total = 0
  for (const line of result.split('\n')) {
    const colon = line.lastIndexOf(':')
    if (colon === -1) {
      continue
    }
    const n = Number.parseInt(line.slice(colon + 1), 10)
    if (Number.isFinite(n)) {
      total += n
    }
  }
  return total
}

// True when `consumerDir` imports ANY of the import prefixes + subpath. One rg
// per repo per subpath would be slow across 500 subpaths × 11 repos; instead
// the caller harvests ALL of a repo's lib-imports once (harvestConsumerImports)
// and this set-membership check is pure.
export function consumerImportsSubpath(
  imports: ReadonlySet<string>,
  subpath: string,
): boolean {
  return imports.has(subpath)
}

// Harvest every `<prefix>/<subpath>` a consumer repo imports, normalized to the
// bare subpath. One rg pass per repo (not per subpath) — the whole reason the
// scan is fast. Returns the set of subpaths this repo consumes.
export async function harvestConsumerImports(
  consumerDir: string,
  importPrefixes: readonly string[],
): Promise<Set<string>> {
  const consumed = new Set<string>()
  // Build an alternation of escaped prefixes: `@socketsecurity/lib(-stable)?`.
  const escapedPrefixes = importPrefixes.map(escapeForRg).join('|')
  const pattern = `(${escapedPrefixes})/[A-Za-z0-9._/-]+`
  const rgArgs = ['--only-matching', '--no-filename', '--no-line-number']
  for (let i = 0, { length } = CONSUMER_IGNORE_DIRS; i < length; i += 1) {
    const dir = CONSUMER_IGNORE_DIRS[i]!
    rgArgs.push('--glob', `!**/${dir}/**`)
  }
  for (let i = 0, { length } = CONSUMER_GLOBS; i < length; i += 1) {
    const glob = CONSUMER_GLOBS[i]!
    rgArgs.push('--glob', glob)
  }
  rgArgs.push(pattern, consumerDir)
  const out = await runRg(rgArgs, consumerDir)
  for (const raw of out.split('\n')) {
    const match = raw.trim()
    if (!match) {
      continue
    }
    // Strip the prefix, leaving the bare subpath.
    for (const prefix of importPrefixes) {
      if (match.startsWith(prefix + '/')) {
        consumed.add(match.slice(prefix.length + 1))
        break
      }
    }
  }
  return consumed
}

export function classify(
  internalRefs: number,
  consumers: readonly string[],
  { anyUnscanned }: { anyUnscanned: boolean },
): SurfaceClass {
  if (consumers.length >= 2) {
    return 'consumed'
  }
  if (consumers.length === 1) {
    return 'single-consumer'
  }
  // No external consumers found.
  if (anyUnscanned) {
    return 'unverifiable'
  }
  if (internalRefs > 0) {
    return 'internal-only'
  }
  return 'dead'
}

export async function audit(options: CliOptions): Promise<AuditResult> {
  const opts = { __proto__: null, ...options } as typeof options
  const hostDir = resolveHostDir(options)
  const pkgPath = path.join(hostDir, 'package.json')
  if (!existsSync(pkgPath)) {
    throw new Error(
      `no package.json at ${pkgPath}. Run audit-api-surface from a repo root, or pass --repo <name> for a checkout under ${opts.projects}.`,
    )
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    name?: string | undefined
    exports?: Record<string, unknown> | undefined
  }
  const hostPackage = pkg.name ?? path.basename(hostDir)
  const exportsMap = pkg.exports ?? {}
  const subpaths = enumerateSubpaths(exportsMap)
  const importPrefixes = importPrefixesFor(hostPackage)

  const roster = readRoster()
  const hostRepoName = path.basename(hostDir)
  const scannedConsumers: string[] = []
  const unscannedConsumers: string[] = []
  // Map of subpath -> set of consuming repo names.
  const consumerMap = new Map<string, Set<string>>()

  for (const repoName of roster) {
    if (repoName === hostRepoName) {
      continue
    }
    const consumerDir = path.join(opts.projects, repoName)
    if (!existsSync(consumerDir)) {
      unscannedConsumers.push(repoName)
      continue
    }
    scannedConsumers.push(repoName)
    const consumed = await harvestConsumerImports(consumerDir, importPrefixes)
    for (const subpath of consumed) {
      let set = consumerMap.get(subpath)
      if (!set) {
        set = new Set<string>()
        consumerMap.set(subpath, set)
      }
      set.add(repoName)
    }
  }

  const anyUnscanned = unscannedConsumers.length > 0
  const findings: SubpathFinding[] = []
  for (const { sourceFile, subpath } of subpaths) {
    const consumerSet = consumerMap.get(subpath)
    const consumers = consumerSet
      ? [...consumerSet].toSorted(naturalCompare)
      : []
    const internalRefs = await countInternalRefs(hostDir, sourceFile)
    findings.push({
      classification: classify(internalRefs, consumers, { anyUnscanned }),
      consumers,
      internalRefs,
      sourceFile,
      subpath,
    })
  }

  return {
    findings,
    hostPackage,
    hostRepo: hostRepoName,
    importPrefixes,
    scannedConsumers: scannedConsumers.toSorted(naturalCompare),
    totalSubpaths: subpaths.length,
    unscannedConsumers: unscannedConsumers.toSorted(naturalCompare),
  }
}

export function resolveHostDir(options: CliOptions): string {
  const opts = { __proto__: null, ...options } as typeof options
  if (opts.repo) {
    return path.join(opts.projects, opts.repo)
  }
  return process.cwd()
}

export function renderReport(result: AuditResult): string {
  const order: SurfaceClass[] = [
    'dead',
    'single-consumer',
    'internal-only',
    'unverifiable',
    'consumed',
  ]
  const byClass = new Map<SurfaceClass, SubpathFinding[]>()
  for (const f of result.findings) {
    const list = byClass.get(f.classification) ?? []
    list.push(f)
    byClass.set(f.classification, list)
  }
  const lines: string[] = []
  lines.push(`# API surface audit — ${result.hostPackage}`)
  lines.push('')
  lines.push(
    `Read-only audit of every published subpath export. **Nothing is deleted** — each "dead"/"single-consumer" row is a candidate for a human to prune.`,
  )
  lines.push('')
  lines.push('## How this was computed')
  lines.push('')
  lines.push(`- Host repo: \`${result.hostRepo}\` (\`${result.hostPackage}\`)`)
  lines.push(
    `- Import forms matched: ${result.importPrefixes.map(p => `\`${p}/<subpath>\``).join(', ')}`,
  )
  lines.push(`- Subpath exports examined: **${result.totalSubpaths}**`)
  lines.push(
    `- Consumer repos scanned (${result.scannedConsumers.length}): ${result.scannedConsumers.map(r => `\`${r}\``).join(', ') || '_none_'}`,
  )
  if (result.unscannedConsumers.length) {
    lines.push(
      `- ⚠️ Consumer repos NOT scanned (absent under \`$PROJECTS\`): ${result.unscannedConsumers.map(r => `\`${r}\``).join(', ')}. Findings for these are \`unverifiable\` — an absent repo is not proof of non-consumption.`,
    )
  }
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push('| Class | Count | Meaning |')
  lines.push('| --- | --- | --- |')
  const meaning: Record<SurfaceClass, string> = {
    consumed: '≥2 external consumers — healthy, keep',
    dead: 'no internal refs, no external consumers, all repos scanned — prune candidate',
    'internal-only': 'used inside the lib but by no other repo',
    'single-consumer':
      'exactly one external consumer — candidate to inline there',
    unverifiable: 'no consumer found, but some repo was unscanned',
  }
  for (let i = 0, { length } = order; i < length; i += 1) {
    const cls = order[i]!
    const count = byClass.get(cls)?.length ?? 0
    lines.push(`| \`${cls}\` | ${count} | ${meaning[cls]} |`)
  }
  lines.push('')
  for (let i = 0, { length } = order; i < length; i += 1) {
    const cls = order[i]!
    const list = byClass.get(cls)
    if (!list || !list.length) {
      continue
    }
    lines.push(`## \`${cls}\` (${list.length})`)
    lines.push('')
    lines.push('| Subpath | Source | Internal refs | Consumers |')
    lines.push('| --- | --- | --- | --- |')
    for (const f of list) {
      lines.push(
        `| \`${f.subpath}\` | ${f.sourceFile ? `\`${f.sourceFile}\`` : '_(no source)_'} | ${f.internalRefs} | ${f.consumers.map(c => `\`${c}\``).join(', ') || '—'} |`,
      )
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function writeReport(result: AuditResult, hostDir: string): string {
  const reportDir = path.join(hostDir, '.claude', 'reports')
  const reportPath = path.join(reportDir, 'api-surface-audit.md')
  mkdirSync(reportDir, { recursive: true })
  writeFileSync(reportPath, renderReport(result), 'utf8')
  return reportPath
}

function escapeForRg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')
}

// Run ripgrep, returning stdout. rg exits 1 on "no matches" — that is not an
// error here, so a SpawnError with empty/whitespace stdout resolves to ''.
async function runRg(args: readonly string[], cwd: string): Promise<string> {
  try {
    const result = await spawn('rg', [...args], {
      cwd,
      stdioString: true,
    })
    return String(result.stdout ?? '')
  } catch (e: unknown) {
    if (isSpawnError(e)) {
      // Exit code 1 == no matches. Anything else (2 = real error) we surface
      // as empty too, but log it so a broken pattern isn't silent.
      const code = (e as { code?: unknown | undefined }).code
      if (code !== 1) {
        logger.warn(`rg exited ${String(code)} in ${cwd}`)
      }
      return String((e as { stdout?: unknown | undefined }).stdout ?? '')
    }
    throw e
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const result = await audit(options)
  if (options.emit === 'json') {
    logger.log(JSON.stringify(result, undefined, 2))
    return
  }
  const reportPath = writeReport(result, resolveHostDir(options))
  const dead = result.findings.filter(f => f.classification === 'dead').length
  const single = result.findings.filter(
    f => f.classification === 'single-consumer',
  ).length
  logger.success(`API surface audit written to ${reportPath}`)
  logger.log(
    `${result.totalSubpaths} subpaths · ${dead} dead · ${single} single-consumer · ${result.scannedConsumers.length} repos scanned`,
  )
  if (result.unscannedConsumers.length) {
    logger.warn(
      `${result.unscannedConsumers.length} roster repo(s) not present under PROJECTS — their findings are 'unverifiable'.`,
    )
  }
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
