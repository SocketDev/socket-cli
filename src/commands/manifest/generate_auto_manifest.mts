import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { extractBazelToMaven } from './bazel/extract_bazel_to_maven.mts'
import { convertGradleToFacts } from './convert-gradle-to-facts.mts'
import { convertSbtToFacts } from './convert-sbt-to-facts.mts'
import { convertGradleToMaven } from './convert_gradle_to_maven.mts'
import { convertSbtToMaven } from './convert_sbt_to_maven.mts'
import { handleManifestConda } from './handle-manifest-conda.mts'
import { REQUIREMENTS_TXT, SOCKET_JSON } from '../../constants.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'

import type { GeneratableManifests } from './detect-manifest-actions.mts'
import type { OutputKind } from '../../types.mts'

export type GenerateAutoManifestResult = {
  generatedFiles: string[]
}

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
}): Promise<GenerateAutoManifestResult> {
  const sockJson = readOrDefaultSocketJson(cwd)
  const generatedFiles: string[] = []

  if (verbose) {
    logger.info(`Using this ${SOCKET_JSON} for defaults:`, sockJson)
  }

  if (!sockJson?.defaults?.manifest?.sbt?.disabled && detected.sbt) {
    // Args shared by both paths. The facts-only knobs (`includeConfigs`,
    // `excludeConfigs`, `ignoreUnresolved`) and the pom-only `out` are added
    // per branch so neither handler is spread properties it doesn't accept.
    const sbtArgs = {
      // Note: `sbt` is more likely to be resolved against PATH env.
      bin: sockJson.defaults?.manifest?.sbt?.bin ?? 'sbt',
      cwd,
      sbtOpts:
        sockJson.defaults?.manifest?.sbt?.sbtOpts
          ?.split(' ')
          .map(s => s.trim())
          .filter(Boolean) ?? [],
      verbose: Boolean(sockJson.defaults?.manifest?.sbt?.verbose),
    }
    // Socket facts is the default; opt into pom generation with
    // `defaults.manifest.sbt.facts: false` in socket.json.
    if (sockJson.defaults?.manifest?.sbt?.facts !== false) {
      logger.log('Detected a Scala sbt build, generating Socket facts...')
      await convertSbtToFacts({
        ...sbtArgs,
        excludeConfigs: sockJson.defaults?.manifest?.sbt?.excludeConfigs ?? '',
        ignoreUnresolved: Boolean(
          sockJson.defaults?.manifest?.sbt?.ignoreUnresolved,
        ),
        includeConfigs: sockJson.defaults?.manifest?.sbt?.includeConfigs ?? '',
      })
    } else {
      logger.log('Detected a Scala sbt build, generating pom files with sbt...')
      await convertSbtToMaven({
        ...sbtArgs,
        out: sockJson.defaults?.manifest?.sbt?.outfile ?? './pom.xml',
      })
    }
  }

  if (!sockJson?.defaults?.manifest?.gradle?.disabled && detected.gradle) {
    const gradleArgs = {
      // Note: `gradlew` is more likely to be resolved against cwd.
      // Note: .resolve() won't butcher an absolute path.
      // TODO: `gradlew` (or anything else given) may want to resolve against PATH.
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
    }
    // Socket facts is the default; opt into pom generation with
    // `defaults.manifest.gradle.facts: false` in socket.json.
    if (sockJson.defaults?.manifest?.gradle?.facts !== false) {
      logger.log(
        'Detected a gradle build (Gradle, Kotlin, Scala), generating Socket facts...',
      )
      await convertGradleToFacts({
        ...gradleArgs,
        excludeConfigs:
          sockJson.defaults?.manifest?.gradle?.excludeConfigs ?? '',
        ignoreUnresolved: Boolean(
          sockJson.defaults?.manifest?.gradle?.ignoreUnresolved,
        ),
        includeConfigs:
          sockJson.defaults?.manifest?.gradle?.includeConfigs ?? '',
      })
    } else {
      logger.log(
        'Detected a gradle build (Gradle, Kotlin, Scala), running default gradle generator...',
      )
      await convertGradleToMaven(gradleArgs)
    }
  }

  if (!sockJson?.defaults?.manifest?.conda?.disabled && detected.conda) {
    logger.log(
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

  if (!sockJson?.defaults?.manifest?.bazel?.disabled && detected.bazel) {
    const bazelConfig = sockJson?.defaults?.manifest?.bazel

    logger.log(
      'Detected a Bazel workspace, extracting Maven dependencies via bazel query...',
    )
    const mavenResult = await extractBazelToMaven({
      bazelFlags: bazelConfig?.bazelFlags,
      bazelOutputBase: bazelConfig?.bazelOutputBase,
      bazelRc: bazelConfig?.bazelRc,
      bin: bazelConfig?.bazel ?? bazelConfig?.bin,
      cwd,
      out: bazelConfig?.out ?? cwd,
      outLayout: 'flat',
      verbose: Boolean(bazelConfig?.verbose) || verbose,
    })

    // Only a hard failure (zero manifests, ecosystem present) aborts the
    // wider scan. A partial run still produced manifests worth uploading; an
    // absent ecosystem is tolerated here (it's only an error when EVERY
    // ecosystem is absent, which the caller decides).
    if (mavenResult.status === 'hardFailure') {
      throw new Error(
        'Bazel auto-manifest generation failed for ecosystem(s): maven',
      )
    }
    if (mavenResult.status === 'complete' || mavenResult.status === 'partial') {
      generatedFiles.push(...mavenResult.manifestPaths)
      if (mavenResult.status === 'partial') {
        logger.warn(
          `Bazel Maven manifest generation was partial (${mavenResult.manifestPaths.length} manifest(s) written); some hubs failed or had incomplete dependency graphs. Uploading what was generated.`,
        )
      }
    } else {
      logger.info('No supported Bazel Maven ecosystem detected.')
    }
  }

  return { generatedFiles }
}
