/**
 * Walk the directory tree rooted at `cwd` and return every directory that
 * looks like a Bazel workspace root — i.e. contains `MODULE.bazel`,
 * `WORKSPACE`, or `WORKSPACE.bazel`. Real monorepos host multiple roots
 * (e.g. `envoy/mobile/MODULE.bazel`, rules_kotlin's per-example
 * `examples/<name>/MODULE.bazel`); the per-workspace algorithm in the
 * orchestrator runs once per discovered root.
 *
 * Pruning matches the now-deleted `bazel-lockfile-discovery.mts`: skip
 * directories that obviously aren't Bazel workspaces (`.git`, `node_modules`,
 * `.socket-auto-manifest`, etc.) and Bazel's `bazel-*` convenience symlinks
 * that point into <output_base> (tens of GiB of generated state). Also
 * prunes `dist*` build-output directories.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

// Hard ceiling on number of workspace roots we will surface. Real monorepos
// have well under 50; this cap is a guard against pathological inputs.
const MAX_WORKSPACE_ROOTS = 256
// Hard ceiling on directory walk depth. Real workspaces nest <8 deep; the
// cap protects against pathological symlink loops that slipped past the
// `bazel-*` prefix prune.
const MAX_WALK_DEPTH = 16
// Directory basenames the walk refuses to descend into. None of these
// contain Bazel workspaces, and node_modules / .git can be enormous.
const PRUNE_DIR_NAMES = new Set([
  '.git',
  '.hg',
  '.idea',
  '.pnpm-store',
  '.socket-auto-manifest',
  '.svn',
  '.vscode',
  'node_modules',
])
// Directory basename prefixes the walk refuses to descend into. Bazel's
// `bazel-out`, `bazel-bin`, `bazel-testlogs`, and `bazel-<workspace>`
// convenience symlinks all point into the output_base. `dist`-prefixed
// directories are build artefacts, not workspaces.
const PRUNE_DIR_PREFIXES = ['bazel-', 'dist']
// Files whose presence promotes a directory to a workspace root.
const WORKSPACE_MARKER_FILES = new Set([
  'MODULE.bazel',
  'WORKSPACE',
  'WORKSPACE.bazel',
])

// Walks the tree rooted at `cwd` and returns absolute paths to every
// directory that contains at least one workspace marker file. Output is
// sorted for determinism.
export function findWorkspaceRoots(cwd: string, verbose?: boolean): string[] {
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
      if (PRUNE_DIR_NAMES.has(name)) {
        continue
      }
      let pruned = false
      for (const prefix of PRUNE_DIR_PREFIXES) {
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
