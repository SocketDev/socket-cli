import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { extractBazelToMaven } from './bazel/extract_bazel_to_maven.mts'
import { extractBazelToPypi } from './bazel/extract_bazel_to_pypi.mts'
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
    logger.log('Detected a Scala sbt build, generating pom files with sbt...')
    await convertSbtToMaven({
      // Note: `sbt` is more likely to be resolved against PATH env
      bin: sockJson.defaults?.manifest?.sbt?.bin ?? 'sbt',
      cwd,
      out: sockJson.defaults?.manifest?.sbt?.outfile ?? './pom.xml',
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
      out: sockJson.defaults?.manifest?.conda?.outfile ?? REQUIREMENTS_TXT,
      verbose: Boolean(sockJson.defaults?.manifest?.conda?.verbose),
    })
  }

  if (!sockJson?.defaults?.manifest?.bazel?.disabled && detected.bazel) {
    const bazelConfig = sockJson?.defaults?.manifest?.bazel
    type EcosystemOutcome = {
      ecosystem: 'maven' | 'pypi'
      ok: boolean
      noEcosystemFound?: boolean
      hardFailure?: boolean
      manifestPath?: string | undefined
    }
    const outcomes: EcosystemOutcome[] = []

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
    outcomes.push({
      ecosystem: 'maven',
      ok: mavenResult.ok,
      manifestPath: mavenResult.manifestPath,
    })

    logger.log('Extracting PyPI dependencies via bazel query...')
    const pypiResult = await extractBazelToPypi({
      bazelFlags: bazelConfig?.bazelFlags,
      bazelOutputBase: bazelConfig?.bazelOutputBase,
      bazelRc: bazelConfig?.bazelRc,
      bin: bazelConfig?.bazel ?? bazelConfig?.bin,
      cwd,
      out: bazelConfig?.out ?? cwd,
      outLayout: 'flat',
      verbose: Boolean(bazelConfig?.verbose) || verbose,
    })
    outcomes.push({
      ecosystem: 'pypi',
      ok: pypiResult.ok,
      noEcosystemFound: Boolean(pypiResult.noEcosystemFound),
      manifestPath: pypiResult.manifestPath,
    })

    // Auto-manifest outcome matrix: one ecosystem success means overall
    // success; both hard-fail means throw; both no-discovery is informational.
    const successes = outcomes.filter(o => o.ok && o.manifestPath)
    const hardFailures = outcomes.filter(o => !o.ok && !o.noEcosystemFound)
    const noDiscoveries = outcomes.filter(o => o.noEcosystemFound)

    if (successes.length) {
      for (const s of successes) {
        generatedFiles.push(s.manifestPath!)
      }
      if (hardFailures.length) {
        for (const f of hardFailures) {
          logger.warn(
            `${f.ecosystem} extraction failed, but other ecosystem(s) succeeded.`,
          )
        }
      }
    } else if (
      !hardFailures.length &&
      noDiscoveries.length === outcomes.length
    ) {
      logger.info('No supported Bazel ecosystems detected (maven, pypi).')
    } else if (hardFailures.length) {
      throw new Error('Bazel auto-manifest generation failed')
    }
  }

  return { generatedFiles }
}
