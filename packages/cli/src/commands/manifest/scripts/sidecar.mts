import { mavenCoordinateKey } from './facts.mts'

import type { ResolvedArtifactPaths, SocketFactsSbom } from './facts.mts'

// Frozen contract with `coana run --compute-artifacts-sidecar`; change only in
// sync with the coana consumer. Per coordinate: targets/sources present →
// resolved, and coana uses the paths; both empty → a pom/BOM resolved with no
// artifact, not a failure; absent → coana resolves that coordinate itself,
// best-effort: local caches, then `mvn -Dtransitive=false dependency:get`,
// then HTTP.
//
// So the sidecar is an accelerator, not an authority. A coordinate we omit is
// not dropped from the scan — it is handed back to exactly the reach-time
// resolution this sidecar exists to avoid, at that path's cost and
// reliability. Treat a coverage gap as a correctness concern to surface, not
// as a silent fallback.
export type ResolvedComponent = {
  group: string
  name: string
  version: string
  ext: string
  // The serialized sidecar carries an explicit JSON null for "no classifier";
  // omitting the key would change the frozen contract.
  // socket-lint: allow prefer-undefined-over-null
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
  for (let i = 0, { length } = from; i < length; i += 1) {
    const f = from[i]!
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
  const coordKey = mavenCoordinateKey({
    groupId: group,
    artifactId: name,
    type: ext || undefined,
    classifier: classifier ?? undefined,
    version: version || undefined,
  })
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
      // oxlint-disable-next-line socket/prefer-undefined-over-null -- frozen sidecar contract serializes an explicit JSON null
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
      // oxlint-disable-next-line socket/prefer-undefined-over-null -- frozen sidecar contract serializes an explicit JSON null
      null,
    )
  }
}

export function serializeSidecar(
  acc: SidecarAccumulator,
): ResolvedPathsSidecar {
  const resolved = [...acc.values()]
  for (let i = 0, { length } = resolved; i < length; i += 1) {
    const entry = resolved[i]!
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
