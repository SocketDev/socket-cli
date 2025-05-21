import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { convertGradleToMaven } from './convert_gradle_to_maven.mts'
import { convertSbtToMaven } from './convert_sbt_to_maven.mts'
import { handleManifestConda } from './handle-manifest-conda.mts'

import type { GeneratableManifests } from './detect-manifest-actions.mts'
import type { OutputKind } from '../../types.mts'

export async function generateAutoManifest(
  detected: GeneratableManifests,
  cwd: string,
  verbose: boolean,
  outputKind: OutputKind,
) {
  if (detected.sbt) {
    logger.log('Detected a Scala sbt build, generating pom files with sbt...')
    await convertSbtToMaven(cwd, 'sbt', './socket.sbt.pom.xml', verbose, [])
  }

  if (detected.gradle) {
    logger.log(
      'Detected a gradle build (Gradle, Kotlin, Scala), running default gradle generator...',
    )
    await convertGradleToMaven(cwd, path.join(cwd, 'gradlew'), cwd, verbose, [])
  }

  if (detected.conda) {
    logger.log(
      'Detected an environment.yml file, running default Conda generator...',
    )
    await handleManifestConda(cwd, '', outputKind, cwd, verbose)
  }
}
