import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { extractBazelToMaven } from './bazel/extract_bazel_to_maven.mts'
import { convertGradleToFacts } from './convert-gradle-to-facts.mts'
import { convertMavenToFacts } from './convert-maven-to-facts.mts'
import { convertSbtToFacts } from './convert-sbt-to-facts.mts'
import { convertGradleToMaven } from './convert_gradle_to_maven.mts'
import { convertSbtToMaven } from './convert_sbt_to_maven.mts'
import { handleManifestConda } from './handle-manifest-conda.mts'
import { parseBuildToolOpts } from './parse-build-tool-opts.mts'
import { resolveBuildToolBin } from './scripts/build-tool.mts'
import { serializeSidecar } from './scripts/sidecar.mts'
import { REQUIREMENTS_TXT, SOCKET_JSON } from '../../constants.mts'
import { InputError } from '../../utils/errors.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'

import type { GeneratableManifests } from './detect-manifest-actions.mts'
import type {
  ResolvedPathsSidecar,
  SidecarAccumulator,
} from './scripts/sidecar.mts'
import type { OutputKind } from '../../types.mts'

export type GenerateAutoManifestResult = {
  generatedFiles: string[]
  // Reachability path only: resolved on-disk paths from the build-tool run.
  resolvedPathsSidecar?: ResolvedPathsSidecar | undefined
}

// Under --auto-manifest, a manifest generator that failed — raising the exit
// code above the value captured before it ran — aborts the whole run: a partial
// or empty SBOM silently under-reports dependencies. The generator has already
// logged the specifics. A tolerated resolution failure (ignoreUnresolved) warns
// without touching the exit code, so it passes through here and the run
// continues.
function abortManifestRunIfFailed(
  ecosystem: string,
  beforeExitCode: string | number | undefined,
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
  verbose,
}: {
  // Reachability path: run build tools with files to emit the sidecar.
  computeArtifactsSidecar?: boolean | undefined
  detected: GeneratableManifests
  cwd: string
  // Scan-root-relative `--exclude-paths`: skip excluded subprojects and drop
  // excluded source roots from the resolved-paths sidecar.
  excludePaths?: string[] | undefined
  outputKind: OutputKind
  verbose: boolean
}): Promise<GenerateAutoManifestResult> {
  const sockJson = readOrDefaultSocketJson(cwd)
  const generatedFiles: string[] = []

  // Resolved paths across all JVM roots, serialized to one sidecar at the end.
  const sidecarAcc: SidecarAccumulator | undefined = computeArtifactsSidecar
    ? new Map()
    : undefined

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
      sbtOpts: parseBuildToolOpts(sockJson.defaults?.manifest?.sbt?.sbtOpts),
      verbose: Boolean(sockJson.defaults?.manifest?.sbt?.verbose),
    }
    // Socket facts is the default; opt into pom generation with
    // `defaults.manifest.sbt.facts: false` in socket.json.
    if (sockJson.defaults?.manifest?.sbt?.facts !== false) {
      logger.log('Detected a Scala sbt build, generating Socket facts...')
      const beforeExitCode = process.exitCode
      await convertSbtToFacts({
        ...sbtArgs,
        excludeConfigs: sockJson.defaults?.manifest?.sbt?.excludeConfigs ?? '',
        excludePaths,
        ignoreUnresolved: Boolean(
          sockJson.defaults?.manifest?.sbt?.ignoreUnresolved,
        ),
        includeConfigs: sockJson.defaults?.manifest?.sbt?.includeConfigs ?? '',
        sidecarAcc,
        withFiles: computeArtifactsSidecar,
      })
      abortManifestRunIfFailed('sbt', beforeExitCode)
    } else {
      logger.log('Detected a Scala sbt build, generating pom files with sbt...')
      const beforeExitCode = process.exitCode
      await convertSbtToMaven({
        ...sbtArgs,
        out: sockJson.defaults?.manifest?.sbt?.outfile ?? './pom.xml',
      })
      abortManifestRunIfFailed('sbt', beforeExitCode)
    }
  }

  if (!sockJson?.defaults?.manifest?.gradle?.disabled && detected.gradle) {
    const gradleArgs = {
      // Configured bin wins; else prefer ./gradlew, else gradle on PATH.
      bin: sockJson.defaults?.manifest?.gradle?.bin
        ? path.resolve(cwd, sockJson.defaults.manifest.gradle.bin)
        : resolveBuildToolBin('gradle', cwd),
      cwd,
      verbose: Boolean(sockJson.defaults?.manifest?.gradle?.verbose),
      gradleOpts: parseBuildToolOpts(
        sockJson.defaults?.manifest?.gradle?.gradleOpts,
      ),
    }
    // Socket facts is the default; opt into pom generation with
    // `defaults.manifest.gradle.facts: false` in socket.json.
    if (sockJson.defaults?.manifest?.gradle?.facts !== false) {
      logger.log(
        'Detected a gradle build (Gradle, Kotlin, Scala), generating Socket facts...',
      )
      const beforeExitCode = process.exitCode
      await convertGradleToFacts({
        ...gradleArgs,
        excludeConfigs:
          sockJson.defaults?.manifest?.gradle?.excludeConfigs ?? '',
        excludePaths,
        ignoreUnresolved: Boolean(
          sockJson.defaults?.manifest?.gradle?.ignoreUnresolved,
        ),
        includeConfigs:
          sockJson.defaults?.manifest?.gradle?.includeConfigs ?? '',
        sidecarAcc,
        withFiles: computeArtifactsSidecar,
      })
      abortManifestRunIfFailed('gradle', beforeExitCode)
    } else {
      logger.log(
        'Detected a gradle build (Gradle, Kotlin, Scala), running default gradle generator...',
      )
      const beforeExitCode = process.exitCode
      await convertGradleToMaven(gradleArgs)
      abortManifestRunIfFailed('gradle', beforeExitCode)
    }
  }

  if (!sockJson?.defaults?.manifest?.maven?.disabled && detected.maven) {
    logger.log('Detected a Maven pom.xml build, generating Socket facts...')
    const beforeExitCode = process.exitCode
    await convertMavenToFacts({
      // Configured bin wins; else prefer ./mvnw, else mvn on PATH.
      bin:
        sockJson.defaults?.manifest?.maven?.bin ??
        resolveBuildToolBin('maven', cwd),
      cwd,
      excludeConfigs: sockJson.defaults?.manifest?.maven?.excludeConfigs ?? '',
      excludePaths,
      ignoreUnresolved: Boolean(
        sockJson.defaults?.manifest?.maven?.ignoreUnresolved,
      ),
      includeConfigs: sockJson.defaults?.manifest?.maven?.includeConfigs ?? '',
      mavenOpts: parseBuildToolOpts(
        sockJson.defaults?.manifest?.maven?.mavenOpts,
      ),
      sidecarAcc,
      verbose: Boolean(sockJson.defaults?.manifest?.maven?.verbose),
      withFiles: computeArtifactsSidecar,
    })
    abortManifestRunIfFailed('maven', beforeExitCode)
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
        // Hybrid handling: still upload the partial SBOM, but be loud AND
        // leave a machine-readable trail. The extractor writes a completeness
        // summary (complete=false + per-hub/workspace breakdown) into the
        // manifest dir; that summary is the structured signal a downstream
        // consumer reads to know this upload is known-incomplete.
        const incomplete = mavenResult.workspaceOutcomes
          .flatMap(w =>
            w.load === 'failed'
              ? [`${w.relPath || '.'} (workspace load failed)`]
              : w.hubs
                  .filter(
                    h => h.state === 'failed' || h.state === 'indeterminate',
                  )
                  .map(h => `${w.relPath || '.'}@${h.hub} (${h.state})`),
          )
          .join(', ')
        logger.warn(
          `WARNING: Bazel Maven manifest generation was PARTIAL (${mavenResult.manifestPaths.length} manifest(s) written); the uploaded SBOM is known-incomplete and may under-report dependencies. Incomplete: ${incomplete || 'see completeness summary'}. Uploading what was generated.`,
        )
      }
    } else {
      logger.info('No supported Bazel Maven ecosystem detected.')
    }
  }

  return {
    generatedFiles,
    resolvedPathsSidecar:
      sidecarAcc && sidecarAcc.size ? serializeSidecar(sidecarAcc) : undefined,
  }
}
