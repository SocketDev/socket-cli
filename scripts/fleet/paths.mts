/* oxlint-disable socket/sort-source-methods -- ordered as path resolution flow (resolver → primary roots → derived constants → helpers); alphabetizing would scatter the flow. */
/**
 * @file Canonical path constants + resolvers for this package. Mantra: 1 path,
 *   1 reference. Every path the scripts in this directory need — config files,
 *   lockfiles, build outputs, cache dirs, manifest files — gets constructed
 *   exactly once here. Every consumer imports the constructed value. A future
 *   rename or relocation is a one-file edit; consumers don't have to be
 *   re-audited. Per-package, like package.json: every package that has its own
 *   `scripts/` directory has its own `paths.mts`. A sub-package can inherit
 *   from a parent's paths.mts by re-exporting: // packages/foo/bar/paths.mts
 *   export * from '../../../scripts/fleet/paths.mts' // Add
 *   sub-package-specific overrides below the export line. export const
 *   FOO_BAR_DIST = path.join(REPO_ROOT, 'packages', 'foo', 'bar', 'dist')
 *   Consumers resolve `paths.mts` the same way Node resolves `package.json` —
 *   relative to the importing file's location, with `..`-walks finding the
 *   nearest one. Two flavors of path live in this file:
 *
 *   1. STATIC CONSTANTS — paths that don't depend on runtime input. Example:
 *      `REPO_ROOT`, `CONFIG_DIR`, `NODE_MODULES_CACHE_DIR`. Importable as-is.
 *   2. RESOLVER FUNCTIONS — paths that need a search (multiple accepted locations)
 *      or runtime input (a target directory, a package name). Example:
 *      `findSocketWheelhouseConfig(repoRoot)` returns the first of
 *      `.config/socket-wheelhouse.json` or `.socket-wheelhouse.json` that
 *      exists. Resolution from script call sites: every script anchors on its
 *      own location via `fileURLToPath(import.meta.url)`, then walks up to the
 *      package.json-bearing ancestor. `process.cwd()` is forbidden in scripts/
 *      per fleet rule (the user / Claude Code may invoke from any subdir).
 *
 * @see The fleet rule: CLAUDE.md "1 path, 1 reference" and the
 *   `socket/no-process-cwd-in-scripts-hooks` oxlint rule.
 */

import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// REPO-ROOT resolver — used to anchor every other path.
// ---------------------------------------------------------------------------

/**
 * Walk up from this module's own location to find the repo root — the nearest
 * ancestor that has a `package.json`. Cached per-process since the answer
 * doesn't change at runtime.
 *
 * @throws If no package.json ancestor exists (= we're not in a repo).
 */
export function resolveRepoRoot(): string {
  let cur = path.dirname(fileURLToPath(import.meta.url))
  const root = path.parse(cur).root
  while (cur && cur !== root) {
    if (existsSync(path.join(cur, 'package.json'))) {
      return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) {
      break
    }
    cur = parent
  }
  throw new Error(
    `Could not resolve repo root from ${fileURLToPath(import.meta.url)} ` +
      '(no ancestor has package.json).',
  )
}

/**
 * Absolute path to the repo root (nearest `package.json` ancestor).
 */
export const REPO_ROOT = resolveRepoRoot()

// ---------------------------------------------------------------------------
// Static directory + file constants.
// ---------------------------------------------------------------------------

/**
 * Absolute path to the repo's `.config/` directory.
 */
export const CONFIG_DIR = path.join(REPO_ROOT, '.config')

/**
 * Segregated `.config/` subtrees: `fleet/` holds fleet-identical cascaded
 * config, `repo/` holds repo-owned config. No loose files sit in `.config/`.
 */
export const CONFIG_FLEET_DIR = path.join(CONFIG_DIR, 'fleet')
export const CONFIG_REPO_DIR = path.join(CONFIG_DIR, 'repo')

/**
 * The lockstep schema is fleet-identical, so it lives under `.config/fleet/`;
 * `pnpm run lockstep:emit-schema` regenerates it here from the TypeBox source.
 */
export const LOCKSTEP_SCHEMA = path.join(
  CONFIG_FLEET_DIR,
  'lockstep.schema.json',
)

/**
 * The repo-owned location of a segregated `.config/` config file:
 * `.config/repo/<file>`. ONE source of this path (1 path, 1 reference) — every
 * scripts-tier resolver derives from it.
 */
export function segregatedConfigPath(repoRoot: string, file: string): string {
  return path.join(repoRoot, '.config', 'repo', file)
}

/**
 * Lockstep-manifest candidates for a repo root, most-preferred first: a root
 * `lockstep.json` (shim layout) wins, then the segregated repo-owned manifest.
 */
export function lockstepManifestCandidates(repoRoot: string): string[] {
  return [
    path.join(repoRoot, 'lockstep.json'),
    segregatedConfigPath(repoRoot, 'lockstep.json'),
  ]
}

/**
 * Absolute path to the repo's `node_modules/` directory.
 */
export const NODE_MODULES_DIR = path.join(REPO_ROOT, 'node_modules')

/**
 * Absolute path to the repo's tool-cache root. Fleet convention: every
 * per-repo tool cache lives under here (vitest, taze, our own audit caches,
 * etc.). Auto-gitignored via the fleet's `**∕.cache/` rule. Build tools also
 * write here (oxlint, etc.). Segmented into `fleet/` + `repo/` below.
 */
// oxlint-disable-next-line socket/prefer-node-modules-dot-cache -- NODE_MODULES_DIR is the canonical node_modules root; the rule's per-arg check can't see through identifiers.
export const NODE_MODULES_CACHE_DIR = path.join(NODE_MODULES_DIR, '.cache')

/**
 * Fleet-owned tool-cache segment: fleet-managed caches (coverage, hooks,
 * snapshots, etc.) live under here — mirroring the `.claude/hooks/{fleet,repo}`
 * / `.github/actions/{fleet,repo}` segmentation.
 */
export const FLEET_CACHE_DIR = path.join(NODE_MODULES_CACHE_DIR, 'fleet')

/**
 * Repo-owned tool-cache segment: caches specific to THIS repo (not fleet
 * tooling) live under here.
 */
export const REPO_CACHE_DIR = path.join(NODE_MODULES_CACHE_DIR, 'repo')

/**
 * Single coverage home. Every tier's report is persisted here as one distinctly
 * named FLAT file — never a per-tier subdir. vitest/c8 reporters emit a fixed
 * `coverage-final.json` and `clean: true` wipes the whole reportsDirectory, so
 * each tier reports into the throwaway `COVERAGE_SCRATCH_DIR` and the runner
 * renames the result to its flat name here. The merge writes the combined
 * `coverage-final.json` + `coverage-summary.json` at this root — the badge +
 * release gate read the summary from here. The only files under here are the
 * flat `*.json`; raw dumps + scratch live in `COVERAGE_SCRATCH_DIR` (tmp).
 */
export const COVERAGE_DIR = path.join(FLEET_CACHE_DIR, 'coverage')

/**
 * Per-tier istanbul final reports — flat files in COVERAGE_DIR. The runner
 * moves each tier's scratch `coverage-final.json` out to its named path here;
 * the merge reads them back and folds them.
 */
export const COVERAGE_FINAL_MAIN_PATH = path.join(
  COVERAGE_DIR,
  'coverage-final.main.json',
)
export const COVERAGE_FINAL_ISOLATED_PATH = path.join(
  COVERAGE_DIR,
  'coverage-final.isolated.json',
)
export const COVERAGE_FINAL_ENFORCERS_PATH = path.join(
  COVERAGE_DIR,
  'coverage-final.enforcers.json',
)
export const COVERAGE_FINAL_CHILDREN_PATH = path.join(
  COVERAGE_DIR,
  'coverage-final.children.json',
)

/**
 * The merged istanbul final report the coverage runner writes after folding
 * every tier (main + isolated + enforcers + children) together.
 */
export const COVERAGE_FINAL_PATH = path.join(
  COVERAGE_DIR,
  'coverage-final.json',
)

/**
 * The json-summary the badge + release-check read (line/branch/etc. totals).
 */
export const COVERAGE_SUMMARY_PATH = path.join(
  COVERAGE_DIR,
  'coverage-summary.json',
)

/**
 * Transient coverage scratch — OUTSIDE the coverage home so raw V8 dumps and
 * each tier's throwaway `coverage-final.json` never clutter COVERAGE_DIR. Lives
 * in the OS temp dir and is wiped per run. `os` is a node builtin so paths.mts
 * stays import-safe for the rolldown loader.
 */
export const COVERAGE_SCRATCH_DIR = path.join(
  os.tmpdir(),
  'fleet-coverage-scratch',
)

/**
 * Throwaway reportsDirectory for the vitest tiers (main / isolated). A
 * dedicated subdir — NOT the scratch root — so a tier's `clean: true` wipes
 * only its own report and never the sibling `children-raw` (the raw V8 dumps
 * must survive across the sequential main + isolated runs). The runner renames
 * the `coverage-final.json` here out to the flat per-tier path after each run.
 */
export const COVERAGE_SCRATCH_VITEST_DIR = path.join(
  COVERAGE_SCRATCH_DIR,
  'vitest',
)

/**
 * Absolute path to the raw child-profile subdir the runner sets as
 * `FLEET_CHILD_V8_COVERAGE_DIR` — under the transient scratch, never
 * COVERAGE_DIR.
 */
export const COVERAGE_CHILDREN_RAW_DIR = path.join(
  COVERAGE_SCRATCH_DIR,
  'children-raw',
)

// ---------------------------------------------------------------------------
// Fleet hook dispatch bundle — sources + the rolldown output. Constructed here
// (1 path, 1 reference) so gen/hook-dispatch, build-hook-bundle, and the
// rolldown hook-bundle config all REFERENCE these instead of reconstructing
// them. paths.mts stays light (node: only) so the rolldown config loader can
// import it.
// ---------------------------------------------------------------------------

/**
 * Absolute path to the repo's `.claude/settings.json` (the fleet hook wiring:
 * the dispatcher matcher entries + standalone per-hook entries).
 */
export const CLAUDE_SETTINGS_JSON = path.join(
  REPO_ROOT,
  '.claude',
  'settings.json',
)

/**
 * Absolute path to the fleet hooks directory.
 */
export const FLEET_HOOKS_DIR = path.join(REPO_ROOT, '.claude', 'hooks', 'fleet')

/**
 * Dispatcher BUILD-INPUT directory: the dispatcher source, entry shims, and
 * generated tables. Built artifacts land in `DIST_DIR`; the hand-written
 * loader sits at `FLEET_HOOK_INDEX_PATH` above both.
 */
export const DISPATCH_DIR = path.join(FLEET_HOOKS_DIR, '_dispatch')

/**
 * Built hook artifacts (rolldown output). This dir plus the loader is the
 * ENTIRE hook payload a member receives: `.claude/hooks/fleet/index.cjs` +
 * `.claude/hooks/fleet/_dist/bundle.cjs`. Underscore-prefixed so the hook-dir
 * scanners skip it, like `_shared/` and `_dispatch/`.
 */
export const DIST_DIR = path.join(FLEET_HOOKS_DIR, '_dist')

/**
 * The hand-written CJS loader — the one path settings.json ever names. Lives
 * ABOVE `_dist/` because it is authored, not built: `_dist/` holds exclusively
 * build output.
 */
export const FLEET_HOOK_INDEX_PATH = path.join(FLEET_HOOKS_DIR, 'index.cjs')

/**
 * The generated static dispatch table (gen/hook-dispatch writes this).
 */
export const DISPATCH_TABLE_PATH = path.join(DISPATCH_DIR, 'dispatch-table.mts')
// Snapshot split: the snapshot bundle freezes only marker-free hooks (the
// safe table); hooks tagged `@dispatch-snapshot-exclude` land in the excluded
// table, bundled separately and spliced in at runtime by deserialize-main.
export const DISPATCH_TABLE_SNAPSHOT_PATH = path.join(
  DISPATCH_DIR,
  'dispatch-table-snapshot.mts',
)
export const DISPATCH_TABLE_EXCLUDED_PATH = path.join(
  DISPATCH_DIR,
  'dispatch-table-excluded.mts',
)
// Snapshot-experiment artifact (spliced in by the V8 deserialize path only —
// the full `bundle.cjs` already carries every hook). Wheelhouse-only, never
// shipped, so it stays beside its tables in `_dispatch/`.
export const EXCLUDED_BUNDLE_PATH = path.join(
  DISPATCH_DIR,
  'excluded-bundle.cjs',
)

/**
 * The GENERATED dispatch manifest the dep-0 bootstrap dispatcher
 * (`_shared/dispatch.mts`) routes off. Emitted by gen/hook-dispatch alongside
 * the dispatch tables — never hand-maintained. Lives in `_shared/` (not
 * `_dispatch/`) because the bootstrap runtime path reads it directly.
 */
export const DISPATCH_MANIFEST_PATH = path.join(
  FLEET_HOOKS_DIR,
  '_shared',
  'dispatch-manifest.json',
)

/**
 * The dispatcher entry that rolldown bundles.
 */
export const DISPATCH_ENTRY_PATH = path.join(DISPATCH_DIR, 'dispatch-entry.mts')

/**
 * The CJS hook bundle (rolldown output; release-shipped, gitignored).
 */
export const HOOK_BUNDLE_PATH = path.join(DIST_DIR, 'bundle.cjs')

/**
 * The fleet oxlint plugin source dir + its rolldown-bundled artifact. Members
 * load the bundle via `jsPlugins`; the wheelhouse edits + tests the source and
 * builds the bundle from it (scripts/fleet/build-oxlint-bundle.mts). The bundle
 * is release-only (gitignored, never committed) like the hook bundle above.
 */
export const OXLINT_PLUGIN_DIR = path.join(
  REPO_ROOT,
  '.config',
  'fleet',
  'oxlint-plugin',
)
export const OXLINT_PLUGIN_SOURCE_ENTRY = path.join(
  OXLINT_PLUGIN_DIR,
  'index.mts',
)
export const OXLINT_PLUGIN_BUNDLE_PATH = path.join(
  REPO_ROOT,
  '.config',
  'fleet',
  'oxlint-plugin.mjs',
)

/**
 * Resolve the rolldown output path for the hook bundle. `FLEET_HOOK_BUNDLE_OUT`
 * overrides it so the bundle-freshness test can build into an isolated
 * `os.tmpdir` and diff against the committed artifact without touching it.
 */
export function resolveHookBundleOut(): string {
  const override = process.env['FLEET_HOOK_BUNDLE_OUT']
  return override ? path.resolve(override) : HOOK_BUNDLE_PATH
}

/**
 * Absolute path to the repo's `pnpm-workspace.yaml`.
 */
export const PNPM_WORKSPACE_YAML = path.join(REPO_ROOT, 'pnpm-workspace.yaml')

/**
 * Absolute path to the cascaded fleet catalog — the fleet-canonical `catalog:`
 * slice every member carries. The `.fleet` infix keeps it from colliding with
 * the real `pnpm-workspace.yaml` (see the file's own header).
 */
export const FLEET_CATALOG_YAML = path.join(
  CONFIG_DIR,
  'fleet',
  'pnpm-workspace.fleet.yaml',
)

/**
 * Absolute path to the repo's `package.json`.
 */
export const PACKAGE_JSON = path.join(REPO_ROOT, 'package.json')

/**
 * Absolute path to the repo's `pnpm-lock.yaml`.
 */
export const PNPM_LOCK = path.join(REPO_ROOT, 'pnpm-lock.yaml')

/**
 * Absolute path to the script-only check tsconfig (`tsc -p`'d directly by the
 * check step, never editor/language-server discovered — that's the root
 * `tsconfig.json`'s job). Lives at `.config/fleet/`, not the repo root.
 */
export const TSCONFIG_CHECK_PATH = path.join(
  CONFIG_DIR,
  'fleet',
  'tsconfig.check.json',
)

/**
 * The repo-tier test tree. Wheelhouse-only hook / lint-rule / git-hook tests
 * live under `test/repo/{unit,integration,e2e}/` (vitest), never co-located in
 * the cascaded trees. See docs/agents.md/fleet/test-layout.md.
 */
export const TEST_REPO_DIR = path.join(REPO_ROOT, 'test', 'repo')

/**
 * Both relocated homes a lint-rule test may live in (unit for in-process,
 * integration for spawn-based). The oxlint-rule triad check looks here.
 */
export const LINT_RULE_TEST_DIRS: readonly string[] = [
  path.join(TEST_REPO_DIR, 'unit', 'lint-rules'),
  path.join(TEST_REPO_DIR, 'integration', 'lint-rules'),
]

/**
 * Both relocated homes a hook test may live in (unit for in-process,
 * integration for spawn-based). `hooks-shared` holds the `_shared/` helper
 * tests.
 */
export const HOOK_TEST_DIRS: readonly string[] = [
  path.join(TEST_REPO_DIR, 'integration', 'hooks'),
  path.join(TEST_REPO_DIR, 'integration', 'hooks-shared'),
  path.join(TEST_REPO_DIR, 'unit', 'hooks'),
  path.join(TEST_REPO_DIR, 'unit', 'hooks-shared'),
]

/**
 * Both relocated homes a git-hook test may live in.
 */
export const GIT_HOOK_TEST_DIRS: readonly string[] = [
  path.join(TEST_REPO_DIR, 'integration', 'git-hooks'),
  path.join(TEST_REPO_DIR, 'unit', 'git-hooks'),
]

/**
 * True only in the wheelhouse, which OWNS the relocated tests under
 * `test/repo/`. A member repo ships the rule/hook SOURCES but not their tests
 * (wheelhouse-only) — so test-presence assertions must gate on this and pass
 * (return no gaps) in a member. The wheelhouse is the repo carrying
 * `template/base/`.
 */
export const OWNS_RELOCATED_TESTS = existsSync(
  path.join(REPO_ROOT, 'template', 'base'),
)

// ---------------------------------------------------------------------------
// socket-wheelhouse.json resolver.
//
// Two locations are accepted (matches the rest of the fleet's
// resolution shape — see `scripts/socket-wheelhouse-schema.mts` for
// the TypeBox schema, and `scripts/sync-scaffolding/socket-wheelhouse-
// config.mts` for the wheelhouse-side validator):
//
//   1. `.config/socket-wheelhouse.json` (primary; lives next to other
//      tooling configs)
//   2. `.socket-wheelhouse.json` at repo root (legacy; useful for
//      repos that prefer root-level dotfile discovery)
//
// The primary path wins when both exist; the loader emits a stderr
// note so a stray duplicate is visible. Neither is deprecated.
//
// This module deliberately does NOT validate the schema beyond
// "valid JSON object" — schema validation lives in the wheelhouse-
// side helper. Downstream consumers typically just need to read a
// single field (e.g. `github.apps`) and don't want the cost of a
// full TypeBox validate-pass on every audit.
// ---------------------------------------------------------------------------

// Accepted locations, in priority order. `.config/repo/` (repo tier — sits with
// the other per-repo configs) is preferred; `.config/` and the repo-root dotfile
// remain valid so existing repos resolve unchanged. First existing wins.
export interface SocketWheelhouseConfigLocation {
  /**
   * Absolute path to the config that was read
   * (`.config/repo/socket-wheelhouse.json`).
   */
  readonly path: string
}

export interface LoadedSocketWheelhouseConfig {
  readonly location: SocketWheelhouseConfigLocation
  /**
   * Parsed JSON root. Always an object; non-object payloads cause `undefined`.
   */
  readonly value: Record<string, unknown>
}

/**
 * Find the socket-wheelhouse.json under `repoRoot` (defaults to the current
 * repo's root). Returns the first matching location, or `undefined` if neither
 * file exists. When both exist, emits a stderr warning + returns the primary
 * location.
 */
export function findSocketWheelhouseConfig(
  repoRoot: string = REPO_ROOT,
): SocketWheelhouseConfigLocation | undefined {
  const abs = segregatedConfigPath(repoRoot, 'socket-wheelhouse.json')
  return existsSync(abs) ? { path: abs } : undefined
}

/**
 * Load + parse the socket-wheelhouse.json under `repoRoot` (defaults to the
 * current repo's root). Returns `undefined` on absent / unreadable /
 * unparseable / non-object root — every failure shape collapses to "no config"
 * since downstream audits should fail-open when the config is unavailable.
 */
export function loadSocketWheelhouseConfig(
  repoRoot: string = REPO_ROOT,
): LoadedSocketWheelhouseConfig | undefined {
  const location = findSocketWheelhouseConfig(repoRoot)
  if (!location) {
    return undefined
  }
  let raw: string
  try {
    raw = readFileSync(location.path, 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined
  }
  return {
    location,
    value: parsed as Record<string, unknown>,
  }
}
