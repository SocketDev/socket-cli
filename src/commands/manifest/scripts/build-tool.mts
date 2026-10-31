import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import constants from '../../../constants.mts'

import type { PURL_Type } from '../../../utils/ecosystem.mts'

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

// Maven builds by file (`mvn --file`), so a directory can hold several: the
// POMs a scan uploads, matched case-insensitively. `walkGlob` is a
// case-sensitive superset of `nocaseGlob`, for the walk.
export type BuildFiles =
  | { byFile: false; names: readonly string[] }
  | {
      byFile: true
      nocaseGlob: string
      walkGlob: string
      // Each project restores on its own whichever build reaches it, so a build
      // covers its projects wherever they live; solution properties aside.
      projectsResolveAlone?: true
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
    // NuGet restores each project into its own project.assets.json.
    projectsResolveAlone: true,
  },
  gradle: {
    byFile: false,
    names: [
      'build.gradle',
      'build.gradle.kts',
      'settings.gradle',
      'settings.gradle.kts',
    ],
  },
  maven: {
    byFile: true,
    nocaseGlob: '{*-*.,}pom{.xml,}',
    walkGlob: '*[pP][oO][mM]*',
  },
  sbt: { byFile: false, names: ['build.sbt'] },
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
): string {
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

// Distinct for every build sharing a directory.
export function socketFactsFileName(
  tool: BuildTool,
  entryFile: string | undefined,
): string | undefined {
  if (!BUILD_FILES[tool].byFile) {
    return `${tool}${constants.DOT_SOCKET_DOT_FACTS_JSON}`
  }
  return entryFile
    ? `${basename(entryFile)}${constants.DOT_SOCKET_DOT_FACTS_JSON}`
    : undefined
}
