import { mavenCoordinateKey } from './facts.mts'

import type { ResolvedArtifactPaths, SocketFactsSbom } from './facts.mts'

// Frozen contract with `coana run --compute-artifacts-sidecar`; change only in
// sync with the coana consumer. Per coordinate: targets/sources present →
// resolved (coana uses the paths); both empty → resolved with no artifact
// (pom/BOM), not a failure; absent → coana degrades that vuln to precomputed.
export type ResolvedComponent = {
  group: string
  name: string
  version: string
  ext: string
  classifier: string | null
  // Classpath entries (jars / first-party output dirs).
  targets: string[]
  // First-party source roots; [] for external deps.
  sources: string[]
}

// Bare array, no schema version: socket-cli pins the coana version, so producer
// and consumer never drift.
export type ResolvedPathsSidecar = ResolvedComponent[]

// Keyed by full coordinate; unions paths so multiple build roots merge into one.
export type SidecarAccumulator = Map<string, ResolvedComponent>

function pushUnique(into: string[], from: string[]): void {
  for (const f of from) {
    if (!into.includes(f)) {
      into.push(f)
    }
  }
}

function addEntry(
  acc: SidecarAccumulator,
  artifactPaths: ResolvedArtifactPaths,
  group: string,
  name: string,
  version: string,
  ext: string,
  classifier: string | null,
): void {
  const coordKey = mavenCoordinateKey(
    group,
    name,
    ext || undefined,
    classifier ?? undefined,
    version || undefined,
  )
  if (!coordKey) {
    return
  }
  let entry = acc.get(coordKey)
  if (!entry) {
    entry = { group, name, version, ext, classifier, targets: [], sources: [] }
    acc.set(coordKey, entry)
  }
  pushUnique(entry.targets, artifactPaths.targetsByCoord.get(coordKey) ?? [])
  pushUnique(entry.sources, artifactPaths.sourcesByCoord.get(coordKey) ?? [])
}

// Emit an entry for every SBOM component AND every first-party project: a
// top-level module is a project, not a dependency component, yet its source
// roots are where reachability starts, so the sidecar must carry them.
export function accumulateSidecar(
  acc: SidecarAccumulator,
  facts: SocketFactsSbom,
  artifactPaths: ResolvedArtifactPaths,
): void {
  for (const comp of facts.components) {
    addEntry(
      acc,
      artifactPaths,
      comp.namespace ?? '',
      comp.name,
      comp.version ?? '',
      comp.qualifiers?.['ext'] ?? '',
      comp.qualifiers?.['classifier'] ?? null,
    )
  }
  // First-party modules have no ext/classifier.
  for (const proj of facts.projects ?? []) {
    addEntry(
      acc,
      artifactPaths,
      proj.namespace ?? '',
      proj.name,
      proj.version ?? '',
      '',
      null,
    )
  }
}

export function serializeSidecar(
  acc: SidecarAccumulator,
): ResolvedPathsSidecar {
  const resolved = [...acc.values()]
  for (const entry of resolved) {
    entry.targets.sort()
    entry.sources.sort()
  }
  resolved.sort((a, b) => {
    const ka = `${a.group}:${a.name}:${a.ext}:${a.classifier ?? ''}:${a.version}`
    const kb = `${b.group}:${b.name}:${b.ext}:${b.classifier ?? ''}:${b.version}`
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
  return resolved
}
