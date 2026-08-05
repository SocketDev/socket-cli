/**
 * @file Generate a package.json `exports` map from a publishable package's
 *   public file surface. Opt-in per package, a package supplies a config; the
 *   guiding question is "when we publish to npm, what do we want a consumer to
 *   import?". One generator handles both dist-based packages (output under
 *   `dist/`) and packages whose published files sit at the package root.
 *   Privacy taxonomy (applied regardless of `dist/`): a file is PRIVATE — never
 *   exported — when its path contains an `external/` segment, an underscore-
 *   prefixed leaf (`_foo.js`) or directory (`_internal/`), or matches a config
 *   `ignore` glob (src/scripts/test/tools/vendor by default). Everything else
 *   is the public surface and earns an `exports` entry. The deterministic core
 *   (`buildExportsMap`) is a pure function over a file list so it is
 *   unit-testable without a real build. The CLI wrapper globs the package,
 *   calls the engine, and writes package.json. Validation that the map and the
 *   on-disk public files agree lives in the companion check
 *   `scripts/fleet/check/public-files-are-exported.mts`.
 */

import { promises as fs, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import { glob } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { toSortedObject } from '@socketsecurity/lib-stable/objects/sort'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'
import {
  resolveSourcePath,
  resolveTypesPath,
} from '../lib/exports-conditions.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// A single export condition target, a file path, keyed by condition name.
// `source` (dev: resolve to TS src for coverage), `browser`, `types`, and
// `default` are the conditions the engine emits. Order is significant in the
// emitted object — most-specific first — so consumers/bundlers match correctly.
export interface ExportConditions {
  source?: string | undefined
  // `browser` takes one of two shapes. A nested conditions object is a
  // self-routing browser-safe leaf — browser resolves to the SAME file's
  // types/default. A bare string is a browser BUILD override — browser resolves
  // to a `.browser.<ext>` sibling of the `default` target, ordered after `types`
  // so `types` still wins for type resolution.
  browser?: ExportConditions | string | undefined
  types?: string | undefined
  default?: string | undefined
}

// One alias entry: a public subpath that re-points at the canonical target's
// value, no source file behind it. Used for fleet-compat barrels.
// When `browserTo` is set, the alias additionally splices a `browser` condition
// pointing at THAT leaf's value — the `./logger` (Node) → `./logger/browser`
// (browser-impl) pattern, where the browser build wants a different file.
export interface ExportAlias {
  readonly from: string
  readonly to: string
  readonly browserTo?: string | undefined
}

export interface ExportsConfig {
  // The built-output root relative to the package. '' = package root (files
  // sit alongside package.json); 'dist' or 'build' = a build dir. The export
  // PUBLIC path strips this prefix (so `dist/foo.js` is imported as `./foo`).
  readonly outDir: string
  // Node engines.node range to stamp (e.g. '>=22'). Omit to leave engines as-is.
  readonly nodeRange?: string | undefined
  // Named after the package.json fields they produce.
  //
  // `files` — globs, relative to the package, of candidate published files;
  // produces both the export surface and the `files[]` allowlist. Defaults to
  // every JS/JSON/d.ts under outDir.
  readonly files?: readonly string[] | undefined
  // `ignore` — exclusion globs on top of the built-in privacy taxonomy.
  readonly ignore?: readonly string[] | undefined
  // `browser` — glob patterns, matched against the post-strip export path, that
  // declare sibling-LESS leaves browser-safe; each match gets a self-routing
  // `browser` condition — browser resolves to the SAME file. Covers a subtree
  // (`./arrays/**`) or a browser-impl leaf (`**/browser`). This is the glob's
  // ONLY role: a browser OVERRIDE — an entry with a `.browser.<ext>` build
  // sibling next to its `default` target, `dist/index.browser.js` beside
  // `dist/index.js` — is detected automatically and needs NO glob; that entry
  // gets a `browser` condition pointing at the sibling (ordered after `types`)
  // and the sibling is consumed rather than emitted as its own `./index.browser`
  // entry. Declaring ANY browser glob ALSO triggers the
  // top-level package.json `browser` field: the engine infers it, stubbing
  // every Node builtin (from `node:module`'s `builtinModules`) to `false` —
  // bare key + `node:`-prefixed twin — so a downstream browser bundle gets an
  // empty stub instead of a hard build error on a `node:*` import reachable
  // from a browser-safe entry. No explicit builtin list: the engine owns it. An
  // auto sibling override alone does NOT trigger the stubbing — it declares one
  // specific browser build, not a browser-safe subtree.
  readonly browser?: readonly string[] | undefined
  // Re-pointer aliases (barrels). Optional `browserTo` adds a browser-condition
  // override (./logger → ./logger/browser).
  readonly aliases?: readonly ExportAlias[] | undefined
  // EXTRA private path-segment names on top of the built-in defaults
  // (`external`, `_`-prefixed). A repo that marks privacy with, say,
  // `internal/` instead of `_internal/` lists `['internal']` here. The
  // underscore-prefix rule always applies; this only ADDS exact segment names.
  readonly privateSegments?: readonly string[] | undefined
}

// Built-in privacy taxonomy: a path segment of `external`, or any underscore-
// prefixed leaf/dir, is private regardless of dist. Configurable per package
// via ExportsConfig.privateSegments, adds exact segment names. The
// `_`-prefix rule is always on. Matched against a normalized (`/`) path.
const DEFAULT_PRIVATE_PATH_RE = /(?:\/|^)(?:_[^/]*|external)(?:$|\/)/

export function privatePathMatcher(
  privateSegments: readonly string[] = [],
): RegExp {
  if (!privateSegments.length) {
    return DEFAULT_PRIVATE_PATH_RE
  }
  // Sort the configured segments (ASCII) so the alternation is stable +
  // satisfies sort-regex-alternations, then OR them with the defaults.
  const extra = [...privateSegments]
    // oxlint-disable-next-line unicorn/no-array-sort -- the spread already copies `privateSegments`, no shared mutation; .toSorted() would trip socket/no-runtime-features-below-engine-floor in cascaded Node-18 repos.
    .sort()
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  return new RegExp(String.raw`(\/|^)(_[^/]*|${extra}|external)($|\/)`)
}

export function isPrivatePath(
  relPath: string,
  privateSegments?: readonly string[] | undefined,
): boolean {
  return privatePathMatcher(privateSegments).test(normalizePath(relPath))
}

// Built-in dev-junk ignore globs — never published, never exported.
export const DEFAULT_IGNORE_GLOBS: readonly string[] = [
  '**/.DS_Store',
  '**/.git/**',
  '**/coverage/**',
  '**/node_modules/**',
  '**/tmp/**',
  'scripts/**',
  'test/**',
  'tools/**',
  'vendor/**',
]

// Detect the full compound declaration extension so the public path strips
// `.d.ts` / `.d.mts` / `.d.cts` and the `types` condition points at it.
export function detectExt(p: string): string {
  if (p.endsWith('.d.ts')) {
    return '.d.ts'
  }
  if (p.endsWith('.d.mts')) {
    return '.d.mts'
  }
  if (p.endsWith('.d.cts')) {
    return '.d.cts'
  }
  return path.extname(p)
}

export function isDtsExt(ext: string): boolean {
  return ext === '.d.cts' || ext === '.d.mts' || ext === '.d.ts'
}

// Public import path for a published file: strip the outDir prefix, drop the
// extension, and collapse `index` to its directory ('.' at the root).
export function publicPathFor(relPath: string, outDir: string): string {
  const norm = normalizePath(relPath)
  const stripped =
    outDir && norm.startsWith(`${outDir}/`)
      ? norm.slice(outDir.length + 1)
      : norm
  const ext = detectExt(stripped)
  if (ext === '.json') {
    return `./${stripped}`
  }
  const basename = path.basename(stripped, ext)
  if (basename === 'index') {
    const dirname = path.dirname(stripped)
    return dirname === '.' ? '.' : `./${dirname}`
  }
  return `./${stripped.slice(0, -ext.length)}`
}

/**
 * Pure engine: build the `exports` map from a package's public file list.
 *
 * @param config Export-generation policy for this package.
 * @param publicFiles Published file paths relative to the package root (already
 *   filtered of private/ignored paths by the caller, OR filtered here
 *   defensively via {@link isPrivatePath}).
 * @param srcFiles Set of source files relative to `src/` (sans extension is
 *   resolved internally) used to emit the dev-only `source` condition.
 * @param declFiles Set of ALL published declaration files relative to the
 *   package root, globbed WITHOUT the config `ignore` globs, used to resolve a
 *   runtime entry's declaration twin into a `types` condition even when the
 *   config keeps that declaration from becoming an export entry of its own.
 */
export function buildExportsMap(
  config: ExportsConfig,
  publicFiles: readonly string[],
  srcFiles: ReadonlySet<string>,
  declFiles: ReadonlySet<string> = new Set(),
): Record<string, ExportConditions | string> {
  const { outDir } = config
  const map: Record<string, ExportConditions | string> = {}

  for (let i = 0, { length } = publicFiles; i < length; i += 1) {
    const rel = normalizePath(publicFiles[i]!)
    if (isPrivatePath(rel, config.privateSegments)) {
      continue
    }
    const ext = detectExt(rel)
    const publicPath = publicPathFor(rel, outDir)
    const filePath = `./${rel}`

    if (ext === '.json') {
      map[publicPath] = filePath
      continue
    }

    const isDts = isDtsExt(ext)
    const sourcePath = isDts
      ? undefined
      : resolveSourcePath(rel, outDir, srcFiles)

    const existing = map[publicPath]
    if (existing && typeof existing === 'object') {
      existing[isDts ? 'types' : 'default'] = filePath
      if (sourcePath && !existing.source) {
        existing.source = sourcePath
      }
      if (!isDts && !existing.types) {
        existing.types = resolveTypesPath(rel, declFiles)
      }
    } else {
      map[publicPath] = {
        source: sourcePath,
        // `types` MUST precede `default` — TypeScript matches export
        // conditions in declaration order, a trailing `types` never wins.
        types: isDts ? filePath : resolveTypesPath(rel, declFiles),
        default: isDts ? undefined : filePath,
      }
    }
  }

  applyBrowserConditions(map, config)
  applyAliases(map, config)
  return sortExportsMap(map)
}

// Shallow glob match used for browser-safe + ignore globs. `*` matches one
// path segment, `**` matches across `/`. A leading `./` is tolerated on both
// sides. The fleet's configs use shallow globs (`./arrays/**`, `**/browser`,
// `src/**`); full minimatch is overkill.
export function matchesGlob(target: string, pattern: string): boolean {
  const cleanTarget = target.replace(/^\.\//, '')
  const clean = pattern.replace(/^\.?\/?/, '')
  if (!clean.includes('*')) {
    return cleanTarget === clean || cleanTarget.startsWith(`${clean}/`)
  }
  const re = new RegExp(
    '^' +
      clean
        .replaceAll('.', '\\.')
        .replaceAll('**', '@@DS@@')
        .replaceAll('*', '[^/]*')
        .replaceAll('@@DS@@', '.*') +
      '$',
  )
  return re.test(cleanTarget)
}

// The `.browser.<ext>` build sibling of a runtime target: `./dist/index.js` →
// `./dist/index.browser.js`. Returns undefined when the target is not runtime
// JavaScript. General over the runtime extension (`.js` / `.mjs` / `.cjs`).
export function browserSiblingTarget(target: string): string | undefined {
  const match = /\.[cm]?js$/.exec(target)
  if (!match) {
    return undefined
  }
  const ext = match[0]
  return `${target.slice(0, -ext.length)}.browser${ext}`
}

// The export path whose runtime target is `siblingTarget`, so a matched entry's
// `.browser` build sibling can be consumed as an override instead of standing
// alone. Undefined when no entry resolves that file.
function browserSiblingEntry(
  map: Record<string, ExportConditions | string>,
  siblingTarget: string,
): string | undefined {
  for (const { 0: key, 1: value } of Object.entries(map)) {
    const target = typeof value === 'string' ? value : value.default
    if (target === siblingTarget) {
      return key
    }
  }
  return undefined
}

// Add a `browser` condition to two kinds of entry:
//   - OVERRIDE (automatic, needs NO glob): an entry whose `default` target has a
//     `.browser.<ext>` build sibling. The `browser` condition points at that
//     sibling and the sibling's own entry is consumed, never its own export.
//     Order: source?, types, browser, default — `types` precedes every runtime
//     condition so nodenext resolves types before the browser build. A sibling
//     override ALWAYS wins, whether or not a `browser` glob is configured.
//   - SELF-ROUTE (glob-driven): a sibling-LESS entry whose export path matches a
//     `browser` glob. The `browser` condition points at the SAME file, spliced
//     most-specific first (before `types`) as a nested conditions object, to
//     signal the entry is browser-safe.
// An entry with neither a build sibling nor a `browser` glob match is untouched.
export function applyBrowserConditions(
  map: Record<string, ExportConditions | string>,
  config: ExportsConfig,
): void {
  const browser = config.browser ?? []
  // Plan before mutating so a build sibling consumed as an override is neither
  // self-routed nor left as its own entry, whatever the map iteration order.
  const overrides = new Map<string, string>()
  const selfRoutes = new Set<string>()
  const consumed = new Set<string>()
  for (const { 0: exportPath, 1: value } of Object.entries(map)) {
    if (typeof value !== 'object' || value.browser) {
      continue
    }
    const siblingTarget = value.default
      ? browserSiblingTarget(value.default)
      : undefined
    const siblingPath = siblingTarget
      ? browserSiblingEntry(map, siblingTarget)
      : undefined
    if (
      siblingTarget !== undefined &&
      siblingPath !== undefined &&
      siblingPath !== exportPath
    ) {
      // Auto override — a build sibling exists; no glob required.
      overrides.set(exportPath, siblingTarget)
      consumed.add(siblingPath)
    } else if (browser.some(g => matchesGlob(exportPath, g))) {
      // No sibling, but a glob marks this leaf browser-safe → self-route.
      selfRoutes.add(exportPath)
    }
  }
  for (const exportPath of consumed) {
    delete map[exportPath]
    overrides.delete(exportPath)
    selfRoutes.delete(exportPath)
  }
  for (const { 0: exportPath, 1: siblingTarget } of overrides) {
    const value = map[exportPath] as ExportConditions
    const { default: def, source, types } = value
    map[exportPath] = { source, types, browser: siblingTarget, default: def }
  }
  for (const exportPath of selfRoutes) {
    const value = map[exportPath] as ExportConditions
    const { default: def, source, types } = value
    map[exportPath] = {
      source,
      browser: { types, default: def },
      types,
      default: def,
    }
  }
}

// Apply re-pointer aliases. An alias copies the target's value (or skips if the
// target is absent). Overwrites an existing self-resolving entry. When
// `browserTo` is set and resolves, splice a `browser` condition (pointing at
// that leaf's types/default) BEFORE the other conditions — the
// `./logger` → `./logger/browser` alternate-impl pattern, most-specific first.
export function applyAliases(
  map: Record<string, ExportConditions | string>,
  config: ExportsConfig,
): void {
  const aliases = config.aliases ?? []
  for (let i = 0, { length } = aliases; i < length; i += 1) {
    const { browserTo, from, to } = aliases[i]!
    const target = map[to]
    if (target === undefined) {
      continue
    }
    const browserTarget = browserTo ? map[browserTo] : undefined
    if (
      browserTarget &&
      typeof browserTarget === 'object' &&
      typeof target === 'object'
    ) {
      const { default: def, source, types } = target
      map[from] = {
        source,
        browser: { types: browserTarget.types, default: browserTarget.default },
        types,
        default: def,
      }
    } else {
      map[from] = target
    }
  }
}

// The Node builtin set the engine stubs in the browser field. Sourced from the
// running Node's `builtinModules` (authoritative + dependency-free) rather than
// a vendored list, so it tracks whatever the running Node actually reports —
// including legacy `_stream_*` / `_http_*` internals that `builtinModules`
// still lists; `buildBrowserField` stubs those bare-only (no `node:` twin,
// since they have no real `node:`-prefixed form).
export const NODE_BUILTINS: readonly string[] = builtinModules

/**
 * The block message when the running Node's MAJOR differs from the
 * `.node-version` pin, or undefined when they agree (or the pin is
 * unreadable — an absent pin is not a mismatch).
 *
 * `buildBrowserField` reads the RUNNING Node's `builtinModules`, so the
 * generated map is a function of whoever ran the build. Node 24 still reports
 * the legacy `_stream_*` aliases that 26 dropped, so a build off-pin writes six
 * stub keys CI never produces — and the committed manifest then disagrees with
 * the published tarball. Pre-approve verify catches it at the very end of a
 * release (staged vs local pack diverge on `package.json`); this catches it at
 * the write, which is where it is cheap to fix.
 *
 * Gated on MAJOR: builtins are added and removed across majors, while a patch
 * bump on the pin is routine and must not block a local regen.
 */
export function nodePinMismatchMessage(
  runningVersion: string,
  pinnedVersion: string | undefined,
): string | undefined {
  if (!pinnedVersion) {
    return undefined
  }
  // Numeric majors only. `.node-version` also accepts aliases (`lts/*`,
  // `stable`) that name no comparable major — those are not a mismatch, they
  // are simply not checkable.
  const majorOf = (v: string): number | undefined => {
    const match = /^v?(\d+)\./.exec(v.trim())
    return match ? Number(match[1]) : undefined
  }
  const running = majorOf(runningVersion)
  const pinned = majorOf(pinnedVersion)
  if (running === undefined || pinned === undefined || running === pinned) {
    return undefined
  }
  return (
    'gen/package-exports: refusing to write a runtime-derived browser map off-pin.\n' +
    `  What:  the browser field stubs the RUNNING Node's builtinModules, so it changes with the Node that runs this generator.\n` +
    `  Where: .node-version pins ${pinnedVersion}; this process is ${runningVersion}.\n` +
    `  Saw:   Node major ${running}; wanted major ${pinned}, the version CI builds and publishes with.\n` +
    `  Fix:   re-run on the pin (fnm use ${pinnedVersion} / nvm use ${pinnedVersion}), then regenerate.`
  )
}

/**
 * The `.node-version` pin at `repoRoot`, or undefined when it is absent or
 * unreadable — a repo without the pin file simply has nothing to check.
 */
export function readNodeVersionPin(repoRoot: string): string | undefined {
  try {
    const raw = readFileSync(path.join(repoRoot, '.node-version'), 'utf8')
    return raw.trim() || undefined
  } catch {
    return undefined
  }
}

// Build the top-level package.json `browser` field (each entry → false =
// empty-module stub). Three name shapes from `builtinModules`:
//   - already `node:`-prefixed (`node:sea`, `node:test`) — a node:-only module
//     with NO bare form: emit the prefixed key as-is, no bare twin.
//   - underscore-internal (`_http_agent`) — no real `node:` form: bare key only.
//   - normal (`fs`) — both the bare key AND its `node:`-prefixed twin.
// Defaults to the full Node builtin set (the engine owns it — a package opts in
// by declaring a `browser` surface, not by passing a list). Sorted (ASCII).
export function buildBrowserField(
  builtins: readonly string[] = NODE_BUILTINS,
): Record<string, false> {
  const out: Record<string, false> = {}
  for (let i = 0, { length } = builtins; i < length; i += 1) {
    const name = builtins[i]!
    out[name] = false
    if (!name.startsWith('_') && !name.startsWith('node:')) {
      out[`node:${name}`] = false
    }
  }
  return toSortedObject(out) as Record<string, false>
}

// Sort the exports map: `.` and `./index` first, then JSON last, the rest
// alphanumeric in between (ASCII byte order via toSortedObject).
export function sortExportsMap(
  map: Record<string, ExportConditions | string>,
): Record<string, ExportConditions | string> {
  const main: Record<string, ExportConditions | string> = {}
  const json: Record<string, ExportConditions | string> = {}
  const rest: Record<string, ExportConditions | string> = {}
  for (const { 0: key, 1: value } of Object.entries(map)) {
    if (key === '.' || key === './index') {
      main[key] = value
    } else if (key.endsWith('.json')) {
      json[key] = value
    } else {
      rest[key] = value
    }
  }
  const ordered: Record<string, ExportConditions | string> = {}
  if (main['.']) {
    ordered['.'] = main['.']
  }
  if (main['./index']) {
    ordered['./index'] = main['./index']
  }
  Object.assign(ordered, toSortedObject(rest), toSortedObject(json))
  return ordered
}

// ── CLI ───────────────────────────────────────────────────────────────────

export async function readJson(
  filePath: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<
    string,
    unknown
  >
}

export async function writePackageJson(
  filePath: string,
  data: Record<string, unknown>,
): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export interface ExportsConfigModule {
  readonly config: ExportsConfig
  readonly packageDir?: string | undefined
}

export async function runGenerator(): Promise<void> {
  // A package opts in by shipping `scripts/repo/package-exports.config.mts`
  // (resolved relative to REPO_ROOT, not process.cwd() — scripts may be invoked
  // from any directory) with a default export of `{ config, packageDir? }`.
  // Absent config = this package does not generate exports, the no-op opt-out.
  const configPath = path.join(
    REPO_ROOT,
    'scripts/repo/package-exports.config.mts',
  )
  let mod: ExportsConfigModule | undefined
  try {
    mod = (await import(configPath)) as unknown as ExportsConfigModule
  } catch {
    logger.log(
      'gen/package-exports: no scripts/repo/package-exports.config.mts — package does not opt into exports generation; nothing to do.',
    )
    return
  }
  const { config } = mod
  const packageDir = mod.packageDir ?? REPO_ROOT
  const pkgJsonPath = path.join(packageDir, 'package.json')
  const pkgJson = await readJson(pkgJsonPath)

  const fileGlobs = config.files ?? [
    `${config.outDir ? `${config.outDir}/` : ''}**/*.{cjs,js,mjs,json,d.ts,d.mts,d.cts}`,
  ]
  const ignore = [...DEFAULT_IGNORE_GLOBS, ...(config.ignore ?? [])]
  const publicFiles = await glob([...fileGlobs], {
    cwd: packageDir,
    ignore,
  })

  const srcRoot = path.join(packageDir, 'src')
  const srcFiles = new Set<string>(
    await glob(['**/*.{ts,mts,cts}'], {
      cwd: srcRoot,
      ignore: ['**/*.d.ts', 'external/**'],
    }),
  )

  // Every published declaration file, globbed WITHOUT the config `ignore`
  // globs, so `types` twins resolve even for configs that keep declarations
  // from becoming export entries of their own.
  const declFiles = new Set<string>(
    await glob(
      [`${config.outDir ? `${config.outDir}/` : ''}**/*.{d.ts,d.mts,d.cts}`],
      { cwd: packageDir, ignore: [...DEFAULT_IGNORE_GLOBS] },
    ),
  )

  const exports = buildExportsMap(config, publicFiles, srcFiles, declFiles)
  pkgJson['exports'] = exports
  // A declared browser-safe surface implies the package targets the browser, so
  // a downstream browser bundle will traverse its `node:*` imports — stub every
  // Node builtin to an empty module. Inferred, not configured: the engine owns
  // the builtin list. The field is REPLACED, not merged: it is wholly the
  // builtin-stub map, so regeneration is idempotent and never accumulates stale
  // keys (a merge would preserve cruft from an earlier buggy run — e.g. dead
  // `_stream_*` stubs or `node:node:` doubles). A package needing a hand-pinned
  // browser shim should express it as an exports `browser` condition, not here.
  if (config.browser?.length) {
    const mismatch = nodePinMismatchMessage(
      process.version,
      readNodeVersionPin(REPO_ROOT),
    )
    if (mismatch) {
      throw new Error(mismatch)
    }
    pkgJson['browser'] = buildBrowserField()
  }
  if (config.nodeRange) {
    const engines = (pkgJson['engines'] as Record<string, unknown>) ?? {}
    pkgJson['engines'] = { ...engines, node: config.nodeRange }
  }
  await writePackageJson(pkgJsonPath, pkgJson)
  const count = Object.keys(exports).length
  logger.success(
    `gen/package-exports: wrote ${count} export entr${count === 1 ? 'y' : 'ies'} to ${normalizePath(path.relative(REPO_ROOT, pkgJsonPath))}`,
  )
}

const SCRIPT_META: ScriptMeta = {
  describe:
    "generate a package.json exports map from a publishable package's public file surface",
  help: 'Usage: node scripts/fleet/gen/package-exports.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(runGenerator, SCRIPT_META)
}
