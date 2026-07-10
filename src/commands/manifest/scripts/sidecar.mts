import { mavenCoordinateKey } from './facts.mts'

import type { ResolvedArtifactPaths, SocketFactsSbom } from './facts.mts'
import type { PURL_Type } from '../../../utils/ecosystem.mts'

// Frozen contract with `coana run --compute-artifacts-sidecar`; change only in
// sync with the coana consumer. Per coordinate: targets/sources present →
// resolved (coana uses the paths); both empty → resolved with no artifact
// (pom/BOM, or a nuget package with no runtime assemblies — the fail-closed
// producer guarantees empty never means "missing"); absent → coana degrades
// that vuln to precomputed.
//
// The producer ALWAYS tags `ecosystem` (strict producer); the consumer treats
// a missing tag as `maven` (liberal consumer), so a hand-written or older
// sidecar still parses. Every consumer reads only its own ecosystem's entries.
export type ResolvedComponent = {
  group: string
  name: string
  version: string
  ext: string
  classifier: string | null
  // The artifact's purl `type`, carried verbatim as the ecosystem
  // discriminator each consumer filters on ('maven' for gradle/sbt/maven,
  // 'nuget' for dotnet). It is exactly the facts component's `type` (the
  // shared PURL_Type), so no narrowing or re-derivation; coana validates the
  // supported set (fail-loud on an unknown ecosystem, never a silent relabel).
  ecosystem: PURL_Type
  // Classpath entries (jars / first-party output dirs) — for nuget, runtime
  // (lib/) assemblies and first-party build outputs.
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
  ecosystem: PURL_Type,
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
  // Namespaced by ecosystem so a groupless nuget coordinate can never merge
  // with a maven one; the wire format carries the ecosystem tag itself.
  const accKey = `${ecosystem}|${coordKey}`
  let entry = acc.get(accKey)
  if (!entry) {
    entry = {
      group,
      name,
      version,
      ext,
      classifier,
      ecosystem,
      targets: [],
      sources: [],
    }
    acc.set(accKey, entry)
  }
  pushUnique(entry.targets, artifactPaths.targetsByCoord.get(coordKey) ?? [])
  pushUnique(entry.sources, artifactPaths.sourcesByCoord.get(coordKey) ?? [])
}

// Emit an entry for every SBOM component AND every first-party project: a
// top-level module is a project, not a dependency component, yet its source
// roots are where reachability starts, so the sidecar must carry them. The
// ecosystem is each artifact's own purl `type`, passed through verbatim.
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
      comp.type,
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
      proj.type,
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
