/**
 * @file Point every user-directory env var at a throwaway dir under
 *   `os.tmpdir()`, so a test run cannot read or write the developer's real
 *   home. Wired fleet-wide from `test/fleet/scripts/setup.mts`, alongside the
 *   git isolation and the network fail-closed.
 *   Why this is a DEFAULT and not per-test discipline. Measured on socket-lib:
 *   a full run with HOME redirected left behind `.socket/_dlx/{jre,sbt}`,
 *   `.socket/_cacache/`, `.npm/_logs/` and `Library/Caches/`. Every one of
 *   those lands in the real home on an unredirected run. The `_dlx` entries are
 *   the sharp edge: a test that enumerates the dlx cache and asserts a count
 *   sees whatever that machine happens to have downloaded, so it passes for the
 *   person who wrote it and fails for someone whose home is not empty. A
 *   per-test opt-in cannot fix that class, because the tests that leak are
 *   exactly the ones nobody realized were resolving a real path.
 *   The redirect is env-var-only. Nothing here rewrites a code path, so a
 *   module that derives `~/.socket/...` from `os.homedir()` follows along on
 *   its own, and a test that needs a SPECIFIC directory still sets its own env
 *   var (`SOCKET_DLX_DIR`, …) over the top. That layering is deliberate: this
 *   sets the floor, and a test that cares sets the exact value.
 *   The dir is keyed by pid, so every worker thread of one run shares it and a
 *   run leaves exactly one directory behind for the OS to reap. It is NOT
 *   deleted in an afterAll: setup runs per FILE, and files share a worker, so
 *   deleting at the end of one file would pull the floor out from under the
 *   next one.
 */

import { existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {
  ISOLATED_ENV_VARS,
  TOOLCHAIN_ROOT_VARS,
} from '../../../../scripts/fleet/_shared/test-isolation-law.mts'

// Where each isolated var lands inside the sandbox. The KEYS are not listed
// here -- they come from ISOLATED_ENV_VARS, which is the law's own statement of
// what must be pinned. Hand-listing them again is how a list drifts: the law
// gains COREPACK_HOME after the corepack incident and the sandbox never hears
// about it. Anything without an entry below still gets pinned, under
// `.tool/<name>`; the map exists only for vars whose conventional location a
// tool might also compute for itself, so both routes land in one place.
const SANDBOX_SUBPATHS: Record<string, readonly string[]> = {
  __proto__: null,
  HOME: [],
  USERPROFILE: [],
  XDG_CACHE_HOME: ['.cache'],
  XDG_CONFIG_HOME: ['.config'],
  XDG_DATA_HOME: ['.local', 'share'],
  XDG_STATE_HOME: ['.local', 'state'],
  npm_config_cache: ['.npm'],
} as unknown as Record<string, readonly string[]>

// XDG_CONFIG_HOME is pinned here but is NOT in the law's list, which stops at
// cache/data/state. A config dir a tool writes into is the same leak as a cache
// dir, so it is covered; if the law adopts it, this line becomes redundant
// rather than wrong.
const EXTRA_ISOLATED_VARS: readonly string[] = Object.freeze([
  'XDG_CONFIG_HOME',
])

/**
 * Redirect the home-directory env vars into a per-run dir under `os.tmpdir()`
 * and return that dir.
 */
export function isolateHomeEnv(): string {
  const sandbox = path.join(os.tmpdir(), `fleet-test-home-${process.pid}`)

  // Clause 3, and it runs BEFORE HOME moves so `os.homedir()` still answers
  // with the real home. rustup reads its default toolchain from ~/.rustup, so a
  // redirected HOME with no RUSTUP_HOME leaves cargo unable to choose one and
  // every cargo-spawning test dies with "is this a cargo workspace?". The same
  // shape hits every shim in TOOLCHAIN_ROOT_VARS.
  //
  // Two conditions, both from the law's own wording ("when it is not already
  // exported and the directory exists"): an already-exported value belongs to
  // whoever set it, and seeding a root that is not installed would hand a shim
  // a path to nothing, which is a different failure from the one being fixed.
  const realHome = os.homedir()
  for (const { dir, name } of TOOLCHAIN_ROOT_VARS) {
    if (!process.env[name]) {
      const root = path.join(realHome, dir)
      if (existsSync(root)) {
        process.env[name] = root
      }
    }
  }

  mkdirSync(sandbox, { recursive: true })
  for (const name of [...ISOLATED_ENV_VARS, ...EXTRA_ISOLATED_VARS]) {
    // A toolchain root is deliberately NOT sandboxed -- it was just pointed at
    // the real home above, and pinning it here would undo clause 3.
    //
    // CARGO_HOME is NOT one of those roots and so IS sandboxed. That looks
    // alarming, because CARGO_HOME holds the registry cache, and it measures
    // fine: RUSTUP_HOME is what `cargo metadata` could not do without, and the
    // workspace reads resolve from the tree. Left sandboxed on purpose, since a
    // suite that installs crates should not populate the developer's registry.
    if (TOOLCHAIN_ROOT_VARS.some(root => root.name === name)) {
      continue
    }
    const segments = SANDBOX_SUBPATHS[name] ?? ['.tool', name.toLowerCase()]
    const value = path.join(sandbox, ...segments)
    mkdirSync(value, { recursive: true })
    process.env[name] = value
  }

  return sandbox
}

/**
 * Whether `dir` sits inside the OS temp dir.
 *
 * Exists so a test can assert the sandbox is actually in effect rather than
 * assume it. An isolation that silently stops applying is worse than none: the
 * suite keeps passing on the machine that set it up and starts failing on the
 * one whose home is not empty.
 */
export function isUnderTmpDir(dir: string): boolean {
  const rel = path.relative(os.tmpdir(), dir)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}
