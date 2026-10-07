import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import constants from '../../../constants.mts'

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

// Gradle (8+) and sbt hold one build per directory; Maven builds are addressed
// by POM file, so `mvn -f other-pom.xml` puts a second build in the directory.
const ADDRESSED_BY_FILE: Record<BuildTool, boolean> = {
  __proto__: null,
  gradle: false,
  maven: true,
  sbt: false,
} as unknown as Record<BuildTool, boolean>

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

// `<entry>.socket.facts.json`, distinct for every build sharing a directory:
// the entry file's name (`pom.xml`) for a file-addressed build, the tool's
// name (`gradle`) for a directory-addressed one. Undefined when a
// file-addressed build did not report its entry file.
export function socketFactsFileName(
  tool: BuildTool,
  entryFile: string | undefined,
): string | undefined {
  if (!ADDRESSED_BY_FILE[tool]) {
    return `${tool}${constants.DOT_SOCKET_DOT_FACTS_JSON}`
  }
  return entryFile
    ? `${basename(entryFile)}${constants.DOT_SOCKET_DOT_FACTS_JSON}`
    : undefined
}
