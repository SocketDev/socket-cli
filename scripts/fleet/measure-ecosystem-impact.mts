#!/usr/bin/env node
/**
 * @file `measure-ecosystem-impact` — rank npm packages by ecosystem reach and
 *   model what overriding them actually removes from an install tree.
 *   Two signals, and neither works alone. RANK is a package's position in
 *   `npm-high-impact`'s lists, and it over-values a package nothing depends on
 *   transitively. CUT measures what an override deletes from the tree, and it
 *   over-values a deep tree nobody installs. Rank the candidates, then
 *   simulate the cut.
 *   The simulation reports SURVIVING GATEWAYS and CLIQUES by default, not just
 *   a percentage, because a percentage alone reads as progress when it is not:
 *   porting eight es-abstract leaf predicates was predicted to drive the
 *   plumbing to ~0 and delivered 29–43%, since those plumbing packages are each
 *   other's gateways. A consumer-side override cannot dissolve a clique — only
 *   overriding its members can. The graph math lives in
 *   `lib/ecosystem-impact.mts`; this file owns the CLI, the registry fetch, and
 *   the report.
 *   Every result prints the ROOT SET it was measured from. Two runs over
 *   different root sets are not comparable, and reading them as if they were
 *   turns a stable number into a phantom regression.
 *   Network + cache: direct dependencies come from
 *   `registry.npmjs.org/<name>/latest`, memoized in-process and persisted under
 *   the repo's `.cache/fleet/` runtime store (never the tracked tree), with
 *   backoff on 429. `--offline` serves the cache only and fails loud on a miss.
 *   Usage: node scripts/fleet/measure-ecosystem-impact.mts --targets <a,b,c>
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { simulateOverrideCut } from './lib/ecosystem-impact.mts'
import { FLEET_CACHE_DIR } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

import type { ScriptMeta } from './_shared/run-main.mts'

import type {
  DependencyGraph,
  OverrideCutReport,
} from './lib/ecosystem-impact.mts'

const logger = getDefaultLogger()

const REGISTRY_BASE = 'https://registry.npmjs.org'

// Where the resolved dependency map is persisted between runs. Under the
// repo's runtime-state store, which is gitignored — a cache is never tracked.
const CACHE_FILE = path.join(FLEET_CACHE_DIR, 'ecosystem-impact-deps.json')

// npm-high-impact's three lists. `high-impact` is its blended ranking; the
// other two are the raw inputs, kept selectable because "most depended on" and
// "most downloaded" disagree in useful ways.
export const IMPACT_LISTS = [
  'high-impact',
  'top-dependents',
  'top-downloads',
] as const

export type ImpactList = (typeof IMPACT_LISTS)[number]

/**
 * Resolve one package's direct dependency names. Injectable so the tests drive
 * the whole pipeline with a synthetic graph and never touch the network.
 */
export type ResolveDependencies = (name: string) => Promise<string[]>

/**
 * The parsed CLI surface.
 */
export interface ImpactCliArgs {
  readonly gateways: number
  readonly json: boolean
  readonly maxDepth: number
  readonly offline: boolean
  readonly overridden: readonly string[]
  readonly rootCount: number
  readonly rootList: ImpactList
  readonly roots: readonly string[]
  readonly targets: readonly string[]
}

/**
 * Split a `--targets a,b,c` style value into names, dropping blanks. Also
 * accepts repeated flags, which `parseArgs` hands back as an array.
 */
export function parseNameList(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return []
  }
  const raw = Array.isArray(value) ? value : [value]
  const names: string[] = []
  for (let i = 0, { length } = raw; i < length; i += 1) {
    const parts = raw[i]!.split(',')
    for (let j = 0, { length: partCount } = parts; j < partCount; j += 1) {
      const part = parts[j]!
      const name = part.trim()
      if (name !== '') {
        names.push(name)
      }
    }
  }
  return [...new Set(names)]
}

/**
 * The `--help` text. Kept as data so the skill can show it without running the
 * script.
 */
export function impactHelpText(): string {
  return `measure-ecosystem-impact — rank npm packages by reach, then model what an override removes.

Usage:
  node scripts/fleet/measure-ecosystem-impact.mts --targets <a,b,c> [options]

Options:
  --targets <list>       Packages to measure. Comma-separated, repeatable. Required.
  --overridden <list>    Packages already replaced by a zero-dep drop-in. Their
                         dependencies are zeroed in the cut simulation.
  --roots <list>         Explicit root set. Overrides --root-count/--root-list.
  --root-count <n>       Seed the root set from the top N npm-high-impact entries
                         when --roots is absent. Default 250.
  --root-list <name>     Which npm-high-impact list seeds the roots:
                         high-impact | top-dependents | top-downloads.
                         Default high-impact.
  --max-depth <n>        Dependency-closure walk depth. Default 12.
  --gateways <n>         Surviving gateways printed per target. Default 10.
  --offline              Serve the cache only; fail loud on a miss.
  --json                 Emit the machine-readable report instead of the table.
  --help                 Show this text.

Reading the output:
  Rank is ecosystem reach; cut is what an override actually deletes. Neither
  answers the question alone.

  The cut percentage is NOT the verdict. Read SURVIVING GATEWAYS first: if a
  target's own siblings route to it, the group is a clique and consumer-side
  overriding will never empty it — only porting its members will. The report
  flags those groups explicitly.

  Every result prints its ROOT SET. Cut numbers measured from different root
  sets are not comparable; do not read one against the other.`
}

/**
 * Parse argv into the CLI surface.
 */
export function parseImpactArgs(argv: readonly string[]): ImpactCliArgs {
  const { values } = parseArgs({
    allowPositionals: false,
    args: [...argv],
    options: {
      gateways: { type: 'string' },
      json: { default: false, type: 'boolean' },
      'max-depth': { type: 'string' },
      offline: { default: false, type: 'boolean' },
      overridden: { multiple: true, type: 'string' },
      'root-count': { type: 'string' },
      'root-list': { type: 'string' },
      roots: { multiple: true, type: 'string' },
      targets: { multiple: true, type: 'string' },
    },
    strict: false,
  })
  const listValue = String(values['root-list'] ?? 'high-impact')
  const rootList = IMPACT_LISTS.includes(listValue as ImpactList)
    ? (listValue as ImpactList)
    : 'high-impact'
  return {
    gateways: toPositiveInt(values['gateways'], 10),
    json: values['json'] === true,
    maxDepth: toPositiveInt(values['max-depth'], 12),
    offline: values['offline'] === true,
    overridden: parseNameList(values['overridden'] as string[] | undefined),
    rootCount: toPositiveInt(values['root-count'], 250),
    rootList,
    roots: parseNameList(values['roots'] as string[] | undefined),
    targets: parseNameList(values['targets'] as string[] | undefined),
  }
}

/**
 * A positive integer from a CLI string, or `fallback` when absent or unusable.
 */
export function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Walk the dependency closure of `roots` breadth-first, memoized, stopping at
 * `maxDepth`. Returns the graph plus the names that hit the depth wall, so a
 * truncated walk is reported rather than silently passed off as complete.
 */
export async function resolveDependencyClosure(
  roots: readonly string[],
  resolve: ResolveDependencies,
  options?: { maxDepth?: number | undefined } | undefined,
): Promise<{ graph: DependencyGraph; truncated: string[] }> {
  const { maxDepth } = { __proto__: null, ...options } as {
    maxDepth?: number | undefined
  }
  const depthCap = maxDepth ?? 12
  const graph = new Map<string, readonly string[]>()
  const truncated: string[] = []
  let frontier = [...new Set(roots)]
  for (let depth = 0; depth < depthCap && frontier.length > 0; depth += 1) {
    const pending = frontier.filter(name => !graph.has(name))
    // eslint-disable-next-line no-await-in-loop -- one level at a time: the next frontier is only known after this one resolves.
    const resolved = await Promise.all(
      pending.map(async name => [name, await resolve(name)] as const),
    )
    const next: string[] = []
    for (const [name, deps] of resolved) {
      graph.set(name, deps)
      for (const dep of deps) {
        if (!graph.has(dep)) {
          next.push(dep)
        }
      }
    }
    frontier = [...new Set(next)]
  }
  for (let i = 0, { length } = frontier; i < length; i += 1) {
    const name = frontier[i]!
    if (!graph.has(name)) {
      truncated.push(name)
      // A node with no recorded edges would otherwise read as a true leaf.
      graph.set(name, [])
    }
  }
  return { graph, truncated: truncated.toSorted() }
}

/**
 * A `ResolveDependencies` backed by the npm registry, layered over a persistent
 * cache. Retries a 429 with exponential backoff — the registry rate-limits a
 * closure walk quickly, and a dropped package silently shrinks the graph.
 */
export function createRegistryResolver(
  options?:
    | {
        readonly cache?: Map<string, string[]> | undefined
        readonly fetchImpl?: typeof fetch | undefined
        readonly offline?: boolean | undefined
        readonly retries?: number | undefined
        readonly sleepImpl?: ((ms: number) => Promise<void>) | undefined
      }
    | undefined,
): ResolveDependencies {
  const opts = { __proto__: null, ...options } as NonNullable<
    Parameters<typeof createRegistryResolver>[0]
  >
  const cache = opts.cache ?? new Map<string, string[]>()
  const doFetch = opts.fetchImpl ?? fetch
  const retries = opts.retries ?? 4
  const sleep =
    opts.sleepImpl ??
    (async (ms: number) => {
      await new Promise(resolve => setTimeout(resolve, ms))
    })
  return async function resolveFromRegistry(name: string): Promise<string[]> {
    const hit = cache.get(name)
    if (hit) {
      return hit
    }
    if (opts.offline) {
      throw new Error(
        `measure-ecosystem-impact: '${name}' is not in the dependency cache.\n` +
          `  Where: ${CACHE_FILE}.\n` +
          '  Saw: --offline with a cache miss; wanted every walked package already cached.\n' +
          '  Fix: re-run once without --offline to populate the cache, then retry offline.',
      )
    }
    let waitMs = 500
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- a retry loop is serial by definition.
      const response = await doFetch(
        `${REGISTRY_BASE}/${encodeURIComponent(name).replace(/^%40/, '@')}/latest`,
      )
      if (response.status === 429) {
        if (attempt === retries) {
          break
        }
        // eslint-disable-next-line no-await-in-loop -- backoff must elapse before the next attempt.
        await sleep(waitMs)
        waitMs *= 2
        continue
      }
      if (response.status === 404) {
        // An unpublished or renamed name is a real leaf, not a failure.
        cache.set(name, [])
        return []
      }
      if (!response.ok) {
        throw new Error(
          `measure-ecosystem-impact: the registry rejected the manifest read for '${name}'.\n` +
            `  Where: ${REGISTRY_BASE}/${name}/latest.\n` +
            `  Saw: HTTP ${response.status}; wanted 200 with a manifest body.\n` +
            '  Fix: re-run when the registry recovers, or pass --offline to use the cached graph.',
        )
      }
      // eslint-disable-next-line no-await-in-loop -- the body belongs to this attempt.
      const manifest = (await response.json()) as {
        dependencies?: Record<string, string> | undefined
      }
      const deps = Object.keys(manifest.dependencies ?? {}).toSorted()
      cache.set(name, deps)
      return deps
    }
    throw new Error(
      `measure-ecosystem-impact: the registry rate-limited '${name}' past every retry.\n` +
        `  Where: ${REGISTRY_BASE}/${name}/latest, ${retries + 1} attempts.\n` +
        '  Saw: HTTP 429 each time; wanted a 200 manifest.\n' +
        '  Fix: wait for the limit to reset and re-run — the cache keeps what already resolved.',
    )
  }
}

/**
 * Load the persisted dependency cache, or an empty map when absent/corrupt. A
 * cache is an optimization: a bad one is discarded, never fatal.
 */
export async function readDependencyCache(
  cachePath: string,
): Promise<Map<string, string[]>> {
  if (!existsSync(cachePath)) {
    return new Map()
  }
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath, 'utf8')) as Record<
      string,
      string[]
    >
    return new Map(Object.entries(parsed))
  } catch {
    return new Map()
  }
}

/**
 * Persist the dependency cache under the repo's runtime-state store.
 */
export async function writeDependencyCache(
  cachePath: string,
  cache: ReadonlyMap<string, string[]>,
): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true })
  await fs.writeFile(
    cachePath,
    `${JSON.stringify(Object.fromEntries([...cache].toSorted()), undefined, 2)}\n`,
  )
}

/**
 * The rank of each name in an npm-high-impact list, 1-based. Names outside the
 * list get `undefined` — absence is information, not a zero.
 */
export function rankByImpactList(
  list: readonly string[],
  names: readonly string[],
): Map<string, number | undefined> {
  const positions = new Map<string, number>()
  for (let i = 0, { length } = list; i < length; i += 1) {
    if (!positions.has(list[i]!)) {
      positions.set(list[i]!, i + 1)
    }
  }
  const ranks = new Map<string, number | undefined>()
  for (let i = 0, { length } = names; i < length; i += 1) {
    ranks.set(names[i]!, positions.get(names[i]!))
  }
  return ranks
}

/**
 * Load an npm-high-impact list. Imported lazily and reported with a fix line
 * when the optional devDependency is absent, so a repo that has not adopted it
 * still gets a usable error rather than a module-resolution stack.
 */
export async function loadImpactList(list: ImpactList): Promise<string[]> {
  let mod: Record<string, unknown>
  try {
    mod = (await import('npm-high-impact')) as Record<string, unknown>
  } catch {
    throw new Error(
      'measure-ecosystem-impact: the npm-high-impact ranking list is not installed.\n' +
        '  Where: the `npm-high-impact` devDependency of this repo.\n' +
        '  Saw: the import failed; wanted the catalog-pinned list.\n' +
        '  Fix: add `"npm-high-impact": "catalog:"` to devDependencies and run pnpm i, or pass --roots explicitly.',
    )
  }
  const key =
    list === 'top-dependents'
      ? 'npmTopDependents'
      : list === 'top-downloads'
        ? 'npmTopDownloads'
        : 'npmHighImpact'
  const value = mod[key]
  if (!Array.isArray(value)) {
    throw new Error(
      `measure-ecosystem-impact: npm-high-impact has no '${key}' list.\n` +
        '  Where: the installed npm-high-impact module.\n' +
        `  Saw: ${typeof value}; wanted an array of package names.\n` +
        '  Fix: re-pin npm-high-impact to a version that exports the list, or pass --roots explicitly.',
    )
  }
  return value as string[]
}

/**
 * Render the human report. The root set leads, the gateways sit directly under
 * each cut number, and a clique gets a plain-language verdict — a reader who
 * skims must not be able to walk away with the percentage alone.
 */
export function formatImpactReport(
  report: OverrideCutReport,
  options?:
    | { ranks?: ReadonlyMap<string, number | undefined> | undefined }
    | undefined,
): string {
  const { ranks } = { __proto__: null, ...options } as {
    ranks?: ReadonlyMap<string, number | undefined> | undefined
  }
  const lines: string[] = []
  lines.push('measure-ecosystem-impact')
  lines.push('')
  lines.push(
    `Root set (${report.roots.length}): ${summarizeNames(report.roots)}`,
  )
  lines.push(
    `Overridden (${report.overridden.length}): ${summarizeNames(report.overridden)}`,
  )
  lines.push(
    `Reachable packages: ${report.reachableBefore} → ${report.reachableAfter}`,
  )
  lines.push('')
  lines.push(
    'Cut numbers are only comparable against a run with this exact root set.',
  )
  lines.push('')

  for (const result of report.targets) {
    const rank = ranks?.get(result.target)
    const rankText = rank === undefined ? 'unranked' : `rank #${rank}`
    const pct = `${Math.round(result.cutFraction * 100)}%`
    lines.push(
      `${result.target} (${rankText}): ${result.before} → ${result.after} reaching roots, cut ${pct}`,
    )
    if (result.survivingGateways.length === 0) {
      // An empty gateway list is not by itself proof the target is gone: a
      // target that is ALSO a root still reaches itself. Read `after` before
      // making the stronger claim, or the report asserts a removal that did
      // not happen.
      lines.push(
        result.after === 0
          ? '  surviving gateways: none — the target left the tree.'
          : `  surviving gateways: none — nothing live depends on it, yet ${result.after} root(s) still reach it, so it is itself in the root set.`,
      )
    } else {
      lines.push('  surviving gateways:')
      for (const gw of result.survivingGateways) {
        lines.push(`    ${gw.gateway} (${gw.reachingRoots} roots)`)
      }
    }
    if (result.inSurvivingClique) {
      lines.push(
        '  CLIQUE: this target is inside a surviving dependency cycle. Overriding',
      )
      lines.push(
        '  consumers will NOT eliminate it — only overriding the clique members will.',
      )
    }
    lines.push('')
  }

  if (report.cliques.length > 0) {
    lines.push('Surviving cliques among the targets:')
    for (const clique of report.cliques) {
      lines.push(`  { ${clique.join(', ')} }`)
    }
    lines.push(
      "  These groups are each other's gateways. Port their members directly;",
    )
    lines.push('  no amount of consumer-side overriding dissolves them.')
  } else {
    lines.push('No surviving cliques among the targets.')
  }
  return lines.join('\n')
}

/**
 * A bounded preview of a name list, so a 250-package root set stays one line
 * while still naming what it was.
 */
export function summarizeNames(names: readonly string[]): string {
  if (names.length === 0) {
    return '(none)'
  }
  if (names.length <= 6) {
    return names.join(', ')
  }
  return `${names.slice(0, 6).join(', ')}, +${names.length - 6} more`
}

export async function main(): Promise<void> {
  const args = parseImpactArgs(process.argv.slice(2))
  if (args.targets.length === 0) {
    logger.fail(
      'measure-ecosystem-impact: no targets to measure.\n' +
        '  Where: the --targets flag.\n' +
        '  Saw: no package names; wanted at least one.\n' +
        '  Fix: pass --targets <a,b,c>, or --help for the full flag list.',
    )
    process.exitCode = 1
    return
  }

  const impactList =
    args.roots.length > 0 ? [] : await loadImpactList(args.rootList)
  const roots =
    args.roots.length > 0
      ? args.roots
      : [...new Set([...impactList.slice(0, args.rootCount), ...args.targets])]

  const cache = await readDependencyCache(CACHE_FILE)
  const resolve = createRegistryResolver({ cache, offline: args.offline })
  const { graph, truncated } = await resolveDependencyClosure(roots, resolve, {
    maxDepth: args.maxDepth,
  })
  await writeDependencyCache(CACHE_FILE, cache)

  if (truncated.length > 0) {
    logger.warn(
      `[measure-ecosystem-impact] closure truncated at depth ${args.maxDepth}; ` +
        `${truncated.length} package(s) were treated as leaves. Raise --max-depth for an exact cut.`,
    )
  }

  const report = simulateOverrideCut(graph, roots, args.targets, {
    gatewayLimit: args.gateways,
    overridden: args.overridden,
  })

  if (args.json) {
    logger.log(JSON.stringify(report, undefined, 2))
    return
  }
  const ranks =
    impactList.length > 0
      ? rankByImpactList(impactList, args.targets)
      : undefined
  logger.log(formatImpactReport(report, { ranks }))
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'ranks npm packages by ecosystem reach and models what overriding them removes from an install tree',
  help: impactHelpText(),
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
