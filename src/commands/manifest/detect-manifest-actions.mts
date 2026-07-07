// The point here is to attempt to detect the various supported manifest files
// the CLI can generate. This would be environments that we can't do server side

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { debugLog } from '@socketsecurity/registry/lib/debug'

import {
  ENVIRONMENT_YAML,
  ENVIRONMENT_YML,
  SOCKET_JSON,
} from '../../constants.mts'

import type { SocketJson } from '../../utils/socket-json.mts'

export interface GeneratableManifests {
  bazel: boolean
  cdxgen: boolean
  count: number
  conda: boolean
  dotnet: boolean
  gradle: boolean
  maven: boolean
  sbt: boolean
}

// A solution or project file at the top level marks a .NET root (matching the
// root-level convention of the other detectors).
const DOTNET_ROOT_FILE_RE = /\.(?:sln|slnx|csproj|fsproj|vbproj)$/i

function hasDotnetRootFile(cwd: string): boolean {
  try {
    // Files only: a directory named e.g. `templates.csproj` must not trigger
    // the dotnet pipeline (which aborts scans when the SDK is absent).
    return readdirSync(cwd, { withFileTypes: true }).some(
      entry => entry.isFile() && DOTNET_ROOT_FILE_RE.test(entry.name),
    )
  } catch {
    return false
  }
}

export async function detectManifestActions(
  // Passing in null means we attempt detection for every supported language
  // regardless of local socket.json status. Sometimes we want that.
  sockJson: SocketJson | null,
  cwd = process.cwd(),
): Promise<GeneratableManifests> {
  const output = {
    bazel: false,
    cdxgen: false, // TODO
    count: 0,
    conda: false,
    dotnet: false,
    gradle: false,
    maven: false,
    sbt: false,
  }

  if (sockJson?.defaults?.manifest?.dotnet?.disabled) {
    debugLog(
      'notice',
      `[DEBUG] - dotnet auto-detection is disabled in ${SOCKET_JSON}`,
    )
  } else if (hasDotnetRootFile(cwd)) {
    debugLog('notice', '[DEBUG] - Detected a .NET solution or project file')
    output.dotnet = true
    output.count += 1
  }

  if (sockJson?.defaults?.manifest?.bazel?.disabled) {
    debugLog(
      'notice',
      `[DEBUG] - bazel auto-detection is disabled in ${SOCKET_JSON}`,
    )
  } else if (
    existsSync(path.join(cwd, 'MODULE.bazel')) ||
    existsSync(path.join(cwd, 'WORKSPACE')) ||
    existsSync(path.join(cwd, 'WORKSPACE.bazel'))
  ) {
    debugLog('notice', '[DEBUG] - Detected a Bazel workspace')
    output.bazel = true
    output.count += 1
  }

  if (sockJson?.defaults?.manifest?.sbt?.disabled) {
    debugLog(
      'notice',
      `[DEBUG] - sbt auto-detection is disabled in ${SOCKET_JSON}`,
    )
  } else if (existsSync(path.join(cwd, 'build.sbt'))) {
    debugLog('notice', '[DEBUG] - Detected a Scala sbt build file')

    output.sbt = true
    output.count += 1
  }

  if (sockJson?.defaults?.manifest?.gradle?.disabled) {
    debugLog(
      'notice',
      `[DEBUG] - gradle auto-detection is disabled in ${SOCKET_JSON}`,
    )
  } else if (
    existsSync(path.join(cwd, 'build.gradle')) ||
    existsSync(path.join(cwd, 'build.gradle.kts')) ||
    existsSync(path.join(cwd, 'settings.gradle')) ||
    existsSync(path.join(cwd, 'settings.gradle.kts'))
  ) {
    // Detect by build descriptor, not the `gradlew` wrapper (a project can build via
    // `gradle` on PATH). `settings.gradle(.kts)` covers Kotlin-DSL roots with no root build script.
    debugLog('notice', '[DEBUG] - Detected a gradle build file')
    output.gradle = true
    output.count += 1
  }

  if (sockJson?.defaults?.manifest?.maven?.disabled) {
    debugLog(
      'notice',
      `[DEBUG] - maven auto-detection is disabled in ${SOCKET_JSON}`,
    )
  } else if (existsSync(path.join(cwd, 'pom.xml'))) {
    debugLog('notice', '[DEBUG] - Detected a Maven pom.xml build file')
    output.maven = true
    output.count += 1
  }

  if (sockJson?.defaults?.manifest?.conda?.disabled) {
    debugLog(
      'notice',
      `[DEBUG] - conda auto-detection is disabled in ${SOCKET_JSON}`,
    )
  } else {
    const envyml = path.join(cwd, ENVIRONMENT_YML)
    const hasEnvyml = existsSync(envyml)
    const envyaml = path.join(cwd, ENVIRONMENT_YAML)
    const hasEnvyaml = !hasEnvyml && existsSync(envyaml)
    if (hasEnvyml || hasEnvyaml) {
      debugLog('notice', '[DEBUG] - Detected an environment.yml Conda file')
      output.conda = true
      output.count += 1
    }
  }

  return output
}
