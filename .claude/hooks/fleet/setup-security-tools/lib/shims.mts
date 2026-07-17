import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { getSocketAppDir } from '@socketsecurity/lib-stable/paths/socket'

// Single source for the SFW shim directory. The integrity checker
// (index.mts checkShims) and the repairers (index.mts repairShims,
// install.mts findBrokenShims) MUST scan the same dir — they previously
// diverged (`_wheelhouse/shims` vs a hardcoded `~/.socket/sfw/shims`), and the
// shared value itself then pointed at `_wheelhouse/shims`, a dir NO generator
// writes. The fleet generator (scripts/fleet/setup/setup-tools.mjs) writes
// shims into `_wheelhouse/bin` — the one PATH entry, where they co-live with
// the flat racked-tool handles (bin/sfw → rack/sfw/<ver>/sfw).
export function getShimsDir(): string {
  return path.join(getSocketAppDir('wheelhouse'), 'bin')
}

// The shim commands every provisioned machine gets — used as the "shims were
// wiped" tripwire. Deliberately the cross-platform core (the full ecosystem
// list varies by OS + enterprise flavor).
export const CORE_SHIM_COMMANDS = ['cargo', 'npm', 'pnpm', 'uv'] as const

/**
 * Extract the double-quoted absolute-path targets a shim executes and return
 * the ones that no longer exist on disk. Pure content scan, generator-agnostic:
 * matches the fleet shim shape (`"…/rack/sfw/<ver>/sfw" "…/real/tool" "$@"`),
 * the legacy sfw-native shape, and the older dlx-backed shape
 * (`"…/_dlx/<hash>/sfw-enterprise"`). `$`-containing tokens (`"$PATH"`, `"$@"`)
 * are shell variables, not paths, and are skipped.
 */
export function findBrokenShimTargets(content: string): string[] {
  const broken: string[] = []
  const quoted = content.matchAll(/"(?<target>[^"]+)"/g)
  for (const match of quoted) {
    const target = match.groups!['target']!
    if (target.includes('$') || !path.isAbsolute(target)) {
      continue
    }
    if (!existsSync(target)) {
      broken.push(target)
    }
  }
  return broken
}

/**
 * Which of the core shim commands are missing from a shim dir. All-missing is
 * the "shims were wiped / never generated" repair trigger; partial absence is
 * left to the per-shim broken diagnostics.
 */
export function missingCoreShims(dir: string): string[] {
  return CORE_SHIM_COMMANDS.filter(cmd => !existsSync(path.join(dir, cmd)))
}

// The content-addressed dlx-cache path segment. A shim target under it is
// GC-fragile: sfw's dlx sweep evicts old hashes and orphans the shim (the
// recurring broken-headroom-shim failure), so we mirror it somewhere no GC runs.
const DLX_SEGMENT = '/_dlx/'

/**
 * GC-stable mirror root for shim exec targets. `_dlx/<hash>/…` is
 * content-addressed and garbage-collected; nothing sweeps `sfw-stable/`, so a
 * shim repointed here survives a dlx eviction. Sibling to the shim dir under
 * the one `getSocketAppDir('wheelhouse')` umbrella.
 */
export function getStableDir(): string {
  return path.join(getSocketAppDir('wheelhouse'), 'sfw-stable')
}

/**
 * True when a shim exec target lives in the GC-able dlx cache.
 */
export function isDlxTarget(target: string): boolean {
  return normalizePath(target).includes(DLX_SEGMENT)
}

/**
 * Map a dlx-backed target (`…/_dlx/<hash>/<rest>`) to its stable mirror
 * (`<stableDir>/<hash>/<rest>`), preserving the content hash + subpath so
 * multiple tools/versions coexist. `undefined` for a non-dlx target.
 */
export function stableTargetFor(target: string): string | undefined {
  const norm = normalizePath(target)
  const at = norm.indexOf(DLX_SEGMENT)
  if (at === -1) {
    return undefined
  }
  return path.join(getStableDir(), norm.slice(at + DLX_SEGMENT.length))
}

/**
 * The `…/_dlx/<hash>` root of a dlx target (the whole dir to mirror).
 */
function dlxRootOf(target: string): string | undefined {
  const norm = normalizePath(target)
  const at = norm.indexOf(DLX_SEGMENT)
  if (at === -1) {
    return undefined
  }
  const hash = norm.slice(at + DLX_SEGMENT.length).split('/')[0]!
  return norm.slice(0, at) + DLX_SEGMENT + hash
}

/**
 * Every dlx-backed absolute target a shim executes (present or already-evicted)
 * — the GC-fragile set to stabilize. Skips shell tokens (`"$@"`, `"$PATH"`).
 */
export function findDlxBackedTargets(content: string): string[] {
  const targets: string[] = []
  for (const match of content.matchAll(/"(?<target>[^"]+)"/g)) {
    const target = match.groups!['target']!
    if (
      !target.includes('$') &&
      path.isAbsolute(target) &&
      isDlxTarget(target)
    ) {
      targets.push(target)
    }
  }
  return targets
}

/**
 * Mirror every dlx-backed shim target into `getStableDir()` and repoint the
 * shim there, so a dlx sweep can no longer break it. Idempotent: skips a target
 * already stabilized and a source already evicted (that needs a reinstall to
 * recreate the dlx dir first — stabilize runs right after install, before any
 * sweep). Returns the shim basenames it rewrote. Must run while the dlx source
 * still exists, i.e. immediately after the tool install.
 */
/* c8 ignore start - real-fs orchestration (readdir/cp/writeFile of live shim + dlx dirs); the pure mapping helpers above are unit-tested */
export async function stabilizeShims(): Promise<string[]> {
  const shimsDir = getShimsDir()
  if (!existsSync(shimsDir)) {
    return []
  }
  const stabilized: string[] = []
  for (const entry of await fs.readdir(shimsDir)) {
    const shimPath = path.join(shimsDir, entry)
    let content: string
    try {
      content = await fs.readFile(shimPath, 'utf8')
    } catch {
      continue
    }
    let next = content
    for (const target of findDlxBackedTargets(content)) {
      const stable = stableTargetFor(target)
      const dlxRoot = dlxRootOf(target)
      if (stable === undefined || dlxRoot === undefined) {
        continue
      }
      const stableRoot = path.join(getStableDir(), path.basename(dlxRoot))
      // Mirror the whole content-addressed dir once (a venv's siblings come
      // along); only when the source still exists and the mirror does not.
      if (existsSync(dlxRoot) && !existsSync(stableRoot)) {
        await fs.mkdir(path.dirname(stableRoot), { recursive: true })
        await fs.cp(dlxRoot, stableRoot, { recursive: true })
      }
      if (existsSync(stable)) {
        next = next.split(`"${target}"`).join(`"${stable}"`)
      }
    }
    if (next !== content) {
      await fs.writeFile(shimPath, next)
      stabilized.push(entry)
    }
  }
  return stabilized
}
/* c8 ignore stop */
