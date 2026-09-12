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

export type GenerateAutoManifestOptions = {
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
}

export async function generateAutoManifest({
  computeArtifactsSidecar,
  cwd,
  detected,
  excludePaths,
  outputKind,
  trustSocketJson,
  verbose,
}: GenerateAutoManifestOptions): Promise<GenerateAutoManifestResult> {
  const sockJson = readOrDefaultSocketJson(cwd)
  const manifestDefaults = sockJson.defaults?.manifest
  const isTextMode = outputKind === 'text'
  const generatedFiles: string[] = []

  // Resolved paths across all JVM roots, serialized to one sidecar at the end.
  const sidecarAcc: SidecarAccumulator | undefined = computeArtifactsSidecar
    ? new Map()
    : undefined

  const context = {
    computeArtifactsSidecar,
    cwd,
    detected,
    excludePaths,
    outputKind,
    trustSocketJson,
    verbose,
    sockJson,
    isTextMode,
    sidecarAcc,
  }

  if (verbose) {
    logger.info(`Using this ${SOCKET_JSON} for defaults:`, sockJson)
  }

  const generators: Array<
    [
      'sbt' | 'gradle' | 'maven' | 'conda',
      (context: AutoManifestContext) => Promise<void>,
    ]
  > = [
    ['sbt', generateSbtAutoManifest],
    ['gradle', generateGradleAutoManifest],
    ['maven', generateMavenAutoManifest],
    ['conda', generateCondaAutoManifest],
  ]
  for (const [ecosystem, generate] of generators) {
    if (!manifestDefaults?.[ecosystem]?.disabled && detected[ecosystem]) {
      await generate(context)
    }
  }

  if (!manifestDefaults?.bazel?.disabled && detected.bazel) {
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

export async function generateCondaAutoManifest({
  sockJson,
  cwd,
  trustSocketJson,
  outputKind,
}: AutoManifestContext): Promise<void> {
  const settings = sockJson.defaults?.manifest?.conda
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
      verbose: Boolean(settings?.verbose),
    })
  }
  abortManifestRunIfFailed('conda', beforeExitCode)
}

export async function generateGradleAutoManifest({
  sockJson,
  cwd,
  trustSocketJson,
  outputKind,
  isTextMode,
  excludePaths,
  sidecarAcc,
  computeArtifactsSidecar,
}: AutoManifestContext): Promise<void> {
  const settings = sockJson.defaults?.manifest?.gradle
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
  } else if (settings?.facts !== false) {
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
      excludeConfigs: settings?.excludeConfigs ?? '',
      excludePaths,
      gradleOpts: invocation.data.opts,
      ignoreUnresolved: Boolean(settings?.ignoreUnresolved),
      includeConfigs: settings?.includeConfigs ?? '',
      sidecarAcc,
      verbose: Boolean(settings?.verbose),
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
      verbose: Boolean(settings?.verbose),
    })
  }
  abortManifestRunIfFailed('gradle', beforeExitCode)
}

export async function generateMavenAutoManifest({
  sockJson,
  cwd,
  trustSocketJson,
  outputKind,
  isTextMode,
  excludePaths,
  sidecarAcc,
  computeArtifactsSidecar,
}: AutoManifestContext): Promise<void> {
  const settings = sockJson.defaults?.manifest?.maven
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
      excludeConfigs: settings?.excludeConfigs ?? '',
      excludePaths,
      ignoreUnresolved: Boolean(settings?.ignoreUnresolved),
      includeConfigs: settings?.includeConfigs ?? '',
      mavenOpts: invocation.data.opts,
      sidecarAcc,
      verbose: Boolean(settings?.verbose),
      withFiles: computeArtifactsSidecar,
    })
  }
  abortManifestRunIfFailed('maven', beforeExitCode)
}

export type AutoManifestContext = GenerateAutoManifestOptions & {
  sockJson: ReturnType<typeof readOrDefaultSocketJson>
  isTextMode: boolean
  sidecarAcc: SidecarAccumulator | undefined
}

export async function generateSbtAutoManifest({
  sockJson,
  cwd,
  trustSocketJson,
  outputKind,
  isTextMode,
  excludePaths,
  sidecarAcc,
  computeArtifactsSidecar,
}: AutoManifestContext): Promise<void> {
  const settings = sockJson.defaults?.manifest?.sbt ?? {}
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
  } else if (settings.facts !== false) {
    // Socket facts is the default; opt into pom generation with
    // `defaults.manifest.sbt.facts: false` in socket.json.
    if (isTextMode) {
      logger.log('Detected a Scala sbt build, generating Socket facts…')
    }
    await convertSbtToFacts({
      bin: invocation.data.bin,
      cwd,
      excludeConfigs: settings.excludeConfigs ?? '',
      excludePaths,
      ignoreUnresolved: Boolean(settings.ignoreUnresolved),
      includeConfigs: settings.includeConfigs ?? '',
      sbtOpts: invocation.data.opts,
      sidecarAcc,
      verbose: Boolean(settings.verbose),
      withFiles: computeArtifactsSidecar,
    })
  } else {
    if (isTextMode) {
      logger.log('Detected a Scala sbt build, generating pom files with sbt…')
    }
    await convertSbtToMaven({
      bin: invocation.data.bin,
      cwd,
      out: settings.outfile ?? './socket.sbt.pom.xml',
      outputKind,
      sbtOpts: invocation.data.opts,
      verbose: Boolean(settings.verbose),
    })
  }
  abortManifestRunIfFailed('sbt', beforeExitCode)
}
