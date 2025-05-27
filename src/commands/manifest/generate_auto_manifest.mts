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
  const socketJson = await readOrDefaultSocketJson(String(cwd))

  if (verbose) {
    logger.info('Using this socket.json for defaults:', socketJson)
  }

  if (detected.sbt) {
    logger.log('Detected a Scala sbt build, generating pom files with sbt...')
    await convertSbtToMaven({
      // Note: `sbt` is more likely to be resolved against PATH env
      bin: socketJson.defaults?.manifest?.sbt?.bin ?? 'sbt',
      cwd,
      out:
        socketJson.defaults?.manifest?.sbt?.outfile ?? './socket.sbt.pom.xml',
      sbtOpts:
        socketJson.defaults?.manifest?.sbt?.sbtOpts
          ?.split(' ')
          .map(s => s.trim())
          .filter(Boolean) ?? [],
      verbose: Boolean(socketJson.defaults?.manifest?.sbt?.verbose),
    })
  }

  if (detected.gradle) {
    logger.log(
      'Detected a gradle build (Gradle, Kotlin, Scala), running default gradle generator...',
    )
    await convertGradleToMaven({
      // Note: `gradlew` is more likely to be resolved against cwd
      // Note: .resolve() wont butcher an absolute path
      // TODO: `gradlew` (or anything else given) may want to resolve against PATH
      bin: socketJson.defaults?.manifest?.gradle?.bin
        ? path.resolve(cwd, socketJson.defaults.manifest.gradle.bin)
        : path.join(cwd, 'gradlew'),
      cwd,
      verbose: Boolean(socketJson.defaults?.manifest?.gradle?.verbose),
      gradleOpts:
        socketJson.defaults?.manifest?.gradle?.gradleOpts
          ?.split(' ')
          .map(s => s.trim())
          .filter(Boolean) ?? [],
    })
  }

  if (detected.conda) {
    logger.log(
      'Detected an environment.yml file, running default Conda generator...',
    )
    await handleManifestConda({
      cwd,
      filename:
        socketJson.defaults?.manifest?.conda?.infile ?? 'environment.yml',
      outputKind,
      out: socketJson.defaults?.manifest?.conda?.outfile ?? 'requirements.txt',
      verbose: Boolean(socketJson.defaults?.manifest?.conda?.verbose),
    })
  }
}
