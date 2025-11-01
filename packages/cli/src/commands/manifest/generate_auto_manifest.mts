import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { convertGradleToMaven } from './convert-gradle-to-maven.mts'
import { convertSbtToMaven } from './convert-sbt-to-maven.mts'
import { handleManifestConda } from './handle-manifest-conda.mts'
import { REQUIREMENTS_TXT } from '../../constants/paths.mjs'
import { SOCKET_JSON } from '../../constants/socket.mts'
import { readOrDefaultSocketJson } from '../../utils/socket/json.mts'

import type { GeneratableManifests } from './detect-manifest-actions.mts'
import type { OutputKind } from '../../types.mts'

export async function generateAutoManifest({
  cwd,
  detected,
  outputKind,
  verbose,
}: {
  detected: GeneratableManifests
  cwd: string
  outputKind: OutputKind
  verbose: boolean
}) {
  const sockJson = readOrDefaultSocketJson(cwd)

  if (verbose) {
    getDefaultLogger().info(`Using this ${SOCKET_JSON} for defaults:`, sockJson)
  }

  if (!sockJson?.defaults?.manifest?.sbt?.disabled && detected.sbt) {
    const isTextMode = outputKind === 'text'
    if (isTextMode) {
      getDefaultLogger().log(
        'Detected a Scala sbt build, generating pom files with sbt...',
      )
    }
    await convertSbtToMaven({
      // Note: `sbt` is more likely to be resolved against PATH env
      bin: sockJson.defaults?.manifest?.sbt?.bin ?? 'sbt',
      cwd,
      out: sockJson.defaults?.manifest?.sbt?.outfile ?? './socket.sbt.pom.xml',
      outputKind,
      sbtOpts:
        sockJson.defaults?.manifest?.sbt?.sbtOpts
          ?.split(' ')
          .map(s => s.trim())
          .filter(Boolean) ?? [],
      verbose: Boolean(sockJson.defaults?.manifest?.sbt?.verbose),
    })
  }

  if (!sockJson?.defaults?.manifest?.gradle?.disabled && detected.gradle) {
    const isTextMode = outputKind === 'text'
    if (isTextMode) {
      getDefaultLogger().log(
        'Detected a gradle build (Gradle, Kotlin, Scala), running default gradle generator...',
      )
    }
    await convertGradleToMaven({
      // Note: Resolve bin relative to cwd (path.resolve handles absolute paths correctly).
      // We don't resolve against $PATH since gradlew is typically a local wrapper script.
      bin: sockJson.defaults?.manifest?.gradle?.bin
        ? path.resolve(cwd, sockJson.defaults.manifest.gradle.bin)
        : path.join(cwd, 'gradlew'),
      cwd,
      outputKind,
      verbose: Boolean(sockJson.defaults?.manifest?.gradle?.verbose),
      gradleOpts:
        sockJson.defaults?.manifest?.gradle?.gradleOpts
          ?.split(' ')
          .map(s => s.trim())
          .filter(Boolean) ?? [],
    })
  }

  if (!sockJson?.defaults?.manifest?.conda?.disabled && detected.conda) {
    getDefaultLogger().log(
      'Detected an environment.yml file, running default Conda generator...',
    )
    await handleManifestConda({
      cwd,
      filename: sockJson.defaults?.manifest?.conda?.infile ?? 'environment.yml',
      outputKind,
      out: sockJson.defaults?.manifest?.conda?.outfile ?? REQUIREMENTS_TXT,
      verbose: Boolean(sockJson.defaults?.manifest?.conda?.verbose),
    })
  }
}
