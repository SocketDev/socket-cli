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
 * `.socket-auto-manifest`, build-output `dist*`).
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

// Hard ceiling on workspace roots; 16 sits well above realistic monorepo counts while tightening the guard against pathological inputs.
const MAX_WORKSPACE_ROOTS = 16
// Hard ceiling on directory walk depth. Deepest workspace marker observed
// across the OSS corpus surveyed is 9 (bazel-self test fixtures); deepest
// in realistic application code is 7 (checkmk's thirdparty layout). Cap
// is set to 8 — one level of headroom over the realistic max, while still
// guarding against pathological symlink loops that slipped past any
// prefix prune.
const MAX_WALK_DEPTH = 8
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
  // Directory basename prefixes to skip. Bazel callers pass `['bazel-',
  // 'dist']` so the walk never descends into Bazel's output_base symlinks
  // or build-output directories.
  ignoreDirPrefixes?: readonly string[]
  verbose?: boolean
}

const EMPTY_SET: ReadonlySet<string> = new Set()
const EMPTY_ARRAY: readonly string[] = []

// Walks the tree rooted at `opts.cwd` and returns absolute paths to every
// directory that contains at least one workspace marker file. Output is
// sorted for determinism.
export function findWorkspaceRoots(opts: FindWorkspaceRootsOptions): string[] {
  const { cwd, verbose } = opts
  const ignoreDirNames = opts.ignoreDirNames ?? EMPTY_SET
  const ignoreDirPrefixes = opts.ignoreDirPrefixes ?? EMPTY_ARRAY
  const out: string[] = []
  // Tuple stack: [absolute dir, depth from cwd].
  const stack: Array<[string, number]> = [[cwd, 0]]
  while (stack.length) {
    if (out.length >= MAX_WORKSPACE_ROOTS) {
      if (verbose) {
        logger.log(
          `[VERBOSE] workspace walker: hit MAX_WORKSPACE_ROOTS cap (${MAX_WORKSPACE_ROOTS}); truncating walk`,
        )
      }
      break
    }
    const next = stack.pop()
    if (!next) {
      break
    }
    const { 0: dir, 1: depth } = next
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    // First pass: detect whether this dir is itself a workspace root.
    let isWorkspaceRoot = false
    for (const entry of entries) {
      if (entry.isFile() && WORKSPACE_MARKER_FILES.has(entry.name)) {
        isWorkspaceRoot = true
        break
      }
    }
    if (isWorkspaceRoot) {
      out.push(dir)
    }
    // Second pass: schedule descents. We descend regardless of whether the
    // current dir is itself a root — nested workspaces are common in
    // monorepos (root MODULE.bazel + examples/*/MODULE.bazel).
    if (depth + 1 > MAX_WALK_DEPTH) {
      continue
    }
    for (const entry of entries) {
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
      if (pruned) {
        continue
      }
      stack.push([path.join(dir, name), depth + 1])
    }
  }
  return out.sort()
}
