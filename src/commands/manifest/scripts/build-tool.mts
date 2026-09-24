import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export type BuildTool = 'gradle' | 'maven' | 'sbt'

// PATH fallback when no `bin` and no project wrapper.
const DEFAULT_BUILD_TOOL_BIN: Record<BuildTool, string> = {
  __proto__: null,
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
