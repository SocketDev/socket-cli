// The point here is to attempt to detect the various supported manifest files
// the CLI can generate. This would be environments that we can't do server side

import { existsSync } from 'node:fs'
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
  gradle: boolean
  maven: boolean
  sbt: boolean
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
    gradle: false,
    maven: false,
    sbt: false,
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
    existsSync(path.join(cwd, 'build.gradle.kts'))
  ) {
    // Detect by build script, not the `gradlew` wrapper: a project can build
    // with `gradle` on PATH (no wrapper), matching how `socket manifest gradle`
    // resolves its bin. Mirrors `pom.xml` (Maven) and `build.sbt` (sbt).
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
