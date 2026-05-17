/* oxlint-disable socket/sort-source-methods -- ordered as path resolution flow (resolver → primary roots → derived constants → helpers); alphabetizing would scatter the flow. */
/**
 * @fileoverview Canonical path constants + resolvers for this package.
 *
 * Mantra: 1 path, 1 reference. Every path the scripts in this
 * directory need — config files, lockfiles, build outputs, cache
 * dirs, manifest files — gets constructed exactly once here. Every
 * consumer imports the constructed value. A future rename or
 * relocation is a one-file edit; consumers don't have to be
 * re-audited.
 *
 * Per-package, like package.json: every package that has its own
 * `scripts/` directory has its own `paths.mts`. A sub-package can
 * inherit from a parent's paths.mts by re-exporting:
 *
 *   // packages/foo/bar/paths.mts
 *   export * from '../../../scripts/paths.mts'
 *   // Add sub-package-specific overrides below the export line.
 *   export const FOO_BAR_DIST = path.join(REPO_ROOT, 'packages', 'foo', 'bar', 'dist')
 *
 * Consumers resolve `paths.mts` the same way Node resolves
 * `package.json` — relative to the importing file's location, with
 * `..`-walks finding the nearest one.
 *
 * Two flavors of path live in this file:
 *
 *   1. STATIC CONSTANTS — paths that don't depend on runtime input.
 *      Example: `REPO_ROOT`, `CONFIG_DIR`, `NODE_MODULES_CACHE_DIR`.
 *      Importable as-is.
 *
 *   2. RESOLVER FUNCTIONS — paths that need a search (multiple
 *      accepted locations) or runtime input (a target directory, a
 *      package name). Example: `findSocketWheelhouseConfig(repoRoot)`
 *      returns the first of `.config/socket-wheelhouse.json` or
 *      `.socket-wheelhouse.json` that exists.
 *
 * Resolution from script call sites: every script anchors on its own
 * location via `fileURLToPath(import.meta.url)`, then walks up to the
 * package.json-bearing ancestor. `process.cwd()` is forbidden in
 * scripts/ per fleet rule (the user / Claude Code may invoke from
 * any subdir).
 *
 * @see The fleet rule: CLAUDE.md "1 path, 1 reference" and the
 *   `socket/no-process-cwd-in-scripts-hooks` oxlint rule.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// REPO-ROOT resolver — used to anchor every other path.
// ---------------------------------------------------------------------------

/**
 * Walk up from this module's own location to find the repo root —
 * the nearest ancestor that has a `package.json`. Cached per-process
 * since the answer doesn't change at runtime.
 *
 * @throws if no package.json ancestor exists (= we're not in a repo).
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

/** Absolute path to the repo root (nearest `package.json` ancestor). */
export const REPO_ROOT = resolveRepoRoot()

// ---------------------------------------------------------------------------
// Static directory + file constants.
// ---------------------------------------------------------------------------

/** Absolute path to the repo's `.config/` directory. */
export const CONFIG_DIR = path.join(REPO_ROOT, '.config')

/** Absolute path to the repo's `node_modules/` directory. */
export const NODE_MODULES_DIR = path.join(REPO_ROOT, 'node_modules')

/**
 * Absolute path to the repo's tool-cache directory. Fleet convention:
 * every per-repo tool cache lives here (vitest, taze, our own audit
 * caches, etc.). Auto-gitignored via the fleet's `**∕.cache/` rule.
 * Build tools also write here (oxlint, etc.).
 */
// oxlint-disable-next-line socket/prefer-node-modules-dot-cache -- NODE_MODULES_DIR is the canonical node_modules root; the rule's per-arg check can't see through identifiers.
export const NODE_MODULES_CACHE_DIR = path.join(NODE_MODULES_DIR, '.cache')

/** Absolute path to the repo's `pnpm-workspace.yaml`. */
export const PNPM_WORKSPACE_YAML = path.join(REPO_ROOT, 'pnpm-workspace.yaml')

/** Absolute path to the repo's `package.json`. */
export const PACKAGE_JSON = path.join(REPO_ROOT, 'package.json')

/** Absolute path to the repo's `pnpm-lock.yaml`. */
export const PNPM_LOCK = path.join(REPO_ROOT, 'pnpm-lock.yaml')

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

const SOCKET_WHEELHOUSE_CONFIG_PRIMARY_REL = '.config/socket-wheelhouse.json'
const SOCKET_WHEELHOUSE_CONFIG_LEGACY_REL = '.socket-wheelhouse.json'

export interface SocketWheelhouseConfigLocation {
  /** Absolute path to the file that was actually read. */
  readonly path: string
  /** Which of the two accepted locations was used. */
  readonly kind: 'primary' | 'legacy'
}

export interface LoadedSocketWheelhouseConfig {
  readonly location: SocketWheelhouseConfigLocation
  /** Parsed JSON root. Always an object; non-object payloads cause `undefined`. */
  readonly value: Record<string, unknown>
}

/**
 * Find the socket-wheelhouse.json under `repoRoot` (defaults to the
 * current repo's root). Returns the first matching location, or
 * `undefined` if neither file exists. When both exist, emits a
 * stderr warning + returns the primary location.
 */
export function findSocketWheelhouseConfig(
  repoRoot: string = REPO_ROOT,
): SocketWheelhouseConfigLocation | undefined {
  const primary = path.join(repoRoot, SOCKET_WHEELHOUSE_CONFIG_PRIMARY_REL)
  const legacy = path.join(repoRoot, SOCKET_WHEELHOUSE_CONFIG_LEGACY_REL)
  const primaryExists = existsSync(primary)
  const legacyExists = existsSync(legacy)
  if (primaryExists && legacyExists) {
    process.stderr.write(
      `[socket-wheelhouse] both ${SOCKET_WHEELHOUSE_CONFIG_PRIMARY_REL} ` +
        `and ${SOCKET_WHEELHOUSE_CONFIG_LEGACY_REL} exist in ${repoRoot}; ` +
        `using ${SOCKET_WHEELHOUSE_CONFIG_PRIMARY_REL}. Delete one to ` +
        `silence this note.\n`,
    )
  }
  if (primaryExists) {
    return { path: primary, kind: 'primary' }
  }
  if (legacyExists) {
    return { path: legacy, kind: 'legacy' }
  }
  return undefined
}

/**
 * Load + parse the socket-wheelhouse.json under `repoRoot` (defaults
 * to the current repo's root). Returns `undefined` on absent /
 * unreadable / unparseable / non-object root — every failure shape
 * collapses to "no config" since downstream audits should fail-open
 * when the config is unavailable.
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
