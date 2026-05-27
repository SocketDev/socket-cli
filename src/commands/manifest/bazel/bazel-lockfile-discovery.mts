/**
 * Find and parse checked-in `maven_install.json` files anywhere under the
 * invocation cwd. This is the sub-workspace discovery path: rules_kotlin (and
 * any ruleset-style repo with per-example `MODULE.bazel` projects under
 * `examples/`) declares Maven artifacts in per-example lockfiles that the
 * root-MODULE.bazel-only bazel-query path never sees. The server-side
 * depscan parser already merges these files unconditionally; the CLI matches
 * that semantics here so its SBOM is not a strict subset of the server's.
 *
 * Security gates: each lockfile read is size-capped, the walk prunes dirs
 * that are obviously not Bazel workspaces (.git, node_modules, the
 * .socket-auto-manifest output dir), and the walk skips Bazel's `bazel-*`
 * convenience symlinks so we never recurse into <output_base> (which can
 * be tens of GiB and contains generated copies of the same lockfiles).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { parseUnsortedDepsJson } from './bazel-build-parser.mts'

import type { ExtractedArtifact } from './bazel-build-parser.mts'

// Cap any single checked-in lockfile read at 1 GiB. Matches the cap that
// extract_bazel_to_maven uses for generated `unsorted_deps.json` files so a
// hostile or malformed lockfile cannot OOM the CLI.
const MAX_LOCKFILE_BYTES = 1024 * 1024 * 1024
// Hard ceiling on number of lockfiles we will surface. Real monorepos have
// well under 50; this cap is a guard against pathological inputs.
const MAX_LOCKFILES = 256
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
// convenience symlinks all point into the output_base, which contains
// generated copies of the same lockfiles plus tens of GiB of build output.
const PRUNE_DIR_PREFIXES = ['bazel-']

// Walks the tree rooted at `cwd` and returns absolute paths to every
// checked-in `maven_install.json` file the walk reaches before hitting the
// MAX_LOCKFILES cap. Output is sorted for determinism.
export function findCheckedInMavenLockfiles(
  cwd: string,
  verbose?: boolean,
): string[] {
  const out: string[] = []
  // Tuple stack: [absolute dir, depth from cwd].
  const stack: Array<[string, number]> = [[cwd, 0]]
  while (stack.length) {
    if (out.length >= MAX_LOCKFILES) {
      if (verbose) {
        logger.log(
          `[VERBOSE] subworkspace: hit MAX_LOCKFILES cap (${MAX_LOCKFILES}); truncating walk`,
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
    for (const entry of entries) {
      const name = entry.name
      if (entry.isFile() && name === 'maven_install.json') {
        out.push(path.join(dir, name))
        continue
      }
      if (!entry.isDirectory()) {
        continue
      }
      if (depth + 1 > MAX_WALK_DEPTH) {
        continue
      }
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

// Reads a single checked-in `maven_install.json` and returns its artifacts.
// Defers parsing to `parseUnsortedDepsJson`, which already handles the
// rules_jvm_external v2 lockfile shape (the canonical checked-in form) as
// well as the legacy artifact-array shape. Tags each artifact with a
// synthetic `sourceRepo` derived from the lockfile's path relative to cwd
// so downstream dep-label resolution does not collide a lockfile-derived
// rule with a bazel-query-derived rule of the same name in a different
// sub-workspace.
export function readCheckedInMavenLockfile(
  file: string,
  cwd: string,
  verbose?: boolean,
): ExtractedArtifact[] {
  let size: number
  try {
    size = statSync(file).size
  } catch {
    return []
  }
  if (size > MAX_LOCKFILE_BYTES) {
    if (verbose) {
      logger.log(
        `[VERBOSE] subworkspace: skip oversized lockfile ${file} (${size} bytes; cap ${MAX_LOCKFILE_BYTES})`,
      )
    }
    return []
  }
  let json: string
  try {
    json = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const artifacts = parseUnsortedDepsJson(json)
  const relPath = path.relative(cwd, file)
  // Use the directory containing the lockfile (relative to cwd) so two
  // lockfiles in different sub-workspaces get distinct synthetic repo tags.
  // For the root-cwd lockfile, relative dir is '' and the tag collapses to
  // `lockfile:.` — harmless and still distinct from real repo names.
  const repoTag = `lockfile:${path.dirname(relPath) || '.'}`
  const out: ExtractedArtifact[] = []
  for (const a of artifacts) {
    out.push({ ...a, sourceRepo: a.sourceRepo ?? repoTag })
  }
  return out
}

// Convenience composition: find all checked-in lockfiles under cwd, parse
// each, and return a flat list of artifacts deduplicated by
// `mavenCoordinates`. The dedup is intentionally coarse: two lockfiles in
// different sub-workspaces that pin the same `group:artifact:version`
// contribute one entry; conflicting versions for the same `group:artifact`
// are NOT resolved here and will surface as the existing `Conflicting
// versions for ...` error in `normalizeToMavenInstallJson` downstream
// (preserving today's loud-failure behavior for genuine version conflicts).
export function discoverAllCheckedInMavenArtifacts(
  cwd: string,
  verbose?: boolean,
): { artifacts: ExtractedArtifact[]; lockfilePaths: string[] } {
  const lockfilePaths = findCheckedInMavenLockfiles(cwd, verbose)
  const seenCoords = new Set<string>()
  const artifacts: ExtractedArtifact[] = []
  for (const file of lockfilePaths) {
    const fromFile = readCheckedInMavenLockfile(file, cwd, verbose)
    let merged = 0
    for (const a of fromFile) {
      if (seenCoords.has(a.mavenCoordinates)) {
        continue
      }
      seenCoords.add(a.mavenCoordinates)
      artifacts.push(a)
      merged += 1
    }
    if (verbose) {
      logger.log(
        `[VERBOSE] subworkspace: lockfile ${path.relative(cwd, file)} contributed ${merged} new artifact(s) (file had ${fromFile.length})`,
      )
    }
  }
  return { artifacts, lockfilePaths }
}
