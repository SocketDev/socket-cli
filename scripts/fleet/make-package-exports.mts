/**
 * @file Generate a package.json `exports` map from a publishable package's
 *   public file surface. Opt-in per package (a package supplies a config); the
 *   guiding question is "when we publish to npm, what do we want a consumer to
 *   import?". One generator handles both dist-based packages (output under
 *   `dist/`) and packages whose published files sit at the package root.
 *
 *   Privacy taxonomy (applied regardless of `dist/`): a file is PRIVATE — never
 *   exported — when its path contains an `external/` segment, an underscore-
 *   prefixed leaf (`_foo.js`) or directory (`_internal/`), or matches a
 *   config `ignore` glob (src/scripts/test/tools/vendor by default). Everything
 *   else is the public surface and earns an `exports` entry.
 *
 *   The deterministic core (`buildExportsMap`) is a pure function over a file
 *   list so it is unit-testable without a real build. The CLI wrapper globs the
 *   package, calls the engine, and writes package.json. Validation that the map
 *   and the on-disk public files agree lives in the companion check
 *   `scripts/fleet/check/public-files-are-exported.mts`.
 */

import { promises as fs } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { toSortedObject } from '@socketsecurity/lib-stable/objects/sort'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

// A single export condition target (a file path) keyed by condition name.
// `source` (dev: resolve to TS src for coverage), `browser`, `types`, and
// `default` are the conditions the engine emits. Order is significant in the
// emitted object — most-specific first — so consumers/bundlers match correctly.
export interface ExportConditions {
  source?: string | undefined
  browser?: ExportConditions | undefined
  types?: string | undefined
  default?: string | undefined
}

// One alias entry: a public subpath that re-points at the canonical target's
// value (no source file behind it). Used for fleet-compat barrels.
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
  // `files` — globs (relative to the package) of candidate published files;
  // produces both the export surface and the `files[]` allowlist. Defaults to
  // every JS/JSON/d.ts under outDir.
  readonly files?: readonly string[] | undefined
  // `ignore` — exclusion globs on top of the built-in privacy taxonomy.
  readonly ignore?: readonly string[] | undefined
  // `browser` — glob patterns (matched against the post-strip export path)
  // whose leaves are browser-safe; each gets a self-routing `browser` condition
  // in `exports`. Covers a subtree (`./arrays/**`) or a browser-impl leaf
  // (`**/browser`). Declaring ANY browser-safe surface ALSO triggers the
  // top-level package.json `browser` field: the engine infers it, stubbing
  // every Node builtin (from `node:module`'s `builtinModules`) to `false` —
  // bare key + `node:`-prefixed twin — so a downstream browser bundle gets an
  // empty stub instead of a hard build error on a `node:*` import reachable
  // from a browser-safe entry. No explicit builtin list: the engine owns it.
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
// via ExportsConfig.privateSegments (adds exact segment names). The
// `_`-prefix rule is always on. Matched against a normalized (`/`) path.
const DEFAULT_PRIVATE_PATH_RE = /(\/|^)(_[^/]*|external)($|\/)/

export function privatePathMatcher(
  privateSegments: readonly string[] = [],
): RegExp {
  if (!privateSegments.length) {
    return DEFAULT_PRIVATE_PATH_RE
  }
  // Sort the configured segments (ASCII) so the alternation is stable +
  // satisfies sort-regex-alternations, then OR them with the defaults.
  const extra = [...privateSegments]
    .toSorted()
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
 * @param config     export-generation policy for this package.
 * @param publicFiles published file paths relative to the package root
 *   (already filtered of private/ignored paths by the caller, OR filtered here
 *   defensively via {@link isPrivatePath}).
 * @param srcFiles   set of source files relative to `src/` (sans extension is
 *   resolved internally) used to emit the dev-only `source` condition.
 */
export function buildExportsMap(
  config: ExportsConfig,
  publicFiles: readonly string[],
  srcFiles: ReadonlySet<string>,
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
    } else {
      map[publicPath] = {
        source: sourcePath,
        types: isDts ? filePath : undefined,
        default: isDts ? undefined : filePath,
      }
    }
  }

  applyBrowserConditions(map, config)
  applyAliases(map, config)
  return sortExportsMap(map)
}

// Resolve a `src/<path>.{ts,mts,cts}` twin for the dev `source` condition.
// Only when the file is a dist build artifact with a real source behind it.
export function resolveSourcePath(
  rel: string,
  outDir: string,
  srcFiles: ReadonlySet<string>,
): string | undefined {
  if (!outDir || !rel.startsWith(`${outDir}/`)) {
    return undefined
  }
  const ext = detectExt(rel)
  const distRel = rel.slice(outDir.length + 1).slice(0, -ext.length)
  for (const candidate of [`${distRel}.ts`, `${distRel}.mts`, `${distRel}.cts`]) {
    if (srcFiles.has(candidate)) {
      return `./src/${candidate}`
    }
  }
  return undefined
}

// Shallow glob match used for browser-safe + ignore globs. `*` matches one
// path segment, `**` matches across `/`. A leading `./` is tolerated on both
// sides. The fleet's configs use shallow globs (`./arrays/**`, `**/browser`,
// `src/**`); full minimatch is overkill.
export function matchesGlob(target: string, glob: string): boolean {
  const cleanTarget = target.replace(/^\.\//, '')
  const clean = glob.replace(/^\.?\/?/, '')
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

// Splice a `browser` condition (pointing at the same target) BEFORE the other
// conditions for browser-safe leaves — signals the entry is browser-safe. A
// leaf qualifies when its export path matches any `browser` glob.
export function applyBrowserConditions(
  map: Record<string, ExportConditions | string>,
  config: ExportsConfig,
): void {
  const browser = config.browser ?? []
  if (!browser.length) {
    return
  }
  for (const { 0: exportPath, 1: value } of Object.entries(map)) {
    if (typeof value !== 'object') {
      continue
    }
    if (!browser.some(g => matchesGlob(exportPath, g))) {
      continue
    }
    if (value.browser) {
      continue
    }
    const { source, types, default: def } = value
    const next: ExportConditions = {
      source,
      browser: { types, default: def },
      types,
      default: def,
    }
    map[exportPath] = next
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
// a vendored list. Deprecated `_stream_*` ghosts that aren't importable in
// modern Node are correctly absent.
export const NODE_BUILTINS: readonly string[] = builtinModules

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

export async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>
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

async function runGenerator(): Promise<void> {
  // A package opts in by shipping `scripts/repo/package-exports.config.mts`
  // (resolved relative to REPO_ROOT, not process.cwd() — scripts may be invoked
  // from any directory) with a default export of `{ config, packageDir? }`.
  // Absent config = this package does not generate exports (the no-op opt-out).
  const fastGlob = (await import('fast-glob')).default
  const configPath = path.join(
    REPO_ROOT,
    'scripts/repo/package-exports.config.mts',
  )
  let mod: ExportsConfigModule | undefined
  try {
    mod = (await import(configPath)) as unknown as ExportsConfigModule
  } catch {
    logger.log(
      'make-package-exports: no scripts/repo/package-exports.config.mts — package does not opt into exports generation; nothing to do.',
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
  const publicFiles = await fastGlob.glob([...fileGlobs], {
    cwd: packageDir,
    ignore,
    gitignore: false,
  })

  const srcRoot = path.join(packageDir, 'src')
  const srcFiles = new Set<string>(
    await fastGlob.glob(['**/*.{ts,mts,cts}'], {
      cwd: srcRoot,
      ignore: ['**/*.d.ts', 'external/**'],
      gitignore: false,
    }),
  )

  const exports = buildExportsMap(config, publicFiles, srcFiles)
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
    pkgJson['browser'] = buildBrowserField()
  }
  if (config.nodeRange) {
    const engines = (pkgJson['engines'] as Record<string, unknown>) ?? {}
    pkgJson['engines'] = { ...engines, node: config.nodeRange }
  }
  await writePackageJson(pkgJsonPath, pkgJson)
  const count = Object.keys(exports).length
  logger.success(
    `make-package-exports: wrote ${count} export entr${count === 1 ? 'y' : 'ies'} to ${normalizePath(path.relative(REPO_ROOT, pkgJsonPath))}`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void (async () => {
    try {
      await runGenerator()
    } catch (e) {
      logger.error(errorMessage(e))
      process.exitCode = 1
    }
  })()
}
