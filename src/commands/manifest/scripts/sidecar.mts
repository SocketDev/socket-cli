import type {
  AnyPURL,
  ResolvedArtifactPaths,
  SocketFactsSbom,
  SocketFactsSbomComponent,
  SocketFactsSbomProject,
} from './facts.mts'

export type SidecarComponentEntry = SocketFactsSbomComponent & {
  // Classpath entries (jars, or a sibling project's own build output dirs
  // when this component is that project). `[]` means resolved and found
  // nothing (e.g. a pom/BOM); undefined means paths were not resolved.
  targets?: string[] | undefined
  // First-party source roots; `[]` for a genuinely external dependency (still
  // attempted, nothing to find), not undefined.
  sources?: string[] | undefined
}

export type SidecarProjectEntry = SocketFactsSbomProject & {
  targets?: string[] | undefined
  sources?: string[] | undefined
  // Ids of this facts file's components[] forming the project's full
  // transitive classpath across all its configurations.
  classpath: string[]
}

// Frozen contract with `coana run --compute-artifacts-sidecar`; change only
// in sync with the coana consumer. Keyed by the absolute path of the
// `*.socket.facts.json` file whose own projects[]/components[] these entries
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

// `[]` means resolved and found nothing (e.g. a pom/BOM with no artifact).
function attachPaths<T extends { id: string }>(
  entry: T,
  artifactPaths: ResolvedArtifactPaths,
): T & { targets: string[]; sources: string[] } {
  const paths = artifactPaths.pathsById.get(entry.id)
  return {
    ...entry,
    targets: [...(paths?.targets ?? [])],
    sources: [...(paths?.sources ?? [])],
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
// Every build writes its own facts file, so a key is accumulated once; a
// repeated call for the same factsFile (the same build run again) overwrites.
export function accumulateSidecar(
  acc: SidecarAccumulator,
  facts: SocketFactsSbom,
  artifactPaths: ResolvedArtifactPaths,
  factsFile: string,
  // Off when artifact paths were not resolved; entries then omit `targets` and `sources`.
  withPaths = true,
): void {
  const paths = <T extends AnyPURL & { id: string }>(entry: T) =>
    withPaths ? attachPaths(entry, artifactPaths) : { ...entry }
  acc.set(factsFile, {
    components: facts.components.map(paths),
    projects: (facts.projects ?? []).map(proj => ({
      ...paths(proj),
      classpath: [...(artifactPaths.classpathByProject.get(proj.id) ?? [])],
    })),
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
