/**
 * Maven manifest normalization + writing for the Bazel extractor: dedup of
 * extracted artifacts, `maven_install.json` synthesis, the committed-lockfile
 * coverage gate, and the per-hub manifest writer.
 */
import { mkdirSync, promises as fs, readdirSync } from 'node:fs'
import path from 'node:path'

import type { ExtractedArtifact } from './bazel-cquery.mts'
import type { Dirent } from 'node:fs'

export type CoordPair = { groupArtifact: string; version: string }

export type MavenInstallJsonCurrent = {
  artifacts: Record<string, { version: string }>
  dependencies: Record<string, string[]>
  repositories?: Record<string, string[]> | undefined
}

export type NormalizeResult = {
  json: MavenInstallJsonCurrent
  // Versionless keys skipped because the coordinate was malformed (key shape
  // outside 2-4 non-empty segments, or an empty version). Known data loss.
  droppedArtifacts: string[]
  // `source -> target` edges pruned because one endpoint wasn't an emitted
  // artifact. Known data loss.
  prunedEdges: string[]
}

export type WriteHubManifestResult = {
  artifactCount: number
  droppedArtifacts: string[]
  manifestPath: string | undefined
  prunedEdges: string[]
}

// Directory basenames the CLI itself writes synthetic manifests into. A file
// living inside one of these is our own output, NOT a committed lockfile, no
// matter which run wrote it: the auto-manifest sibling dir (flat layout) and
// the explicit-command default output dir. The gate must never read a file in
// one of these as evidence of committed coverage, or a stale prior-run
// synthetic file would let a later run wrongly skip a hub.
const CLI_SYNTHETIC_OUTPUT_DIR_NAMES: ReadonlySet<string> = new Set([
  '.socket-auto-manifest',
  'bazel-manifests',
])

// Does a committed lockfile already cover THIS hub at THIS hub's own workspace
// root? Each workspace is processed independently by the caller, and a
// committed lockfile covers the workspace it lives IN — a nested workspace's
// `maven_install.json` covers that nested hub, not this one. The server-side
// walker ingests every committed `**/*_maven_install.json`, but each one only
// covers its own workspace. So the gate checks DEPTH-0 only: a lockfile named
// for this hub sitting directly in `workspaceRoot`. A recursive descent would
// let an unrelated nested/fixture lockfile mask an uncovered root hub —
// silently dropping its distinct coordinates.
//
// The CLI's own synthetic output is never a committed lockfile: we skip the
// current run's `manifestDir` and any known synthetic output dir basename so a
// stale prior-run file can't be misread as committed.
export function committedLockfileCovers(config: {
  fileName: string
  manifestDir: string
  workspaceRoot: string
}): string | undefined {
  const { fileName, manifestDir, workspaceRoot } = {
    __proto__: null,
    ...config,
  } as typeof config
  // The current run's synthetic output dir, resolved for an exact compare.
  const manifestDirResolved = path.resolve(manifestDir)
  const workspaceRootResolved = path.resolve(workspaceRoot)
  // The committed lockfile, if any, lives directly in the hub's own workspace
  // root — not in a nested workspace and not in the CLI's output dir.
  if (
    workspaceRootResolved === manifestDirResolved ||
    CLI_SYNTHETIC_OUTPUT_DIR_NAMES.has(path.basename(workspaceRootResolved))
  ) {
    // The workspace root IS an output location; nothing here is committed.
    return undefined
  }
  let entries: Dirent[]
  try {
    entries = readdirSync(workspaceRootResolved, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (entry.isFile() && entry.name === fileName) {
      return path.join(workspaceRootResolved, entry.name)
    }
  }
  return undefined
}

// Cross-workspace dedup keyed on the full Maven coordinate string
// (`g:a:v[:classifier]`). The metadata cquery emits one entry per rule,
// so the same `androidx.annotation:annotation:1.8.2` can show up in
// `examples/dagger/@maven` and `examples/ksp/@maven` in rules_kotlin —
// downstream only needs it once. Each occurrence resolves its edges against
// its own repo's targets, so the resolved `deps` can legitimately differ
// between occurrences; union them rather than keeping only the first, or
// real graph edges would be silently dropped.
export function dedupArtifactsByCoord(
  artifacts: ExtractedArtifact[],
): ExtractedArtifact[] {
  const byCoord = new Map<string, ExtractedArtifact>()
  for (let i = 0, { length } = artifacts; i < length; i += 1) {
    const a = artifacts[i]!
    const existing = byCoord.get(a.mavenCoordinates)
    if (!existing) {
      byCoord.set(a.mavenCoordinates, { ...a, deps: [...a.deps] })
      continue
    }
    const merged = new Set(existing.deps)
    for (let j = 0, depCount = a.deps.length; j < depCount; j += 1) {
      merged.add(a.deps[j]!)
    }
    existing.deps = [...merged]
  }
  return [...byCoord.values()]
}

// The committed lockfile name the server-side walker already ingests for a
// hub: `maven_install.json` for a hub literally named `maven`, else
// `<hub>_maven_install.json`. Centralised so the gate and the synthetic
// writer agree on the name.
export function hubManifestFileName(repoName: string): string {
  return repoName === 'maven'
    ? 'maven_install.json'
    : `${repoName}_maven_install.json`
}

// A versionless `maven_install.json` key must have 2-4 non-empty
// colon-separated segments (`g:a`, `g:a:ext`, `g:a:ext:classifier`) — exactly
// the range the server parser's `coordinateToParts` accepts. A key outside
// that range, or with an empty segment, is rejected after upload, so reject
// it locally.
export function isValidVersionlessKey(key: string): boolean {
  const parts = key.split(':')
  if (parts.length < 2 || parts.length > 4) {
    return false
  }
  return parts.every(p => p.length > 0)
}

// Builds a modern `maven_install.json` from artifacts whose `deps` already
// hold resolved versionless coordinates (the cquery parser resolves edge
// labels against each repo's own targets while `repoName` is in scope, so no
// label-to-coordinate resolution happens here). Keys are versionless `g:a`
// (preserving any packaging/classifier segments); dependency values are the
// resolved coordinate sets.
//
// Two-phase so the emitted graph is internally closed and survives the server
// parser, which rejects malformed coordinates and edges referencing unlisted
// artifacts (and can abort after enough errors). Phase 1 builds (and
// validates) the artifact keys; phase 2 emits only edges whose source AND
// target are valid emitted keys. Anything dropped is reported so the caller
// can flip the hub partial — never silently lost post-upload.
export function normalizeToMavenInstallJson(
  artifacts: ExtractedArtifact[],
): NormalizeResult {
  const out: MavenInstallJsonCurrent = {
    artifacts: {},
    dependencies: {},
  }
  const droppedArtifacts: string[] = []
  const prunedEdges: string[] = []
  const versionsByGroupArtifact = new Map<string, string>()
  // Phase 1: artifacts. Validate each key (shape + non-empty version) before
  // accepting it; record the set of valid emitted keys.
  const depsByKey = new Map<string, Set<string>>()
  for (let i = 0, { length } = artifacts; i < length; i += 1) {
    const a = artifacts[i]!
    const split = splitCoord(a.mavenCoordinates)
    if (!split) {
      droppedArtifacts.push(a.mavenCoordinates)
      continue
    }
    const key = split.groupArtifact
    // A `g:a:` coordinate strips to the valid-shaped key `g:a` but an empty
    // version, which the server rejects — require both.
    if (!isValidVersionlessKey(key) || !split.version) {
      droppedArtifacts.push(a.mavenCoordinates)
      continue
    }
    const existingVersion = versionsByGroupArtifact.get(key)
    if (existingVersion && existingVersion !== split.version) {
      throw new Error(
        `Conflicting versions for ${key}: ${existingVersion}, ${split.version}. The generated maven_install.json cannot represent multiple versions for the same group:artifact losslessly.`,
      )
    }
    if (!existingVersion) {
      versionsByGroupArtifact.set(key, split.version)
      out.artifacts[key] = { version: split.version }
    }
    // Accumulate the candidate edge set keyed by "g:a" (no version), matching
    // the canonical rules_jvm_external lockfile shape. Pruned against valid
    // keys in phase 2.
    const depCoords = depsByKey.get(key) ?? new Set<string>()
    for (let j = 0, depCount = a.deps.length; j < depCount; j += 1) {
      depCoords.add(a.deps[j]!)
    }
    if (depCoords.size) {
      depsByKey.set(key, depCoords)
    }
  }
  // Phase 2: edges. Emit only where both source and target are emitted keys.
  const validKeys = new Set(Object.keys(out.artifacts))
  for (const { 0: key, 1: depCoords } of depsByKey) {
    if (!validKeys.has(key)) {
      for (const target of depCoords) {
        prunedEdges.push(`${key} -> ${target}`)
      }
      continue
    }
    const kept: string[] = []
    for (const target of depCoords) {
      if (validKeys.has(target)) {
        kept.push(target)
      } else {
        prunedEdges.push(`${key} -> ${target}`)
      }
    }
    if (kept.length) {
      out.dependencies[key] = kept
    }
  }
  return { droppedArtifacts, json: out, prunedEdges }
}

// Splits "g:a:v" -> { groupArtifact: "g:a", version: "v" }.
// Returns undefined on malformed input.
export function splitCoord(c: string): CoordPair | undefined {
  const lastColon = c.lastIndexOf(':')
  if (lastColon < 1) {
    return undefined
  }
  return {
    groupArtifact: c.slice(0, lastColon),
    version: c.slice(lastColon + 1),
  }
}

// Dedup, normalize, and write one hub's manifest. The path mirrors the
// workspace tree: `<manifestDir>/<relPath>/<name>.json`, where `<name>` is
// `maven_install.json` for a hub literally named `maven`, else
// `<hub>_maven_install.json` (matching the server walker's
// `**/*_maven_install.json` glob). The root workspace (`relPath===''`) writes
// at `<manifestDir>/<name>.json`. Returns `manifestPath: undefined` (no file
// written) when the hub yields zero valid artifacts, plus the dropped/pruned
// accounting so the caller can flip the hub partial.
export async function writeHubManifest(config: {
  artifacts: ExtractedArtifact[]
  manifestDir: string
  relPath: string
  repoName: string
}): Promise<WriteHubManifestResult> {
  const { artifacts, manifestDir, relPath, repoName } = {
    __proto__: null,
    ...config,
  } as typeof config
  const deduped = dedupArtifactsByCoord(artifacts)
  const { droppedArtifacts, json, prunedEdges } =
    normalizeToMavenInstallJson(deduped)
  const artifactCount = Object.keys(json.artifacts).length
  if (!artifactCount) {
    return {
      artifactCount: 0,
      droppedArtifacts,
      manifestPath: undefined,
      prunedEdges,
    }
  }
  const fileName = hubManifestFileName(repoName)
  const hubDir = relPath ? path.join(manifestDir, relPath) : manifestDir
  mkdirSync(hubDir, { recursive: true })
  const manifestPath = path.join(hubDir, fileName)
  await fs.writeFile(manifestPath, JSON.stringify(json, null, 2), 'utf8')
  return { artifactCount, droppedArtifacts, manifestPath, prunedEdges }
}
