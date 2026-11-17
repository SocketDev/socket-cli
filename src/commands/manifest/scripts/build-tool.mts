import {
  accessSync,
  existsSync,
  constants as fsConstants,
  statSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

import type { FactsOnlyTypes } from '../../../utils/coana.mts'
import type { PURL_Type } from '../../../utils/ecosystem.mts'
import type { BuildRoot } from '../discover-manifest-roots.mts'

export type BuildTool = 'dotnet' | 'gradle' | 'maven' | 'sbt'

// The purl type of the packages each tool resolves; exhaustive, so a new tool
// cannot silently produce another ecosystem's purls.
export const PURL_TYPE_BY_TOOL: Record<BuildTool, PURL_Type> = {
  __proto__: null,
  dotnet: 'nuget',
  gradle: 'maven',
  maven: 'maven',
  sbt: 'maven',
} as unknown as Record<BuildTool, PURL_Type>

export const BUILD_TOOLS = Object.keys(PURL_TYPE_BY_TOOL) as BuildTool[]

export const ECOSYSTEM_LABELS: Record<BuildTool, string> = {
  __proto__: null,
  dotnet: '.NET',
  gradle: 'Gradle',
  maven: 'Maven',
  sbt: 'sbt',
} as unknown as Record<BuildTool, string>

export const FACTS_PURL_TYPES = [
  ...new Set(Object.values(PURL_TYPE_BY_TOOL)),
].sort() as unknown as FactsOnlyTypes

export function buildRootPath(root: BuildRoot): string {
  return join(root.dir, root.entryFile ?? '')
}

export function buildToolsFor(purlTypes: readonly PURL_Type[]): BuildTool[] {
  return BUILD_TOOLS.filter(tool => purlTypes.includes(PURL_TYPE_BY_TOOL[tool]))
}

export function buildToolLabelsFor(purlTypes: readonly PURL_Type[]): string[] {
  return buildToolsFor(purlTypes).map(tool => ECOSYSTEM_LABELS[tool])
}

const BUILD_TOOL_PATH_ENV: Record<BuildTool, string> = {
  __proto__: null,
  gradle: 'SOCKET_CLI_GRADLE_PATH',
  maven: 'SOCKET_CLI_MAVEN_PATH',
  sbt: 'SOCKET_CLI_SBT_PATH',
} as unknown as Record<BuildTool, string>

function validatedEnvBuildToolPath(
  tool: BuildTool,
  projectDir: string,
): string {
  const envName = BUILD_TOOL_PATH_ENV[tool]
  const selected = process.env[envName]
  if (!selected) {
    throw new Error(
      `Standalone Socket does not support ${tool} manifest execution without ${envName}: JVM runtime and toolchain assets are not bundled.`,
    )
  }
  const executable = resolve(projectDir, selected)
  return validateExecutablePath(envName, selected, executable)
}

function validateExecutablePath(
  envName: string,
  selected: string,
  executable: string,
): string {
  try {
    if (!statSync(executable).isFile()) {
      throw new Error('not a regular file')
    }
    accessSync(executable, fsConstants.X_OK)
    return executable
  } catch {
    throw new Error(
      `${envName} must point to a regular executable file; received '${selected}'.`,
    )
  }
}

// PATH fallback when no `bin` and no project wrapper.
const DEFAULT_BUILD_TOOL_BIN: Record<BuildTool, string> = {
  __proto__: null,
  dotnet: 'dotnet',
  gradle: 'gradle',
  maven: 'mvn',
  sbt: 'sbt',
} as unknown as Record<BuildTool, string>

// Project-local wrapper, preferred because it pins the expected build-tool
// version. sbt has no wrapper convention. POSIX names only (no win32 target).
const BUILD_TOOL_WRAPPER = {
  __proto__: null,
  gradle: 'gradlew',
  maven: 'mvnw',
} as unknown as Partial<Record<BuildTool, string>>

// Maven (`mvn --file`) and dotnet (`dotnet restore <file>`) build by file, so
// a directory can hold several builds, matched case-insensitively. `walkGlob`
// is a case-sensitive superset of `nocaseGlob`, for the walk.
export type BuildFiles =
  | {
      byFile: false
      names: readonly string[]
      // Entries that make a directory a build of its own: a build that
      // includes the directory as a project does not load what it defines.
      rootMarkers: readonly string[]
      // The tool run in a directory without a root marker loads the build of
      // the nearest ancestor that has one, except in these directories.
      loadsAncestorBuild?: { except: readonly string[] }
    }
  | {
      byFile: true
      nocaseGlob: string
      walkGlob: string
      // Within one directory, lower runs first; by name otherwise.
      entryRank?: (file: string) => number
    }

// `settings.gradle(.kts)` covers Kotlin-DSL roots that have no root
// `build.gradle`.
export const BUILD_FILES: Record<BuildTool, BuildFiles> = {
  __proto__: null,
  // Solutions, and the project types the .NET SDK builds. A solution filter
  // (.slnf) narrows a solution, so it is only built when named explicitly.
  dotnet: {
    byFile: true,
    nocaseGlob: '*.{sln,slnx,csproj,fsproj,vbproj}',
    walkGlob:
      '*.{[sS][lL][nN],[sS][lL][nN][xX],[cCfFvV][sSbB][pP][rR][oO][jJ]}',
    // A solution covers the projects it lists.
    entryRank: (file: string) => (isDotnetSolution(file) ? 0 : 1),
  },
  gradle: {
    byFile: false,
    names: [
      'build.gradle',
      'build.gradle.kts',
      'settings.gradle',
      'settings.gradle.kts',
    ],
    rootMarkers: ['settings.gradle', 'settings.gradle.kts'],
    // Gradle builds `buildSrc` on its own.
    loadsAncestorBuild: { except: ['buildSrc'] },
  },
  maven: {
    byFile: true,
    nocaseGlob: '{*-*.,}pom{.xml,}',
    walkGlob: '*[pP][oO][mM]*',
  },
  // A subproject's own `project/` is ignored by the build that includes it.
  sbt: { byFile: false, names: ['build.sbt'], rootMarkers: ['project'] },
} as unknown as Record<BuildTool, BuildFiles>

// sbt happily runs in any directory, synthesizing a default project from its
// name, so an sbt run outside a build yields a plausible but bogus SBOM. Maven
// and Gradle refuse such a directory themselves.
export function looksLikeSbtBuild(projectDir: string): boolean {
  return (
    existsSync(resolve(projectDir, 'build.sbt')) ||
    existsSync(resolve(projectDir, 'project'))
  )
}

export function resolveBuildToolBin(
  tool: BuildTool,
  projectDir: string,
  bin?: string | undefined,
  standalone = false,
): string {
  if (standalone) {
    return validatedEnvBuildToolPath(tool, projectDir)
  }
  const envOverride = process.env[BUILD_TOOL_PATH_ENV[tool]]
  if (envOverride) {
    return validateExecutablePath(
      BUILD_TOOL_PATH_ENV[tool],
      envOverride,
      resolve(projectDir, envOverride),
    )
  }
  if (bin) {
    return bin
  }
  const wrapperName = BUILD_TOOL_WRAPPER[tool]
  if (wrapperName && existsSync(resolve(projectDir, wrapperName))) {
    return `./${wrapperName}`
  }
  return DEFAULT_BUILD_TOOL_BIN[tool]
}

export function isDotnetSolution(file: string): boolean {
  return /\.slnx?$/i.test(file)
}
