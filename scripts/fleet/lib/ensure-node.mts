#!/usr/bin/env node
/*
 * @file Self-heal the Node runtime for fleet CLI entrypoints. A non-interactive
 *   shell can run the entrypoint under the repo-pinned Node while still
 *   carrying a PATH that resolves child `#!/usr/bin/env node` launchers to a
 *   stale Homebrew/system binary. `ensurePinnedNode()` puts the running Node's
 *   directory first for every child and re-execs a below-floor process under
 *   an installed qualifying fnm Node. The fleet runtime floor is Node 24.
 */

import { existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

// prefer-async-spawn: sync-required — a startup re-exec must block before the
// entrypoint's own work runs; there is nothing to stream.
// oxlint-disable-next-line socket/prefer-async-spawn -- startup re-exec, sync by nature.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

// The hard Node major the fleet hooks assert (`Hook requires Node >= 24.0.0`).
// A running node below this trips every hook + the tests that spawn them.
export const NODE_FLOOR_MAJOR = 24

// Env stamp set on the re-exec'd child so it never re-execs again (loop guard).
export const REEXEC_GUARD_ENV = 'FLEET_NODE_REEXEC'

// Re-exec under the pinned node when the running node is below the floor. Pure
// decision — the runner supplies the resolved candidate + current state.
export function nodeReexecPlan(options: {
  alreadyReexec: boolean
  currentMajor: number
  floorMajor: number
  pinnedNode: string | undefined
}): { reexec: false } | { node: string; reexec: true } {
  const opts = { __proto__: null, ...options } as typeof options
  if (opts.alreadyReexec || opts.currentMajor >= opts.floorMajor) {
    return { reexec: false }
  }
  if (!opts.pinnedNode) {
    return { reexec: false }
  }
  return { node: opts.pinnedNode, reexec: true }
}

/**
 * Clone an environment with the selected executable's directory first on
 * PATH. Existing copies of that directory are removed so repeated calls stay
 * idempotent. The case-insensitive key lookup preserves Windows' conventional
 * `Path` spelling and removes duplicate PATH-key variants before spawn.
 */
export function envWithExecutableFirst(options: {
  delimiter?: string | undefined
  env: NodeJS.ProcessEnv
  executablePath: string
}): NodeJS.ProcessEnv {
  const opts = { __proto__: null, ...options } as typeof options
  const next = { ...opts.env }
  const pathKeys = Object.keys(next).filter(key => key.toLowerCase() === 'path')
  const pathKey = pathKeys[0] ?? 'PATH'
  const delimiter = opts.delimiter ?? path.delimiter
  const executableDir = path.dirname(opts.executablePath)
  const entries = String(next[pathKey] ?? '')
    .split(delimiter)
    .filter(
      entry => entry && path.resolve(entry) !== path.resolve(executableDir),
    )
  for (let i = 1, { length } = pathKeys; i < length; i += 1) {
    delete next[pathKeys[i]!]
  }
  next[pathKey] = [executableDir, ...entries].join(delimiter)
  return next
}

// Parse a version (`v26.4.0` / `26.4.0`) to its major, or undefined.
export function majorOf(version: string): number | undefined {
  const m = /^v?(\d+)\./.exec(version)
  return m ? Number(m[1]) : undefined
}

// The highest node binary among fnm version-dir entries whose major is at/above
// the floor, or undefined. Pure over the listing (testable without a real fnm).
export function pickFnmNode(options: {
  binOf: (version: string) => string
  entries: readonly string[]
  floorMajor: number
}): string | undefined {
  const opts = { __proto__: null, ...options } as typeof options
  let bestMajor = -1
  let best: string | undefined
  for (let i = 0, { length } = opts.entries; i < length; i += 1) {
    const entry = opts.entries[i]!
    const major = majorOf(entry)
    if (major === undefined || major < opts.floorMajor) {
      continue
    }
    if (major > bestMajor) {
      bestMajor = major
      best = opts.binOf(entry)
    }
  }
  return best
}

// The fnm node-versions store — honours `$FNM_DIR`, else the default layout.
export function fnmVersionsDir(
  env: NodeJS.ProcessEnv,
  homeDir: string,
): string {
  const base = env['FNM_DIR'] || path.join(homeDir, '.local', 'share', 'fnm')
  return path.join(base, 'node-versions')
}

// Absolute node-binary path for a fnm version-dir entry.
function fnmBinFor(versionsDir: string, entry: string): string {
  return path.join(versionsDir, entry, 'installation', 'bin', 'node')
}

/**
 * Call FIRST in a fleet CLI entrypoint's `main()`. When the running node is
 * below `NODE_FLOOR_MAJOR`, re-exec the current process under the highest
 * fnm-installed node at/above the floor and exit with its status. When the
 * current process already qualifies, align child PATH resolution with
 * `process.execPath` before returning.
 */
export function ensurePinnedNode(): void {
  const versionsDir = fnmVersionsDir(process.env, os.homedir())
  let entries: string[] = []
  try {
    entries = existsSync(versionsDir) ? readdirSync(versionsDir) : []
  } catch {
    entries = []
  }
  const candidate = pickFnmNode({
    binOf: entry => fnmBinFor(versionsDir, entry),
    entries,
    floorMajor: NODE_FLOOR_MAJOR,
  })
  const plan = nodeReexecPlan({
    alreadyReexec: process.env[REEXEC_GUARD_ENV] === '1',
    currentMajor: majorOf(process.versions.node) ?? 0,
    floorMajor: NODE_FLOOR_MAJOR,
    pinnedNode: candidate && existsSync(candidate) ? candidate : undefined,
  })
  if (!plan.reexec) {
    const alignedEnv = envWithExecutableFirst({
      env: process.env,
      executablePath: process.execPath,
    })
    const pathKey =
      Object.keys(alignedEnv).find(key => key.toLowerCase() === 'path') ??
      'PATH'
    process.env['PATH'] = alignedEnv[pathKey]!
    return
  }
  const childEnv = envWithExecutableFirst({
    env: process.env,
    executablePath: plan.node,
  })
  childEnv[REEXEC_GUARD_ENV] = '1'
  const result = spawnSync(plan.node, process.argv.slice(1), {
    env: childEnv,
    stdio: 'inherit',
  })
  process.exit(typeof result.status === 'number' ? result.status : 1)
}
