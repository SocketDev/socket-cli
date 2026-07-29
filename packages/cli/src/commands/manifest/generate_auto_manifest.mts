import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { runBazelAutoManifest } from './auto-manifest-bazel.mts'
import { convertGradleToFacts } from './convert-gradle-to-facts.mts'
import { convertGradleToMaven } from './convert-gradle-to-maven.mts'
import { convertMavenToFacts } from './convert-maven-to-facts.mts'
import { convertSbtToFacts } from './convert-sbt-to-facts.mts'
import { convertSbtToMaven } from './convert-sbt-to-maven.mts'
import { handleManifestConda } from './handle-manifest-conda.mts'
import {
  resolveCondaInfile,
  resolveCondaOutfile,
  resolveGradleInvocation,
  resolveMavenInvocation,
  resolveSbtInvocation,
} from './manifest-build-trust.mts'
import { outputManifest } from './output-manifest.mts'
import { outputRequirements } from './output-requirements.mts'
import { serializeSidecar } from './scripts/sidecar.mts'
import { SOCKET_JSON } from '../../constants/socket.mts'
import { InputError } from '../../util/error/errors-types.mts'
import { readOrDefaultSocketJson } from '../../util/socket/json.mts'

import type { GeneratableManifests } from './detect-manifest-actions.mts'
import type {
  ResolvedPathsSidecar,
  SidecarAccumulator,
} from './scripts/sidecar.mts'
import type { OutputKind } from '../../types.mts'

const logger = getDefaultLogger()

export type GenerateAutoManifestResult = {
  generatedFiles: string[]
  // Reachability path only: resolved on-disk paths from the build-tool runs.
  resolvedPathsSidecar?: ResolvedPathsSidecar | undefined
}

// Under --auto-manifest, a manifest generator that failed — raising the exit
// code above the value captured before it ran — aborts the whole run: a
// partial or empty SBOM silently under-reports dependencies. The generator
// (or the trust-gate refusal) has already logged the specifics. A tolerated
// resolution failure (ignoreUnresolved) warns without touching the exit code,
// so it passes through here and the run continues.
export function abortManifestRunIfFailed(
  ecosystem: string,
  // `typeof process.exitCode` so a captured pre-run snapshot (which Node types
  // as possibly null) passes straight through.
  beforeExitCode: typeof process.exitCode,
): void {
  if (process.exitCode && process.exitCode !== beforeExitCode) {
    throw new InputError(
      `Auto-manifest generation failed for the ${ecosystem} project; aborting (see the errors above).`,
    )
  }
}

export async function generateAutoManifest({
  computeArtifactsSidecar,
  cwd,
  detected,
  excludePaths,
  outputKind,
  trustSocketJson,
  verbose,
}: {
  // Reachability path: run build tools with files to emit the sidecar.
  computeArtifactsSidecar?: boolean | undefined
  cwd: string
  detected: GeneratableManifests
  // Scan-root-relative `--exclude-paths`: skip excluded subprojects and drop
  // excluded source roots from the resolved-paths sidecar.
  excludePaths?: string[] | undefined
  outputKind: OutputKind
  trustSocketJson: boolean
  verbose: boolean
}): Promise<GenerateAutoManifestResult> {
  const sockJson = readOrDefaultSocketJson(cwd)
  const isTextMode = outputKind === 'text'
  const generatedFiles: string[] = []

  // Resolved paths across all JVM roots, serialized to one sidecar at the end.
  const sidecarAcc: SidecarAccumulator | undefined = computeArtifactsSidecar
    ? new Map()
    : undefined

  if (verbose) {
    logger.info(`Using this ${SOCKET_JSON} for defaults:`, sockJson)
  }

  if (!sockJson?.defaults?.manifest?.sbt?.disabled && detected.sbt) {
    // Auto-manifest has no command line of its own, so every sbt value here
    // comes from the scanned repository's socket.json.
    const invocation = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd,
      socketJson: sockJson,
      trustSocketJson,
    })
    const beforeExitCode = process.exitCode
    if (!invocation.ok) {
      await outputManifest(invocation, outputKind, '-')
    } else if (sockJson.defaults?.manifest?.sbt?.facts !== false) {
      // Socket facts is the default; opt into pom generation with
      // `defaults.manifest.sbt.facts: false` in socket.json.
      if (isTextMode) {
        logger.log('Detected a Scala sbt build, generating Socket facts…')
      }
      await convertSbtToFacts({
        bin: invocation.data.bin,
        cwd,
        excludeConfigs: sockJson.defaults?.manifest?.sbt?.excludeConfigs ?? '',
        excludePaths,
        ignoreUnresolved: Boolean(
          sockJson.defaults?.manifest?.sbt?.ignoreUnresolved,
        ),
        includeConfigs: sockJson.defaults?.manifest?.sbt?.includeConfigs ?? '',
        sbtOpts: invocation.data.opts,
        sidecarAcc,
        verbose: Boolean(sockJson.defaults?.manifest?.sbt?.verbose),
        withFiles: computeArtifactsSidecar,
      })
    } else {
      if (isTextMode) {
        logger.log('Detected a Scala sbt build, generating pom files with sbt…')
      }
      await convertSbtToMaven({
        bin: invocation.data.bin,
        cwd,
        out:
          sockJson.defaults?.manifest?.sbt?.outfile ?? './socket.sbt.pom.xml',
        outputKind,
        sbtOpts: invocation.data.opts,
        verbose: Boolean(sockJson.defaults?.manifest?.sbt?.verbose),
      })
    }
    abortManifestRunIfFailed('sbt', beforeExitCode)
  }

  if (!sockJson?.defaults?.manifest?.gradle?.disabled && detected.gradle) {
    const invocation = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd,
      socketJson: sockJson,
      trustSocketJson,
    })
    const beforeExitCode = process.exitCode
    if (!invocation.ok) {
      await outputManifest(invocation, outputKind, '-')
    } else if (sockJson.defaults?.manifest?.gradle?.facts !== false) {
      // Socket facts is the default; opt into pom generation with
      // `defaults.manifest.gradle.facts: false` in socket.json.
      if (isTextMode) {
        logger.log(
          'Detected a gradle build (Gradle, Kotlin, Scala), generating Socket facts…',
        )
      }
      await convertGradleToFacts({
        bin: invocation.data.bin,
        cwd,
        excludeConfigs:
          sockJson.defaults?.manifest?.gradle?.excludeConfigs ?? '',
        excludePaths,
        gradleOpts: invocation.data.opts,
        ignoreUnresolved: Boolean(
          sockJson.defaults?.manifest?.gradle?.ignoreUnresolved,
        ),
        includeConfigs:
          sockJson.defaults?.manifest?.gradle?.includeConfigs ?? '',
        sidecarAcc,
        verbose: Boolean(sockJson.defaults?.manifest?.gradle?.verbose),
        withFiles: computeArtifactsSidecar,
      })
    } else {
      if (isTextMode) {
        logger.log(
          'Detected a gradle build (Gradle, Kotlin, Scala), running default gradle generator…',
        )
      }
      await convertGradleToMaven({
        bin: invocation.data.bin,
        cwd,
        gradleOpts: invocation.data.opts,
        outputKind,
        verbose: Boolean(sockJson.defaults?.manifest?.gradle?.verbose),
      })
    }
    abortManifestRunIfFailed('gradle', beforeExitCode)
  }

  if (!sockJson?.defaults?.manifest?.maven?.disabled && detected.maven) {
    const invocation = resolveMavenInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd,
      socketJson: sockJson,
      trustSocketJson,
    })
    const beforeExitCode = process.exitCode
    if (!invocation.ok) {
      await outputManifest(invocation, outputKind, '-')
    } else {
      if (isTextMode) {
        logger.log('Detected a Maven pom.xml build, generating Socket facts…')
      }
      await convertMavenToFacts({
        bin: invocation.data.bin,
        cwd,
        excludeConfigs:
          sockJson.defaults?.manifest?.maven?.excludeConfigs ?? '',
        excludePaths,
        ignoreUnresolved: Boolean(
          sockJson.defaults?.manifest?.maven?.ignoreUnresolved,
        ),
        includeConfigs:
          sockJson.defaults?.manifest?.maven?.includeConfigs ?? '',
        mavenOpts: invocation.data.opts,
        sidecarAcc,
        verbose: Boolean(sockJson.defaults?.manifest?.maven?.verbose),
        withFiles: computeArtifactsSidecar,
      })
    }
    abortManifestRunIfFailed('maven', beforeExitCode)
  }

  if (!sockJson?.defaults?.manifest?.conda?.disabled && detected.conda) {
    const beforeExitCode = process.exitCode
    const infile = resolveCondaInfile({
      cliFile: undefined,
      cwd,
      socketJson: sockJson,
      trustSocketJson,
    })
    const outfile = infile.ok
      ? resolveCondaOutfile({
          cliOut: undefined,
          cwd,
          socketJson: sockJson,
          trustSocketJson,
        })
      : undefined
    if (!infile.ok) {
      await outputRequirements(infile, outputKind, '-')
    } else if (outfile && !outfile.ok) {
      await outputRequirements(outfile, outputKind, '-')
    } else if (outfile?.ok) {
      logger.log(
        'Detected an environment.yml file, running default Conda generator…',
      )
      await handleManifestConda({
        cwd,
        filename: infile.data,
        out: outfile.data,
        outputKind,
        verbose: Boolean(sockJson.defaults?.manifest?.conda?.verbose),
      })
    }
    abortManifestRunIfFailed('conda', beforeExitCode)
  }

  if (!sockJson?.defaults?.manifest?.bazel?.disabled && detected.bazel) {
    const beforeExitCode = process.exitCode
    generatedFiles.push(
      ...(await runBazelAutoManifest({
        cwd,
        outputKind,
        socketJson: sockJson,
        trustSocketJson,
        verbose,
      })),
    )
    abortManifestRunIfFailed('bazel', beforeExitCode)
  }

  return {
    generatedFiles,
    resolvedPathsSidecar: sidecarAcc?.size
      ? serializeSidecar(sidecarAcc)
      : undefined,
  }
}
