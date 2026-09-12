// The point here is to attempt to detect the various supported manifest files
// the CLI can generate. This would be environments that we can't do server side

import { existsSync } from 'node:fs'
import path from 'node:path'

import { debugLog } from '@socketsecurity/lib-stable/debug/output'

import {
  DEFAULT_BAZEL_WALKER_IGNORE_DIR_NAMES,
  DEFAULT_BAZEL_WALKER_IGNORE_DIR_PREFIXES,
} from './bazel/bazel-maven-types.mts'
import { findWorkspaceRoots } from './bazel/bazel-workspace-walk.mts'
import { ENVIRONMENT_YAML, ENVIRONMENT_YML } from '../../constants/paths.mjs'
import { SOCKET_JSON } from '../../constants/socket.mts'

import type { SocketJson } from '../../util/socket/json.mts'

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
  // Passing in undefined means we attempt detection for every supported
  // language regardless of local socket.json status. Sometimes we want that.
  sockJson: SocketJson | undefined,
  cwd = process.cwd(),
): Promise<GeneratableManifests> {
  const output = {
    bazel: false,
    cdxgen: false,
    count: 0,
    conda: false,
    gradle: false,
    maven: false,
    sbt: false,
  }

  const manifest = sockJson?.defaults?.manifest
  const detectors = [
    {
      name: 'bazel',
      files: ['MODULE.bazel', 'WORKSPACE', 'WORKSPACE.bazel'],
      message: 'a Bazel workspace',
    },
    {
      name: 'sbt',
      files: ['build.sbt'],
      message: 'a Scala sbt build file',
    },
    {
      name: 'gradle',
      files: [
        'build.gradle',
        'build.gradle.kts',
        'settings.gradle',
        'settings.gradle.kts',
      ],
      message: 'a gradle build file',
    },
    {
      name: 'maven',
      files: ['pom.xml'],
      message: 'a Maven pom.xml build file',
    },
    {
      name: 'conda',
      files: [ENVIRONMENT_YML, ENVIRONMENT_YAML],
      message: 'an environment.yml Conda file',
    },
  ] as const
  for (const detector of detectors) {
    if (manifest?.[detector.name]?.disabled) {
      debugLog(
        'notice',
        `[DEBUG] - ${detector.name} auto-detection is disabled in ${SOCKET_JSON}`,
      )
    } else if (detectManifestFiles(cwd, detector.name, detector.files)) {
      debugLog('notice', `[DEBUG] - Detected ${detector.message}`)
      output[detector.name] = true
      output.count += 1
    }
  }

  return output
}

export function detectManifestFiles(
  cwd: string,
  name: string,
  files: readonly string[],
): boolean {
  if (files.some(file => existsSync(path.join(cwd, file)))) {
    return true
  }
  return (
    name === 'bazel' &&
    findWorkspaceRoots(cwd, {
      ignoreDirNames: DEFAULT_BAZEL_WALKER_IGNORE_DIR_NAMES,
      ignoreDirPrefixes: DEFAULT_BAZEL_WALKER_IGNORE_DIR_PREFIXES,
    }).length > 0
  )
}
