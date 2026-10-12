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
  dependencies?: SocketFactsSbomDependency[] | undefined
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
}

// Relative to the facts file's directory.
export type SocketFactsManifestReference = {
  file: string
}

// A component with one exact subtree, shared by every position whose subtree
// is identical.
export type SocketFactsSbomDependency = {
  // Index into components[].
  component: number
  // Indices into dependencies[].
  children?: number[] | undefined
}

export type SocketFactsSbomProject = AnyPURL & {
  // The build tool's own project identity, unique within the facts file:
  // Maven's GAV, Gradle's project path, sbt's project id.
  id: string
  subprojectDir: string
  // The build files the tool reports for the project, e.g. a POM other than
  // `<subprojectDir>/pom.xml`, or a Gradle build file absent on disk.
  manifestFiles?: SocketFactsManifestReference[] | undefined
  // Indices into dependencies[]: this subproject's direct dependencies.
  children: number[]
}

// Resolved on-disk paths for a --with-files run, keyed by component or project
// id (a project and its own component share one). `targets` = classpath
// entries (jars / module output dirs); `sources` = module source roots.
export type ResolvedArtifactPaths = {
  pathsById: Map<string, { sources: string[]; targets: string[] }>
  // Component ids on each project's resolved classpath (union over its
  // configurations), keyed by project id.
  classpathByProject: Map<string, string[]>
  // Component ids of each project's direct dependencies, keyed by project id.
  directDependenciesByProject: Map<string, string[]>
}
