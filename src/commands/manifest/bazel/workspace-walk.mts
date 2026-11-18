/**
 * Walk the directory tree rooted at `cwd` and return every directory that
 * looks like a Bazel workspace root — i.e. contains `MODULE.bazel`,
 * `WORKSPACE`, or `WORKSPACE.bazel`. Real monorepos host multiple roots
 * (e.g. `envoy/mobile/MODULE.bazel`, rules_kotlin's per-example
 * `examples/<name>/MODULE.bazel`); the per-workspace algorithm in the
 * orchestrator runs once per discovered root.
 *
 * The walker is dependency-injected with the directory-prune policy:
 * callers pass the set of basenames and basename prefixes the walk must
 * refuse to descend into. This module intentionally hardcodes none of
 * the "common" prunes (`.git`, `node_modules`, …) — Bazel callers compose
 * the codebase-wide `IGNORED_DIRS` list (`src/utils/glob.mts`) with the
 * Bazel-specific bits (`bazel-*` output_base symlinks,
 * `.socket-auto-manifest`).
 *
 * Discovery is bounded-but-complete: the walk visits directories in
 * deterministic (sorted) order under a single visited-directory budget
 * (`MAX_WALK_DIRS`) as the only pathological-input / symlink-loop guard —
 * there is no depth cap, because the deepest workspace marker observed across
 * the OSS corpus (9) sat *below* the old depth-8 ceiling, so that ceiling
 * silently dropped real first-party modules. All roots found within the
 * budget are collected, sorted, then capped to `MAX_WORKSPACE_ROOTS`. Both
 * the cap and a budget exhaustion `logger.warn` UNCONDITIONALLY (a missed
 * module silently drops its Maven hub, so truncation must never be silent).
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

// Hard ceiling on workspace roots; 16 sits well above realistic monorepo
// counts while tightening the guard against pathological inputs.
const MAX_WORKSPACE_ROOTS = 16
// Hard ceiling on directories visited. The sole guard against pathological
// inputs and symlink loops (a loop consumes the budget and stops). A few
// thousand is far above any realistic first-party tree once the prune policy
// has removed vendored/output dirs.
const DEFAULT_MAX_WALK_DIRS = 5_000
// Files whose presence promotes a directory to a workspace root.
const WORKSPACE_MARKER_FILES = new Set([
  'MODULE.bazel',
  'WORKSPACE',
  'WORKSPACE.bazel',
])

export type FindWorkspaceRootsOptions = {
  cwd: string
  // Directory basenames to skip outright (exact match). Pass the union of
  // the codebase-wide ignore set (`IGNORED_DIRS` in `src/utils/glob.mts`)
  // and any caller-specific additions (e.g. `.socket-auto-manifest`).
  ignoreDirNames?: ReadonlySet<string>
  // Directory basename prefixes to skip. Bazel callers pass `['bazel-']` so
  // the walk never descends into Bazel's output_base symlinks.
  ignoreDirPrefixes?: readonly string[]
  // Visited-directory budget override (testing); defaults to MAX_WALK_DIRS.
  maxWalkDirs?: number
  verbose?: boolean
}

const EMPTY_SET: ReadonlySet<string> = new Set()
const EMPTY_ARRAY: readonly string[] = []

// Walks the tree rooted at `opts.cwd` and returns absolute paths to every
// directory that contains at least one workspace marker file. Output is
// sorted for determinism and capped at MAX_WORKSPACE_ROOTS.
export function findWorkspaceRoots(opts: FindWorkspaceRootsOptions): string[] {
  const { cwd, verbose } = opts
  const ignoreDirNames = opts.ignoreDirNames ?? EMPTY_SET
  const ignoreDirPrefixes = opts.ignoreDirPrefixes ?? EMPTY_ARRAY
  const maxWalkDirs = opts.maxWalkDirs ?? DEFAULT_MAX_WALK_DIRS
  const roots: string[] = []
  // LIFO stack; children are pushed in reverse-sorted order so they pop in
  // ascending order, giving a deterministic traversal.
  const stack: string[] = [cwd]
  let dirsVisited = 0
  let budgetHit = false
  while (stack.length) {
    if (dirsVisited >= maxWalkDirs) {
      budgetHit = true
      break
    }
    const dir = stack.pop()
    if (dir === undefined) {
      break
    }
    dirsVisited += 1
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    let isWorkspaceRoot = false
    const childNames: string[] = []
    for (const entry of entries) {
      if (entry.isFile()) {
        if (WORKSPACE_MARKER_FILES.has(entry.name)) {
          isWorkspaceRoot = true
        }
        continue
      }
      if (!entry.isDirectory()) {
        continue
      }
      const name = entry.name
      if (ignoreDirNames.has(name)) {
        continue
      }
      let pruned = false
      for (const prefix of ignoreDirPrefixes) {
        if (name.startsWith(prefix)) {
          pruned = true
          break
        }
      }
      if (!pruned) {
        childNames.push(name)
      }
    }
    if (isWorkspaceRoot) {
      roots.push(dir)
    }
    // Descend regardless of whether this dir is itself a root — nested
    // workspaces are common (root MODULE.bazel + examples/*/MODULE.bazel).
    childNames.sort()
    for (let i = childNames.length - 1; i >= 0; i -= 1) {
      stack.push(path.join(dir, childNames[i]!))
    }
  }
  roots.sort()
  const kept = roots.slice(0, MAX_WORKSPACE_ROOTS)
  const droppedCount = roots.length - kept.length
  if (budgetHit) {
    // The dir budget was exhausted, so an unknown number of roots may be
    // undiscovered — surface it unconditionally.
    logger.warn(
      `Bazel workspace walk hit the ${maxWalkDirs}-directory budget; some workspaces beneath ${cwd} may be undiscovered (found ${roots.length}, kept ${kept.length}).`,
    )
  }
  if (droppedCount > 0) {
    // The cap dropped roots. Exact count when the full tree was walked; "≥"
    // when the budget cut the walk short (more roots may exist).
    const qualifier = budgetHit ? '≥' : ''
    logger.warn(
      `Bazel workspace walk found ${roots.length} workspace root(s); capping at ${MAX_WORKSPACE_ROOTS} and dropping ${qualifier}${droppedCount}.`,
    )
    if (verbose) {
      logger.log(
        '[VERBOSE] workspace walker: dropped roots:',
        roots.slice(MAX_WORKSPACE_ROOTS),
      )
    }
  }
  return kept
}
