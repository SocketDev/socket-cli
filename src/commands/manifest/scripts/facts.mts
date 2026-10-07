export type AnyPURL = {
  type: string
  namespace?: string | undefined
  name: string
  version?: string | undefined
  qualifiers?: Record<string, string> | undefined
}

// No sources/targets here: those are local absolute paths, returned in-memory
// as ResolvedArtifactPaths, never serialized into the SBOM.
export type SocketFactsSbom = {
  metadata?: SocketFactsSbomMetadata | undefined
  projects?: SocketFactsSbomProject[] | undefined
  components: SocketFactsSbomComponent[]
}

export type SocketFactsSbomMetadata = {
  format: 'socket-facts-sbom'
  tool: 'gradle' | 'maven' | 'sbt'
  toolVersion: string
  javaVersion?: string | undefined
  // Lets a facts file be traced back to the generator release that produced it.
  socketCliVersion?: string | undefined
}

export type SocketFactsSbomComponent = AnyPURL & {
  id: string
  direct?: boolean | undefined
  dev?: boolean | undefined
  // A module of the scanned build itself (same GAV as a projects[] entry).
  firstParty?: true | undefined
  dependencies?: string[] | undefined
  // Direct dependencies only: the facts file plus the build files of the subprojects
  // pulling it in directly, which need not declare it (e.g. a parent POM does).
  manifestFiles?: SocketFactsManifestReference[] | undefined
}

// Relative to the facts file's directory.
export type SocketFactsManifestReference = {
  file: string
}

export type SocketFactsSbomProject = AnyPURL & {
  // The build tool's own project identity, unique within the facts file:
  // Maven's GAV, Gradle's project path, sbt's project id.
  id: string
  subprojectDir: string
  dependencies: string[]
  // The module's own build files, e.g. a POM other than `<subprojectDir>/pom.xml`.
  manifestFiles?: SocketFactsManifestReference[] | undefined
}

// Resolved on-disk paths for a --with-files run, keyed by coordinate. `targets`
// = classpath entries (jars / module output dirs); `sources` = module source
// roots.
export type ResolvedArtifactPaths = {
  targetsByCoord: Map<string, string[]>
  // ext/classifier-agnostic, to recover the variant when an ingested ext is
  // untrustworthy (Gradle lockfile / version-catalog hardcode ext=jar).
  targetsByGav: Map<string, string[]>
  sourcesByCoord: Map<string, string[]>
  coords: Set<string>
  // Component ids on each project's resolved classpath (union over its
  // configurations), keyed by project id.
  classpathByProject: Map<string, string[]>
}

// Coordinate-based (not `id`-based) so it also matches foreign SBOMs like
// CycloneDX. Empty segments dropped.
export function mavenCoordinateKey(
  groupId: string | undefined,
  artifactId: string | undefined,
  type: string | undefined,
  classifier: string | undefined,
  version: string | undefined,
): string {
  return [groupId, artifactId, type, classifier, version]
    .filter(Boolean)
    .join(':')
}
