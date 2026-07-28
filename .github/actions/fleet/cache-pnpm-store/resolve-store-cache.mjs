/**
 * @file Pnpm store-path + cache-key resolver for the fleet cache-pnpm-store
 *   action. Resolves the store path to cache — the `pnpm store path` query
 *   when it printed anything, the documented per-OS default otherwise — and
 *   composes the exact-restore cache key partitioned by OS and Node major.
 *   Branch shape, unchanged from the three inline bash `run:` blocks this
 *   was extracted from:
 *
 *   - the query is authoritative: any non-empty stdout from `pnpm store path` is
 *     used AS-IS, even on Windows with backslashes — the old sed only ever ran
 *     on the fallback branch — and even when pnpm exited non-zero after
 *     printing, because `$(pnpm store path || true)` kept the stdout. The thin
 *     shell in action.yml still owns the probe and hands the captured stdout in
 *     via QUERIED_STORE_PATH.
 *   - fallback per OS: Windows composes ${LOCALAPPDATA}/pnpm/store/v3 with every
 *     backslash flipped to a forward slash (an UNSET LOCALAPPDATA expands empty
 *     → "/pnpm/store/v3", exactly like the old non-`-u` bash step); everything
 *     else composes ${HOME}/.local/share/pnpm/store/v3.
 *   - the cache key is byte-load-bearing: existing caches were saved under
 *     `<prefix>-<version>-<runner.os>-node<major>-<lockfile-hash>` composed by
 *     the GitHub expressions engine, and every key this script composes must
 *     still hit them. composeCacheKey is that exact concatenation; the
 *     hashFiles(`**`/`pnpm-lock.yaml`) expression stays action-level and
 *     arrives via LOCKFILE_HASH.
 *   - Node major partition: the old step probed `node -p
 *     'process.versions.node.split(".")[0]' || echo 'x'`; this script reads the
 *     same value from its own process.versions.node — the identical PATH node
 *     the probe ran. DIVERGENCE, documented: with no usable node the old step
 *     composed a `nodex` key while this script cannot run at all and the step
 *     fails loudly — unreachable in practice, the action runs after `setup`
 *     provisioned node. The 'x' mapping itself is preserved in nodeMajorForKey
 *     for an empty version. Outputs land where the old steps put them, in the
 *     old order: `path` + `major` step outputs to GITHUB_OUTPUT,
 *     PNPM_STORE_PATH + PNPM_STORE_CACHE_KEY to GITHUB_ENV — $GITHUB_ENV (not
 *     just step outputs) so the save step in setup-and-install, a different
 *     composite scope, can read them. Byte-identical
 *     stdout/GITHUB_OUTPUT/GITHUB_ENV/ exit proven old-vs-new side-by-side
 *     across 9 pnpm-shimmed scenarios plus a 15-combination key-parity sweep.
 *     Co-located with the action and invoked via $GITHUB_ACTION_PATH so it
 *     travels when a member consumes the action — same shape as
 *     github-status-check's probe. Dependency-free on purpose: runs on the
 *     runner's system Node, only `node:` builtins. Pure decision functions are
 *     exported for the wheelhouse unit suite; the thin CLI shell at the bottom
 *     reads the env and appends to GITHUB_OUTPUT/GITHUB_ENV. Usage:
 *     QUERIED_STORE_PATH="$(pnpm store path 2>/dev/null || true)" node
 *     resolve-store-cache.mjs
 */

import { appendFileSync, realpathSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * The store path to cache, and whether the per-OS fallback produced it.
 * `queriedPath` is the captured stdout of `pnpm store path` — authoritative
 * whenever non-empty, used verbatim. The fallback chain is checked in the
 * old branch order: Windows first (LOCALAPPDATA with backslashes flipped),
 * then the XDG default under HOME for every other OS.
 */
export function resolveStorePath({
  home,
  localAppData,
  queriedPath,
  runnerOs,
}) {
  if (queriedPath !== '') {
    return { fallback: false, storePath: queriedPath }
  }
  if (runnerOs === 'Windows') {
    return {
      fallback: true,
      storePath: `${localAppData}/pnpm/store/v3`.replaceAll('\\', '/'),
    }
  }
  return { fallback: true, storePath: `${home}/.local/share/pnpm/store/v3` }
}

/**
 * The Node ABI, major version, partitions the store key — packages with
 * prebuilt native binaries cache a different artifact per major. 'x' for an
 * empty version string, the `|| echo 'x'` arm of the old probe.
 */
export function nodeMajorForKey(nodeVersion) {
  if (nodeVersion === '') {
    return 'x'
  }
  return nodeVersion.split('.')[0]
}

/**
 * The exact-restore cache key. Byte-load-bearing: this is the same
 * concatenation the GitHub expressions engine performed —
 * <prefix>-<version>-<runner.os>-node<major>-<lockfile-hash>
 * — and existing caches saved under expression-composed keys must still
 * hit. Lockfile hash makes the exact key; OS + Node major partition by
 * platform/ABI; cache-version is the manual bust knob.
 */
export function composeCacheKey({
  cacheVersion,
  keyPrefix,
  lockfileHash,
  nodeMajor,
  runnerOs,
}) {
  return `${keyPrefix}-${cacheVersion}-${runnerOs}-node${nodeMajor}-${lockfileHash}`
}

// Append sink for the step-scoped GITHUB_OUTPUT / job-scoped GITHUB_ENV
// files — the destination of the old steps' `echo "k=v" >> "$FILE"`. A
// missing variable throws: outside Actions that is a caller bug, and the
// step's `set -e` surfaces the non-zero exit.
function defaultAppend(name) {
  return line => {
    const file = process.env[name]
    if (!file) {
      throw new Error(
        `${name} is not set — the cache-pnpm-store resolver writes ${name === 'GITHUB_ENV' ? 'job env for the setup-and-install save step' : 'step outputs'}. Fix: run via the fleet cache-pnpm-store action, which provides it.`,
      )
    }
    appendFileSync(file, `${line}\n`)
  }
}

/**
 * The whole resolution: store path, Node major, cache key, emitted in the
 * old steps' order — path/major step outputs, PNPM_STORE_PATH/
 * PNPM_STORE_CACHE_KEY job env, the fallback notice before the final
 * store-path line on stdout. Injectable env + sinks keep it drivable
 * end-to-end by the unit suite.
 */
export function runResolve({
  appendEnv = defaultAppend('GITHUB_ENV'),
  appendOutput = defaultAppend('GITHUB_OUTPUT'),
  env = process.env,
  log = console.log,
  nodeVersion = process.versions.node,
} = {}) {
  const { fallback, storePath } = resolveStorePath({
    home: env.HOME ?? '',
    localAppData: env.LOCALAPPDATA ?? '',
    queriedPath: env.QUERIED_STORE_PATH ?? '',
    runnerOs: env.RUNNER_OS ?? '',
  })
  if (fallback) {
    log(`ⓘ pnpm store path query failed; using default ${storePath}`)
  }
  const nodeMajor = nodeMajorForKey(nodeVersion)
  const cacheKey = composeCacheKey({
    cacheVersion: env.CACHE_VERSION ?? '',
    keyPrefix: env.KEY_PREFIX ?? '',
    lockfileHash: env.LOCKFILE_HASH ?? '',
    nodeMajor,
    runnerOs: env.RUNNER_OS ?? '',
  })
  appendOutput(`path=${storePath}`)
  appendOutput(`major=${nodeMajor}`)
  appendEnv(`PNPM_STORE_PATH=${storePath}`)
  appendEnv(`PNPM_STORE_CACHE_KEY=${cacheKey}`)
  log(`pnpm store path: ${storePath}`)
}

// Realpath both sides — the naive argv[1] comparison is symlink-fragile,
// the same pitfall scripts/fleet/_shared/is-main-module.mts documents; that
// helper is .mts and this script must stay importless-runnable on system
// Node, so the comparison is inlined.
function isEntrypoint(invokedPath) {
  if (!invokedPath) {
    return false
  }
  try {
    return (
      realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))
    )
  } catch {
    return false
  }
}

if (isEntrypoint(process.argv[1])) {
  runResolve()
}
