import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { convertGradleToMaven } from './convert-gradle-to-maven.mts'
import { convertSbtToMaven } from './convert-sbt-to-maven.mts'
import { handleManifestConda } from './handle-manifest-conda.mts'
import {
  resolveCondaInfile,
  resolveCondaOutfile,
  resolveGradleInvocation,
  resolveSbtInvocation,
} from './manifest-build-trust.mts'
import { outputManifest } from './output-manifest.mts'
import { outputRequirements } from './output-requirements.mts'
import { SOCKET_JSON } from '../../constants/socket.mts'
import { readOrDefaultSocketJson } from '../../util/socket/json.mts'

import type { GeneratableManifests } from './detect-manifest-actions.mts'
import type { OutputKind } from '../../types.mts'
const logger = getDefaultLogger()

export async function generateAutoManifest({
  cwd,
  detected,
  outputKind,
  trustSocketJson,
  verbose,
}: {
  detected: GeneratableManifests
  cwd: string
  outputKind: OutputKind
  trustSocketJson: boolean
  verbose: boolean
}) {
  const sockJson = readOrDefaultSocketJson(cwd)

  if (verbose) {
    logger.info(`Using this ${SOCKET_JSON} for defaults:`, sockJson)
  }

  if (!sockJson?.defaults?.manifest?.sbt?.disabled && detected.sbt) {
    const isTextMode = outputKind === 'text'
    // Auto-manifest has no command line of its own, so every sbt value here
    // comes from the scanned repository's socket.json.
    const invocation = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd,
      socketJson: sockJson,
      trustSocketJson,
    })
    if (!invocation.ok) {
      await outputManifest(invocation, outputKind, '-')
    } else {
      if (isTextMode) {
        logger.log('Detected a Scala sbt build, generating pom files with sbt…')
      }
      await convertSbtToMaven({
        bin: invocation.data.bin,
        cwd,
        out: sockJson.defaults?.manifest?.sbt?.outfile ?? './socket.sbt.pom.xml',
        outputKind,
        sbtOpts: invocation.data.opts,
        verbose: Boolean(sockJson.defaults?.manifest?.sbt?.verbose),
      })
    }
  }

  if (!sockJson?.defaults?.manifest?.gradle?.disabled && detected.gradle) {
    const isTextMode = outputKind === 'text'
    const invocation = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd,
      socketJson: sockJson,
      trustSocketJson,
    })
    if (!invocation.ok) {
      await outputManifest(invocation, outputKind, '-')
    } else {
      if (isTextMode) {
        logger.log(
          'Detected a gradle build (Gradle, Kotlin, Scala), running default gradle generator…',
        )
      }
      await convertGradleToMaven({
        bin: invocation.data.bin,
        cwd,
        outputKind,
        verbose: Boolean(sockJson.defaults?.manifest?.gradle?.verbose),
        gradleOpts: invocation.data.opts,
      })
    }
  }

  if (!sockJson?.defaults?.manifest?.conda?.disabled && detected.conda) {
    const infile = resolveCondaInfile({
      cliFile: undefined,
      cwd,
      socketJson: sockJson,
      trustSocketJson,
    })
    if (!infile.ok) {
      await outputRequirements(infile, outputKind, '-')
      return
    }
    const outfile = resolveCondaOutfile({
      cliOut: undefined,
      cwd,
      socketJson: sockJson,
      trustSocketJson,
    })
    if (!outfile.ok) {
      await outputRequirements(outfile, outputKind, '-')
      return
    }
    logger.log(
      'Detected an environment.yml file, running default Conda generator…',
    )
    await handleManifestConda({
      cwd,
      filename: infile.data,
      outputKind,
      out: outfile.data,
      verbose: Boolean(sockJson.defaults?.manifest?.conda?.verbose),
    })
  }
}
