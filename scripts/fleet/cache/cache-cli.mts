/**
 * @file Shared core for the fleet cache CLIs (restore.mts / save.mts) — the
 *   native port of the `actions/cache` composite steps over the
 *   `@actions/cache` npm package (the cache-service client the upstream
 *   action is a thin wrapper around). Pure decision functions — arg parsing,
 *   key matching, output-line composition, catalog-pin reading, npm-arg
 *   composition — are exported for the wheelhouse unit suite; the impure
 *   residue (module loading, file appends, the provisioning spawn in
 *   setup/provision-actions-cache.mjs) is kept thin and injectable.
 *   Module resolution is two-tier because the CLIs run on both sides of
 *   `pnpm install`: the normal path resolves `@actions/cache` from the repo's
 *   own node_modules (lockfile-pinned); jobs with no node_modules yet — the
 *   pnpm-store restore that runs BEFORE install, and the Rust-only jobs that
 *   never install — provision the catalog-pinned version into a scratch
 *   prefix under RUNNER_TEMP with the runner's system npm and import it from
 *   there. The version always comes from the fleet catalog
 *   (.config/fleet/pnpm-workspace.fleet.yaml), so both tiers run the same
 *   soaked release.
 *   Only `node:` builtins and sibling fleet scripts are imported at module
 *   scope — the whole point is running before any install exists, the same
 *   constraint as registry-liveness-gate.mjs and
 *   setup/bootstrap-zero-dep-packages.mjs.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { parseCatalogBlock } from '../lib/workspace-yaml.mts'
import { provisionWithNpm } from '../setup/provision-actions-cache.mjs'

// The npm package this CLI family wraps — also the fleet catalog key its
// provisioning pin is read from.
export const ACTIONS_CACHE_PACKAGE = '@actions/cache'

// The subset of the @actions/cache surface the CLIs call. The real module
// carries more optional parameters (download/upload options, cross-OS
// archive); this narrower shape is what both the repo-resolved and the
// provisioned module are validated against.
export interface ActionsCacheModule {
  restoreCache(
    paths: string[],
    primaryKey: string,
    restoreKeys?: string[] | undefined,
  ): Promise<string | undefined>
  saveCache(paths: string[], key: string): Promise<number>
}

// Parsed CLI surface shared by restore and save. `restoreKeys` is always
// present and empty for save — the parser rejects the flag there.
export interface CacheCliArgs {
  key: string
  paths: string[]
  restoreKeys: string[]
}

export interface CacheCliParseResult {
  args?: CacheCliArgs | undefined
  usageError?: string | undefined
}

// A single error-text shape for unknown thrown values. The fleet
// errorMessage helper is the house standard, but it lives in
// @socketsecurity/lib, which this file must not import — it has to run
// before node_modules exists.
export function cacheErrorText(thrown: unknown): string {
  // oxlint-disable-next-line socket/prefer-error-message-helper, socket/prefer-error-message -- pre-install CLI: the lib errorMessage helper is not on disk before pnpm install runs.
  return thrown instanceof Error ? thrown.message : String(thrown)
}

// Default stdout sink for the CLIs and the loader's provisioning notice.
export function logCacheCliLine(message: string): void {
  // oxlint-disable-next-line socket/no-console-prefer-logger -- the logger package may not be installed when this pre-install CLI runs.
  console.log(message)
}

// Default stderr sink for the CLIs' loud failures.
export function logCacheCliError(message: string): void {
  // oxlint-disable-next-line socket/no-console-prefer-logger -- the logger package may not be installed when this pre-install CLI runs.
  console.error(message)
}

/**
 * Expand repeatable flag values: each value may itself be a newline-separated
 * list, because the composite actions pass step outputs composed one path
 * per line. Entries are trimmed; empties drop out.
 */
export function expandFlagValues(values: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0, { length } = values; i < length; i += 1) {
    const parts = values[i]!.split('\n')
    for (let j = 0, partCount = parts.length; j < partCount; j += 1) {
      const entry = parts[j]!.trim()
      if (entry !== '') {
        out.push(entry)
      }
    }
  }
  return out
}

/**
 * Parse the shared CLI surface: repeatable `--path`, one `--key`, and (for
 * restore only) repeatable `--restore-key`. Returns a usage error string
 * instead of throwing so the CLI shells own the exit code.
 */
export function parseCacheCliArgs(
  argv: readonly string[],
  config: { allowRestoreKeys: boolean; command: string },
): CacheCliParseResult {
  const cfg = { __proto__: null, ...config }
  const restoreKeyHint = cfg.allowRestoreKeys
    ? ' [--restore-key <prefix>]...'
    : ''
  const usage = `Usage: node scripts/fleet/cache/${cfg.command}.mts --path <path>... --key <key>${restoreKeyHint}`
  let parsed: {
    values: {
      key?: string | undefined
      path?: string[] | undefined
      'restore-key'?: string[] | undefined
    }
  }
  try {
    parsed = parseArgs({
      allowPositionals: false,
      args: [...argv],
      options: {
        key: { type: 'string' },
        path: { multiple: true, type: 'string' },
        'restore-key': { multiple: true, type: 'string' },
      },
      strict: true,
    })
  } catch (e) {
    return {
      usageError: `Unrecognized arguments for the fleet cache ${cfg.command} CLI. Saw: ${cacheErrorText(e)}. Fix: ${usage}`,
    }
  }
  const paths = expandFlagValues(parsed.values.path ?? [])
  const restoreKeys = expandFlagValues(parsed.values['restore-key'] ?? [])
  const key = (parsed.values.key ?? '').trim()
  if (paths.length === 0) {
    return {
      usageError: `No cache paths given to the fleet cache ${cfg.command} CLI. Saw: zero --path values. Fix: ${usage}`,
    }
  }
  if (key === '') {
    return {
      usageError: `No cache key given to the fleet cache ${cfg.command} CLI. Saw: an empty --key. Fix: ${usage}`,
    }
  }
  if (!cfg.allowRestoreKeys && restoreKeys.length > 0) {
    return {
      usageError: `--restore-key is a restore-only flag; the fleet cache ${cfg.command} CLI saves under exactly one key. Saw: ${restoreKeys.length} --restore-key value(s). Fix: ${usage}`,
    }
  }
  return { args: { key, paths, restoreKeys } }
}

/**
 * Whether the restored key is an exact match for the primary key — the
 * `cache-hit` verdict. Case-insensitive, mirroring the upstream
 * actions/cache behavior (the cache service treats keys case-insensitively).
 */
export function isExactKeyMatch(
  primaryKey: string,
  matchedKey: string | undefined,
): boolean {
  return (
    matchedKey !== undefined &&
    matchedKey.toLowerCase() === primaryKey.toLowerCase()
  )
}

/**
 * The GITHUB_OUTPUT lines a restore emits — the same three outputs the
 * upstream actions/cache/restore action publishes, which the fleet
 * composites consume (`cache-hit` in cache-pnpm-store, `cache-matched-key`
 * in setup-odai). A miss writes an empty matched key and a false hit, never
 * nothing — downstream `if:` expressions compare against ''.
 */
export function composeRestoreOutputLines(
  primaryKey: string,
  matchedKey: string | undefined,
): string[] {
  return [
    `cache-primary-key=${primaryKey}`,
    `cache-matched-key=${matchedKey ?? ''}`,
    `cache-hit=${isExactKeyMatch(primaryKey, matchedKey)}`,
  ]
}

/**
 * Append `k=v` lines to the step's GITHUB_OUTPUT file when the variable is
 * set; outside GitHub Actions (a local run) the outputs are simply not
 * written — stdout already carries the verdict.
 */
export function appendGithubOutputLines(
  lines: readonly string[],
  options?:
    | {
        appendFile?: ((file: string, data: string) => void) | undefined
        env?: Record<string, string | undefined> | undefined
      }
    | undefined,
): void {
  const opts = { __proto__: null, ...options }
  const env = opts.env ?? process.env
  const file = env['GITHUB_OUTPUT']
  if (!file) {
    return
  }
  const appendFile =
    opts.appendFile ??
    ((target: string, data: string) => appendFileSync(target, data))
  for (let i = 0, { length } = lines; i < length; i += 1) {
    appendFile(file, `${lines[i]!}\n`)
  }
}

// The repo root as seen from this script's own home at scripts/fleet/cache/,
// stable however the caller's cwd wanders — the same locally-computed shape
// as registry-liveness-gate.mjs (scripts/fleet/paths.mts imports
// @socketsecurity/lib, which may not be installed yet when this runs).
export function repoRootFromScriptDir(scriptFileUrl: string): string {
  return path.resolve(
    path.dirname(fileURLToPath(scriptFileUrl)),
    '..',
    '..',
    '..',
  )
}

/**
 * The catalog-pinned @actions/cache version for the provisioning fallback.
 * Reads the cascaded fleet catalog first (.config/fleet/
 * pnpm-workspace.fleet.yaml — present in every member), then the repo's own
 * pnpm-workspace.yaml catalog. A missing or unreadable candidate is skipped;
 * undefined when neither carries the pin.
 */
export function readActionsCacheCatalogPin(
  repoRoot: string,
  readFile: (file: string) => string = file => readFileSync(file, 'utf8'),
): string | undefined {
  const candidates = [
    path.join(repoRoot, '.config', 'fleet', 'pnpm-workspace.fleet.yaml'),
    path.join(repoRoot, 'pnpm-workspace.yaml'),
  ]
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    let content: string
    try {
      content = readFile(candidates[i]!)
    } catch {
      continue
    }
    const pin = parseCatalogBlock(content)[ACTIONS_CACHE_PACKAGE]
    if (pin) {
      return pin
    }
  }
  return undefined
}

/**
 * The npm argv that provisions the pinned package into a scratch prefix.
 * `--prefix` keeps the install fully outside the repo — no lockfile, no
 * package.json churn; audit/fund chatter is off so CI logs stay readable.
 */
export function composeNpmInstallArgs(
  version: string,
  prefixDir: string,
): string[] {
  return [
    'install',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
    '--prefix',
    prefixDir,
    `${ACTIONS_CACHE_PACKAGE}@${version}`,
  ]
}

/**
 * The package's ESM entry file, relative to its directory, from its
 * package.json shape: the `exports`['.'] import condition when present
 * (@actions/cache v6 is ESM-only), else `main`.
 */
export function resolvePackageEntry(pkgJson: {
  exports?: unknown | undefined
  main?: string | undefined
}): string | undefined {
  const { exports: exportsMap } = pkgJson
  if (
    typeof exportsMap === 'object' &&
    exportsMap !== null &&
    '.' in exportsMap
  ) {
    const dot: unknown = exportsMap['.']
    if (typeof dot === 'string') {
      return dot
    }
    if (typeof dot === 'object' && dot !== null && 'import' in dot) {
      const importTarget: unknown = dot.import
      if (typeof importTarget === 'string') {
        return importTarget
      }
    }
  }
  return pkgJson.main
}

// True only for the resolution failure of the package itself — a transitive
// ERR_MODULE_NOT_FOUND (a broken install) must surface, not trigger a
// re-provision that would mask it.
export function isPackageItselfUnresolved(thrown: unknown): boolean {
  return (
    thrown instanceof Error &&
    'code' in thrown &&
    thrown.code === 'ERR_MODULE_NOT_FOUND' &&
    thrown.message.includes(`'${ACTIONS_CACHE_PACKAGE}'`)
  )
}

// Runtime shape check for both module tiers — the repo-resolved import and
// the provisioned file-URL import go through the same gate, so a truncated
// or wrong-package install fails loud here instead of at call time.
export function isActionsCacheModule(
  candidate: unknown,
): candidate is ActionsCacheModule {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    'restoreCache' in candidate &&
    typeof candidate.restoreCache === 'function' &&
    'saveCache' in candidate &&
    typeof candidate.saveCache === 'function'
  )
}

/**
 * Load @actions/cache: repo node_modules first, the RUNNER_TEMP scratch
 * prefix second — provisioned there with the runner's system npm when
 * absent. Throws with What / Where / Saw-vs-wanted / Fix on every failure;
 * the cache CLIs are deliberately not fail-open.
 */
export async function loadActionsCacheModule(
  options?:
    | {
        env?: Record<string, string | undefined> | undefined
        log?: ((message: string) => void) | undefined
        repoRoot?: string | undefined
      }
    | undefined,
): Promise<ActionsCacheModule> {
  const opts = { __proto__: null, ...options }
  const env = opts.env ?? process.env
  const log = opts.log ?? logCacheCliLine
  const repoRoot = opts.repoRoot ?? repoRootFromScriptDir(import.meta.url)
  try {
    const repoResolved: unknown = await import(ACTIONS_CACHE_PACKAGE)
    if (isActionsCacheModule(repoResolved)) {
      return repoResolved
    }
    throw new Error(
      `The installed ${ACTIONS_CACHE_PACKAGE} does not expose restoreCache/saveCache. Where: the repo's node_modules. Saw: a module without the expected functions; wanted the @actions/cache API. Fix: reinstall dependencies (pnpm install).`,
    )
  } catch (e) {
    if (!isPackageItselfUnresolved(e)) {
      throw e
    }
  }
  const prefixDir =
    env['FLEET_ACTIONS_CACHE_PREFIX'] ??
    path.join(env['RUNNER_TEMP'] ?? os.tmpdir(), 'fleet-actions-cache-cli')
  const packageDir = path.join(prefixDir, 'node_modules', '@actions', 'cache')
  const packageJsonPath = path.join(packageDir, 'package.json')
  if (!existsSync(packageJsonPath)) {
    const version = readActionsCacheCatalogPin(repoRoot)
    if (!version) {
      throw new Error(
        `The ${ACTIONS_CACHE_PACKAGE} catalog pin is missing. Where: ${path.join(repoRoot, '.config/fleet/pnpm-workspace.fleet.yaml')} (and pnpm-workspace.yaml). Saw: no '${ACTIONS_CACHE_PACKAGE}' entry in any catalog block; wanted the fleet-pinned version. Fix: re-cascade from the wheelhouse so the fleet catalog carries the pin.`,
      )
    }
    if (!/^[0-9A-Za-z.+-]+$/.test(version)) {
      throw new Error(
        `The ${ACTIONS_CACHE_PACKAGE} catalog pin is not a plain version. Where: the fleet catalog under ${repoRoot}. Saw: '${version}'; wanted a bare semver like 6.2.0. Fix: pin the catalog entry to an exact version.`,
      )
    }
    log(
      `${ACTIONS_CACHE_PACKAGE} is not installed yet (this step runs before pnpm install); provisioning ${version} into ${prefixDir} with npm.`,
    )
    const npmStatus = provisionWithNpm(
      prefixDir,
      composeNpmInstallArgs(version, prefixDir),
    )
    if (npmStatus !== 0) {
      throw new Error(
        `Provisioning ${ACTIONS_CACHE_PACKAGE}@${version} failed. Where: npm install --prefix ${prefixDir}. Saw: exit ${npmStatus ?? 'null'}; wanted 0. Fix: check the npm output above (registry reachability, the pinned version's existence) and re-run.`,
      )
    }
  }
  const packageJson: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  const entry =
    typeof packageJson === 'object' && packageJson !== null
      ? resolvePackageEntry(packageJson)
      : undefined
  if (!entry) {
    throw new Error(
      `The provisioned ${ACTIONS_CACHE_PACKAGE} has no resolvable entry. Where: ${packageJsonPath}. Saw: neither an exports['.'] import target nor a main field; wanted one. Fix: delete ${prefixDir} and re-run to re-provision.`,
    )
  }
  const provisioned: unknown = await import(
    pathToFileURL(path.join(packageDir, entry)).href
  )
  if (!isActionsCacheModule(provisioned)) {
    throw new Error(
      `The provisioned ${ACTIONS_CACHE_PACKAGE} does not expose restoreCache/saveCache. Where: ${packageDir}. Saw: a module without the expected functions; wanted the @actions/cache API. Fix: delete ${prefixDir} and re-run to re-provision.`,
    )
  }
  return provisioned
}
