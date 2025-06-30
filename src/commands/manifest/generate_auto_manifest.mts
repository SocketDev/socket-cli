import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { convertGradleToMaven } from './convert_gradle_to_maven.mts'
import { convertSbtToMaven } from './convert_sbt_to_maven.mts'
import { handleManifestConda } from './handle-manifest-conda.mts'
import { readOrDefaultSocketJson } from '../../utils/socketjson.mts'

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
  const sockJson = await readOrDefaultSocketJson(cwd)

  if (verbose) {
    logger.info('Using this socket.json for defaults:', sockJson)
  }

  if (!sockJson?.defaults?.manifest?.sbt?.disabled && detected.sbt) {
    logger.log('Detected a Scala sbt build, generating pom files with sbt...')
    await convertSbtToMaven({
      // Note: `sbt` is more likely to be resolved against PATH env
      bin: sockJson.defaults?.manifest?.sbt?.bin ?? 'sbt',
      cwd,
      out: sockJson.defaults?.manifest?.sbt?.outfile ?? './socket.sbt.pom.xml',
      sbtOpts:
        sockJson.defaults?.manifest?.sbt?.sbtOpts
          ?.split(' ')
          .map(s => s.trim())
          .filter(Boolean) ?? [],
      verbose: Boolean(sockJson.defaults?.manifest?.sbt?.verbose),
    })
  }

  if (!sockJson?.defaults?.manifest?.gradle?.disabled && detected.gradle) {
    logger.log(
      'Detected a gradle build (Gradle, Kotlin, Scala), running default gradle generator...',
    )
    await convertGradleToMaven({
      // Note: `gradlew` is more likely to be resolved against cwd
      // Note: .resolve() wont butcher an absolute path
      // TODO: `gradlew` (or anything else given) may want to resolve against PATH
      bin: sockJson.defaults?.manifest?.gradle?.bin
        ? path.resolve(cwd, sockJson.defaults.manifest.gradle.bin)
        : path.join(cwd, 'gradlew'),
      cwd,
      verbose: Boolean(sockJson.defaults?.manifest?.gradle?.verbose),
      gradleOpts:
        sockJson.defaults?.manifest?.gradle?.gradleOpts
          ?.split(' ')
          .map(s => s.trim())
          .filter(Boolean) ?? [],
    })
  }

  if (!sockJson?.defaults?.manifest?.conda?.disabled && detected.conda) {
    logger.log(
      'Detected an environment.yml file, running default Conda generator...',
    )
    await handleManifestConda({
      cwd,
      filename: sockJson.defaults?.manifest?.conda?.infile ?? 'environment.yml',
      outputKind,
      out: sockJson.defaults?.manifest?.conda?.outfile ?? 'requirements.txt',
      verbose: Boolean(sockJson.defaults?.manifest?.conda?.verbose),
    })
  }
}
