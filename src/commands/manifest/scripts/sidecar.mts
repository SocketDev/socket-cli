import { mavenCoordinateKey } from './facts.mts'

import type {
  AnyPURL,
  ResolvedArtifactPaths,
  SocketFactsSbom,
  SocketFactsSbomComponent,
  SocketFactsSbomProject,
} from './facts.mts'

export type SidecarComponentEntry = SocketFactsSbomComponent & {
  // Classpath entries (jars, or a sibling first-party project's own build
  // output dirs when this dependency edge resolves to one - REA-687). `[]`
  // means resolution was attempted and found nothing (e.g. a pom/BOM);
  // undefined means resolution couldn't be attempted at all (see attachPaths).
  targets?: string[] | undefined
  // First-party source roots; `[]` for a genuinely external dependency (still
  // attempted, nothing to find), not undefined.
  sources?: string[] | undefined
}

export type SidecarProjectEntry = SocketFactsSbomProject & {
  targets?: string[] | undefined
  sources?: string[] | undefined
}

// Frozen contract with `coana run --compute-artifacts-sidecar`; change only
// in sync with the coana consumer. Keyed by the absolute path of the
// `.socket.facts.json` file whose own projects[]/components[] these entries
// describe - the key IS the scope, so two independent reactors that happen to
// emit the same purl identity (e.g. a shared internal module name) can never
// collide: each is only ever looked up within its own key. No cross-reactor
// deduplication - the same external dependency resolved by several
// independent reactors is intentionally duplicated across all of their
// components[].
export type ResolvedPathsSidecar = Record<
  string,
  {
    // This facts file's own first-party modules.
    projects: SidecarProjectEntry[]
    // This reactor's dependency-position entries: genuinely external
    // artifacts, and dependency edges that resolve to a sibling first-party
    // project (reported via that project's own source/target roots instead
    // of a jar path).
    components: SidecarComponentEntry[]
  }
>

export type SidecarAccumulator = Map<
  string,
  { projects: SidecarProjectEntry[]; components: SidecarComponentEntry[] }
>

// `targets`/`sources` present (possibly `[]`) means resolution was attempted
// for this coordinate - an empty array is a successful resolve that found
// nothing (e.g. a pom/BOM with no artifact), not a failure. Both fields
// omitted (undefined) means resolution couldn't even be attempted - the only
// case here is a degenerate entry with no computable coordinate at all, since
// every entry reaching this function already came from a resolved graph node
// (an unresolved dependency lives in the resolution report, not here).
function attachPaths<T extends AnyPURL>(
  entry: T,
  artifactPaths: ResolvedArtifactPaths,
): T & { targets?: string[] | undefined; sources?: string[] | undefined } {
  const coordKey = mavenCoordinateKey(
    entry.namespace,
    entry.name,
    entry.qualifiers?.['ext'],
    entry.qualifiers?.['classifier'],
    entry.version,
  )
  if (!coordKey) {
    return { ...entry }
  }
  return {
    ...entry,
    targets: [...(artifactPaths.targetsByCoord.get(coordKey) ?? [])].sort(),
    sources: [...(artifactPaths.sourcesByCoord.get(coordKey) ?? [])].sort(),
  }
}

function purlSortKey(entry: AnyPURL): string {
  return `${entry.type}:${entry.namespace ?? ''}:${entry.name}:${entry.version ?? ''}:${entry.qualifiers?.['ext'] ?? ''}:${entry.qualifiers?.['classifier'] ?? ''}`
}

function sortByPurl<T extends AnyPURL>(entries: T[]): T[] {
  return entries.sort((a, b) => {
    const ka = purlSortKey(a)
    const kb = purlSortKey(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
}

// Emit an entry for every SBOM component AND every first-party project: a
// top-level module is a project, not a dependency component, yet its source
// roots are where reachability starts, so the sidecar must carry them.
// A second call for the same factsFile (a dual-marker directory where two
// build tools both target it) overwrites rather than merges, matching the
// existing last-writer-wins convention for that case.
export function accumulateSidecar(
  acc: SidecarAccumulator,
  facts: SocketFactsSbom,
  artifactPaths: ResolvedArtifactPaths,
  factsFile: string,
): void {
  acc.set(factsFile, {
    components: facts.components.map(comp => attachPaths(comp, artifactPaths)),
    projects: (facts.projects ?? []).map(proj =>
      attachPaths(proj, artifactPaths),
    ),
  })
}

export function hasResolvedPathsSidecarEntries(
  sidecar: ResolvedPathsSidecar,
): boolean {
  return Object.keys(sidecar).length > 0
}

export function hasSidecarEntries(acc: SidecarAccumulator): boolean {
  return acc.size > 0
}

// Combines two already-serialized sidecars (e.g. the recursive-discovery path
// and the plain conda/bazel auto-manifest path). Keys are already scoped to
// one facts file each and can't collide between the two inputs in practice,
// so this is a plain merge; the later input wins on a genuine key collision.
export function mergeResolvedPathsSidecars(
  a: ResolvedPathsSidecar,
  b: ResolvedPathsSidecar,
): ResolvedPathsSidecar {
  return { __proto__: null, ...a, ...b } as unknown as ResolvedPathsSidecar
}

export function serializeSidecar(
  acc: SidecarAccumulator,
): ResolvedPathsSidecar {
  const result = { __proto__: null } as unknown as ResolvedPathsSidecar
  for (const factsFile of [...acc.keys()].sort()) {
    const bucket = acc.get(factsFile)!
    result[factsFile] = {
      projects: sortByPurl(bucket.projects),
      components: sortByPurl(bucket.components),
    }
  }
  return result
}
