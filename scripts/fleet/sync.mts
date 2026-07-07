/*
 * @file Named, on-demand fleet-sync dispatcher. Call out a NAMED target
 *   (`pnpm-workspace`, `lint-config`, `foundationals`, …) and sync exactly that
 *   slice at one of three scopes:
 *
 *     node scripts/fleet/sync.mts <target…> [--dogfood | --fleet | --target <repo>] [--check]
 *
 *   - `--dogfood`  template/base → the wheelhouse's own live tree (self-sync).
 *   - `--fleet`    every fleet-repos.json member (one primary checkout each).
 *   - `--target <repo>` one member, by name or path (e.g. a socket-registry override).
 *   - `--check`    dry-run — report would-change counts, write nothing.
 *
 *   It resolves each target to its cascade finding-category set
 *   (`constants/sync-targets.mts`), runs the cascade engine's check pass, filters
 *   the findings to that set, and fixes only those (unless `--check`). It owns NO
 *   sync logic of its own — the byte-copy / dir-mirror / segment-merge /
 *   workspace-merge / json-merge primitives all live in the cascade engine; this
 *   is the thin dispatcher over them.
 *
 *   FLEET-CANONICAL (cascaded under scripts/fleet/). The cascade engine it drives
 *   is wheelhouse-only (`scripts/repo/sync-scaffolding/`), which does NOT exist in
 *   a member repo — so the engine is brought in by DYNAMIC import and a missing
 *   engine fails with a clear message. Cascading FROM the wheelhouse is inherently
 *   a wheelhouse operation, so this is the right boundary.
 */

import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'
import { resolveTargetLeaves, SYNC_TARGETS } from './constants/sync-targets.mts'
import type { SyncScope } from './constants/sync-targets.mts'

const logger = getDefaultLogger()

// The cascade engine surface the dispatcher drives. Typed structurally so the
// dynamic import's shape is checked without a static dependency on the
// wheelhouse-only module graph.
interface CascadeEngine {
  applyFixes: (
    targetDir: string,
    findings: Finding[],
  ) => Promise<number> | number
  collectFindings: (targetDir: string) => Promise<Finding[]>
  discoverFleetRepos: () => Promise<string[]>
}

interface Finding {
  category: string
  file: string
  message: string
  fixed?: boolean | undefined
}

interface SyncFlags {
  check: boolean
  scope: SyncScope
  targetRepo: string | undefined
  targets: string[]
}

/**
 * Parse argv into the resolved sync flags. Positional args are target names;
 * `--dogfood` / `--fleet` / `--target <repo>` pick the scope (default: dogfood
 * — the self-sync is the safe no-side-effect-on-others default); `--check` is
 * the dry run. Throws on a flag conflict or a missing `--target` value.
 */
export function parseSyncArgv(argv: readonly string[]): SyncFlags {
  const opts = { __proto__: null } as unknown as {
    check: boolean
    dogfood: boolean
    fleet: boolean
    targetRepo: string | undefined
    targets: string[]
  }
  opts.check = false
  opts.dogfood = false
  opts.fleet = false
  opts.targetRepo = undefined
  opts.targets = []
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--check') {
      opts.check = true
    } else if (arg === '--dogfood') {
      opts.dogfood = true
    } else if (arg === '--fleet') {
      opts.fleet = true
    } else if (arg === '--target') {
      opts.targetRepo = argv[i + 1]
      i += 1
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag "${arg}".`)
    } else {
      opts.targets.push(arg)
    }
  }

  const scopeCount =
    Number(opts.dogfood) +
    Number(opts.fleet) +
    Number(opts.targetRepo !== undefined)
  if (scopeCount > 1) {
    throw new Error(
      'Pick exactly one scope: --dogfood, --fleet, or --target <repo>.',
    )
  }
  if (opts.targetRepo !== undefined && opts.targetRepo.startsWith('--')) {
    throw new Error('--target needs a repo name or path argument.')
  }
  let scope: SyncScope
  if (opts.fleet) {
    scope = 'fleet'
  } else if (opts.targetRepo !== undefined) {
    scope = 'repo'
  } else {
    scope = 'dogfood'
  }
  return {
    check: opts.check,
    scope,
    targetRepo: opts.targetRepo,
    targets: opts.targets,
  }
}

// One leaf target's slice of the filter: the categories it owns plus a
// file-path predicate. A finding is in scope when SOME rule owns its category
// AND that rule's `matchesPath` accepts its file. Pairing categories with a
// per-leaf path predicate (rather than merging into a flat category union) is
// what stops a generic category like `content_drift` — shared by every
// byte-identical file — from pulling the whole mirror into a narrow target.
interface SyncRule {
  categories: ReadonlySet<string>
  matchesPath: (file: string) => boolean
}

/**
 * Resolve the named targets to a list of per-leaf filter rules, validating that
 * each name exists and that the scope is allowed for each. Throws (with the
 * usage list) on an unknown name or a scope the target forbids. Composites
 * expand to their leaves; each leaf contributes one rule carrying its
 * categories and (if declared) its `paths` allowlist as a compiled matcher.
 */
export function resolveSyncRules(
  targets: readonly string[],
  scope: SyncScope,
): SyncRule[] {
  if (targets.length === 0) {
    throw new Error(
      'Name at least one target. Known: ' + knownTargetNames().join(', ') + '.',
    )
  }
  const leafNames = new Set<string>()
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const name = targets[i]!
    const target = SYNC_TARGETS[name]
    if (target === undefined) {
      throw new Error(
        `Unknown target "${name}". Known: ${knownTargetNames().join(', ')}.`,
      )
    }
    if (!target.scopes.includes(scope)) {
      throw new Error(
        `Target "${name}" does not support the "${scope}" scope ` +
          `(allowed: ${[...target.scopes].toSorted().join(', ')}).`,
      )
    }
    for (const leaf of resolveTargetLeaves(name)) {
      leafNames.add(leaf)
    }
  }
  const rules: SyncRule[] = []
  for (const leaf of leafNames) {
    const target = SYNC_TARGETS[leaf]!
    rules.push({
      categories: new Set(target.categories),
      matchesPath: target.paths ? makePathMatcher(target.paths) : () => true,
    })
  }
  return rules
}

/**
 * True when `file` matches at least one rule's category + path scope. The
 * single predicate the dispatcher applies to every collected finding.
 */
export function findingInScope(
  rules: readonly SyncRule[],
  category: string,
  file: string,
): boolean {
  return rules.some(r => r.categories.has(category) && r.matchesPath(file))
}

/**
 * Compile a repo-relative path glob to an anchored RegExp. A single star
 * matches one path segment (no slash); a double-star matches any run including
 * slashes. A leading double-star immediately followed by a slash also matches
 * zero leading segments, so a repo-root `tsconfig.json` is matched by a
 * double-star-prefixed glob. Every other regex metachar is escaped literally.
 */
export function globToRegExp(glob: string): RegExp {
  let out = '^'
  for (let i = 0, { length } = glob; i < length; i += 1) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          // `**/` — zero or more leading path segments.
          out += '(?:.*/)?'
          i += 2
        } else {
          // `**` — any run including `/`.
          out += '.*'
          i += 1
        }
      } else {
        // `*` — one path segment (no `/`).
        out += '[^/]*'
      }
    } else if ('.+?^${}()|[]\\/'.includes(c)) {
      out += `\\${c}`
    } else {
      out += c
    }
  }
  return new RegExp(`${out}$`)
}

function makePathMatcher(globs: readonly string[]): (file: string) => boolean {
  const regexes = globs.map(globToRegExp)
  return (file: string) => regexes.some(re => re.test(file))
}

function knownTargetNames(): string[] {
  return Object.keys(SYNC_TARGETS)
    .filter(k => k !== '__proto__')
    .toSorted()
}

/**
 * Dynamically load the wheelhouse-only cascade engine. Fails with a clear
 * message when run from a member repo (where scripts/repo/sync-scaffolding/ was
 * never cascaded) — named-sync runs FROM the wheelhouse.
 */
async function loadCascadeEngine(): Promise<CascadeEngine> {
  const base = path.join(REPO_ROOT, 'scripts', 'repo', 'sync-scaffolding')
  try {
    const cli = (await import(path.join(base, 'cli.mts'))) as {
      collectFindings: CascadeEngine['collectFindings']
    }
    const fix = (await import(path.join(base, 'fix.mts'))) as {
      applyFixes: CascadeEngine['applyFixes']
    }
    const discover = (await import(path.join(base, 'discover.mts'))) as {
      discoverFleetRepos: CascadeEngine['discoverFleetRepos']
    }
    return {
      applyFixes: fix.applyFixes,
      collectFindings: cli.collectFindings,
      discoverFleetRepos: discover.discoverFleetRepos,
    }
  } catch (e) {
    throw new Error(
      'The cascade engine (scripts/repo/sync-scaffolding/) is not available ' +
        'here. Named-sync runs FROM the wheelhouse checkout, which owns the ' +
        `engine. Underlying error: ${errorMessage(e)}`,
    )
  }
}

/**
 * Resolve the list of target repo directories for a scope. dogfood → the
 * wheelhouse itself; fleet → every discovered member; repo → the one named
 * member (resolved against the fleet list by basename, else treated as a path).
 */
async function resolveScopeRepos(
  engine: CascadeEngine,
  flags: SyncFlags,
): Promise<string[]> {
  if (flags.scope === 'dogfood') {
    return [REPO_ROOT]
  }
  if (flags.scope === 'fleet') {
    return engine.discoverFleetRepos()
  }
  // repo scope — match the name against discovered members by basename, else
  // treat the value as a filesystem path.
  const wanted = flags.targetRepo!
  const members = await engine.discoverFleetRepos()
  const byName = members.find(dir => path.basename(dir) === wanted)
  if (byName !== undefined) {
    return [byName]
  }
  return [path.resolve(wanted)]
}

/**
 * Run the named sync. For each resolved repo: run the cascade check pass, keep
 * only the findings in the resolved category set, then either report (--check)
 * or apply the fixes for exactly those findings. Returns the process exit code
 * (1 if any selected finding stayed unfixed after a real run).
 */
export async function runSync(flags: SyncFlags): Promise<number> {
  const rules = resolveSyncRules(flags.targets, flags.scope)
  const engine = await loadCascadeEngine()
  const repos = await resolveScopeRepos(engine, flags)

  // Distinct categories across the rules — for the summary line only; the
  // filter is per-finding (category AND path), not a flat category test.
  const categoryUnion = new Set<string>()
  for (let i = 0, { length } = rules; i < length; i += 1) {
    for (const cat of rules[i]!.categories) {
      categoryUnion.add(cat)
    }
  }

  logger.log(
    `Sync ${flags.targets.join(', ')} [${flags.scope}${flags.check ? ', check' : ''}] ` +
      `→ ${repos.length} repo(s); ${categoryUnion.size} categor${categoryUnion.size === 1 ? 'y' : 'ies'}.`,
  )

  let exitCode = 0
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const repoDir = repos[i]!
    const repoName = path.basename(repoDir)
    const all = await engine.collectFindings(repoDir)
    const selected = all.filter(f => findingInScope(rules, f.category, f.file))

    if (flags.check) {
      logger.log(
        `  ${repoName}: ${selected.length} would-change finding(s) in scope.`,
      )
      for (let j = 0, slen = selected.length; j < slen; j += 1) {
        const f = selected[j]!
        logger.log(`    ${f.category}: ${f.message}`)
      }
      continue
    }

    if (selected.length === 0) {
      logger.log(`  ${repoName}: clean.`)
      continue
    }
    const fixed = await engine.applyFixes(repoDir, selected)
    const unfixed = selected.filter(f => !f.fixed).length
    logger.log(
      `  ${repoName}: ${fixed}/${selected.length} fixed` +
        (unfixed > 0 ? ` (${unfixed} unfixed)` : '') +
        '.',
    )
    if (unfixed > 0) {
      exitCode = 1
    }
  }
  return exitCode
}

async function main(): Promise<void> {
  let flags: SyncFlags
  try {
    flags = parseSyncArgv(process.argv.slice(2))
  } catch (e) {
    logger.error(errorMessage(e))
    logger.log(
      'Usage: node scripts/fleet/sync.mts <target…> ' +
        '[--dogfood | --fleet | --target <repo>] [--check]',
    )
    process.exitCode = 2
    return
  }
  process.exitCode = await runSync(flags)
}

// Only run when invoked directly. The dispatcher's pure helpers
// (`resolveSyncRules`, `findingInScope`, `globToRegExp`, `parseSyncArgv`) are
// imported by the unit tests; without this guard that import would also fire
// `main()`. `process.argv[1]` is the invoked script path; compare it to this
// module's own URL.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main().catch((e: unknown) => {
    const detail = e instanceof Error ? (e.stack ?? e.message) : String(e)
    logger.fail('Fleet sync failed:', detail)
    process.exitCode = 1
  })
}
