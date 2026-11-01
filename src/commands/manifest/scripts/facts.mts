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

export type OutputPaths = {
  sources: string[]
  targets: string[]
}

// One entry of a classpath, in the order the JVM searches it.
export type ClasspathEntry =
  // An external artifact, by component id.
  | { id: string }
  // One output set (`main`, `test`, `testFixtures`, ...) of a build project.
  | { project: string; outputs: string }

// Resolved on-disk paths for a --with-files run, and each project's classpaths.
export type ResolvedArtifactPaths = {
  // External artifacts by component id: `targets` are their files, absent when
  // the artifact did not resolve.
  pathsById: Map<string, { targets?: string[] | undefined }>
  // Build projects' output sets by name, keyed by project id.
  outputsByProject: Map<string, Map<string, OutputPaths>>
  // Each project's classpaths by output set, keyed by project id.
  classpathsByProject: Map<string, Map<string, ClasspathEntry[]>>
  // Component ids of each project's direct dependencies, keyed by project id.
  directDependenciesByProject: Map<string, string[]>
}
