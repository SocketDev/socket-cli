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
  tool: 'dotnet' | 'gradle' | 'maven' | 'sbt'
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
  // Maven's GAV, Gradle's project path, sbt's project id, the project file's
  // build-root-relative path for dotnet.
  id: string
  subprojectDir: string
  // The build files the tool reports for the project, e.g. a POM other than
  // `<subprojectDir>/pom.xml`, or a Gradle build file absent on disk.
  manifestFiles?: SocketFactsManifestReference[] | undefined
  // Indices into dependencies[]: this subproject's direct dependencies.
  children: number[]
}

// One dotnet build of a project: a target framework, and a runtime where
// restore resolved one. `framework` is the NuGet short folder name, `alias` the
// project's own name for it; ids are those of the facts file's components.
export type ProjectFramework = {
  alias: string
  framework: string
  runtime?: string | undefined
  targetFrameworkMoniker?: string | undefined
  language?: string | undefined
  langVersion?: string | undefined
  nullable?: string | undefined
  assemblyName?: string | undefined
  frameworkReferences: string[]
  // As evaluated: the SDK's implicit framework symbols (NET8_0_OR_GREATER,
  // ...) are absent.
  defineConstants: string[]
  usings: Array<{ namespace: string; alias?: string; static?: true }>
  // In compiler order, as evaluated: sources that build targets generate
  // are absent.
  sources: string[]
  targets: string[]
  dependencies: string[]
  classpath: string[]
}

// A package's runtime assemblies in one target framework (and runtime); no
// `targets` when restore's assemblies for it are missing.
export type ComponentFramework = {
  framework: string
  runtime?: string | undefined
  targets?: string[] | undefined
  // What the project's sources compile against (often reference assemblies).
  compile?: string[] | undefined
}

// Resolved on-disk paths for a --with-files run, keyed by component or project
// id (a project and its own component share one). `targets` = classpath
// entries (jars / module output dirs), absent when the component's artifact
// did not resolve; `sources` = module source roots.
export type ResolvedArtifactPaths = {
  pathsById: Map<string, { sources: string[]; targets?: string[] | undefined }>
  // Component ids on each project's resolved classpath (union over its
  // configurations), keyed by project id. A component on no classpath, such as
  // a Maven 4 `none` dependency, is in the SBOM but not here.
  classpathByProject: Map<string, string[]>
  // Component ids of each project's direct dependencies on its classpath, keyed
  // by project id.
  directDependenciesByProject: Map<string, string[]>
  // dotnet only: the same per target framework.
  frameworksByProject?: Map<string, ProjectFramework[]> | undefined
  frameworksById?: Map<string, ComponentFramework[]> | undefined
}
