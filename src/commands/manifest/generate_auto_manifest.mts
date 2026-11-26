import { extractBazelToMaven } from './bazel/extract_bazel_to_maven.mts'
import { cascadedReachability } from './build-root-config.mts'
import { convertDotnetToFacts } from './convert-dotnet-to-facts.mts'
import { convertGradleToMaven } from './convert_gradle_to_maven.mts'
import { convertSbtToMaven } from './convert_sbt_to_maven.mts'
import {
  getSkipReason,
  resolveEcosystemConfig,
  socketFactsRunOptions,
} from './generate-recursive-manifests.mts'
import { handleManifestConda } from './handle-manifest-conda.mts'
import {
  readsReachabilitySettings,
  runManifestFacts,
} from './run-manifest-facts.mts'
import { BUILD_TOOLS } from './scripts/build-tool.mts'
import {
  ENVIRONMENT_YML,
  REQUIREMENTS_TXT,
  SOCKET_JSON,
} from '../../constants.mts'
import { InputError } from '../../utils/errors.mts'
import { logger } from '../../utils/logger.mts'
import {
  readOrDefaultSocketJson,
  readSocketJsonChain,
} from '../../utils/socket-json.mts'

import type { GeneratableManifests } from './detect-manifest-actions.mts'
import type { EcosystemBuildConfig } from './generate-recursive-manifests.mts'
import type {
  BuildOptionHints,
  CommandHints,
  RunManifestFactsOutcome,
  SocketFactsContext,
} from './run-manifest-facts.mts'
import type { BuildTool } from './scripts/build-tool.mts'
import type { OutputKind } from '../../types.mts'

// Auto-manifest reads every build option from the root socket.json.
const AUTO_MANIFEST_HINTS: Omit<BuildOptionHints, keyof CommandHints> = {
  setupCommand: 'socket manifest setup',
  socketJson: SOCKET_JSON,
}

export type GenerateAutoManifestResult = {
  generatedFiles: string[]
}

// A failed generator aborts --auto-manifest: a partial SBOM silently
// under-reports dependencies. Facts generators return null on failure; the
// others only change the exit code.
function abortFactsRunIfFailed(
  ecosystem: string,
  outcome: RunManifestFactsOutcome,
): void {
  if (outcome === null) {
    throw new InputError(
      `Auto-manifest generation failed for the ${ecosystem} project; aborting (see the errors above).`,
    )
  }
}

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
  context,
  cwd,
  detected,
  excludePaths,
  hints: commandHints,
  outputKind,
  verbose,
}: {
  context?: SocketFactsContext | undefined
  detected: GeneratableManifests
  cwd: string
  // Scan-root-relative `--exclude-paths`: skip excluded subprojects.
  excludePaths?: string[] | undefined
  // A failure message must name an option the invoking command accepts.
  hints: CommandHints
  outputKind: OutputKind
  verbose: boolean
}): Promise<GenerateAutoManifestResult> {
  const sockJson = readOrDefaultSocketJson(cwd)
  const generatedFiles: string[] = []
  const hints: BuildOptionHints = { ...AUTO_MANIFEST_HINTS, ...commandHints }

  if (verbose) {
    logger.info(`Using this ${SOCKET_JSON} for defaults:`, sockJson)
  }

  const configOf = (tool: BuildTool) =>
    resolveEcosystemConfig(tool, cwd, sockJson)

  // Read only by a reachability scan for the tools that generate facts, so
  // checked only for those, and before any build runs.
  const generatesFacts = (tool: BuildTool) =>
    detected[tool] && !getSkipReason(tool, sockJson.defaults?.manifest?.[tool])
  const reachabilityChain = readsReachabilitySettings(context)
    ? readSocketJsonChain(cwd)
    : undefined
  const reachabilityByTool = new Map(
    reachabilityChain
      ? BUILD_TOOLS.filter(generatesFacts).map(tool => [
          tool,
          cascadedReachability(tool, reachabilityChain),
        ])
      : [],
  )

  const generateFacts = async (
    tool: BuildTool,
    config: EcosystemBuildConfig,
  ) => {
    const outcome = await runManifestFacts(
      socketFactsRunOptions(tool, { dir: cwd }, config, {
        context,
        excludeBase: cwd,
        excludePaths,
        hints,
        reachability: reachabilityByTool.get(tool),
      }),
    )
    abortFactsRunIfFailed(tool, outcome)
  }

  if (!sockJson?.defaults?.manifest?.sbt?.disabled && detected.sbt) {
    const config = configOf('sbt')
    // Socket facts is the default; opt into pom generation with
    // `defaults.manifest.sbt.facts: false` in socket.json.
    if (sockJson.defaults?.manifest?.sbt?.facts !== false) {
      logger.log('Detected a Scala sbt build, generating Socket facts...')
      await generateFacts('sbt', config)
    } else {
      logger.log('Detected a Scala sbt build, generating pom files with sbt...')
      const beforeExitCode = process.exitCode
      await convertSbtToMaven({
        bin: config.bin,
        cwd,
        out: sockJson.defaults?.manifest?.sbt?.outfile ?? './pom.xml',
        sbtOpts: config.buildOpts,
        verbose: config.verbose,
      })
      abortManifestRunIfFailed('sbt', beforeExitCode)
    }
  }

  if (!sockJson?.defaults?.manifest?.gradle?.disabled && detected.gradle) {
    const config = configOf('gradle')
    // Socket facts is the default; opt into pom generation with
    // `defaults.manifest.gradle.facts: false` in socket.json.
    if (sockJson.defaults?.manifest?.gradle?.facts !== false) {
      logger.log(
        'Detected a gradle build (Gradle, Kotlin, Scala), generating Socket facts...',
      )
      await generateFacts('gradle', config)
    } else {
      logger.log(
        'Detected a gradle build (Gradle, Kotlin, Scala), running default gradle generator...',
      )
      const beforeExitCode = process.exitCode
      await convertGradleToMaven({
        bin: config.bin,
        cwd,
        gradleOpts: config.buildOpts,
        verbose: config.verbose,
      })
      abortManifestRunIfFailed('gradle', beforeExitCode)
    }
  }

  if (!sockJson?.defaults?.manifest?.maven?.disabled && detected.maven) {
    logger.log('Detected a Maven pom.xml build, generating Socket facts...')
    // Maven resolves relative arguments such as `--file` and `--settings`
    // from where it starts, so it starts here with mavenOpts as written.
    await generateFacts('maven', configOf('maven'))
  }

  if (!sockJson?.defaults?.manifest?.dotnet?.disabled && detected.dotnet) {
    logger.log(
      'Detected a .NET solution or project, generating Socket facts...',
    )
    const outcome = await convertDotnetToFacts({
      config: configOf('dotnet'),
      context,
      cwd,
      excludePaths,
      hints,
      reachability: reachabilityByTool.get('dotnet'),
    })
    abortFactsRunIfFailed('dotnet', outcome)
  }

  if (!sockJson?.defaults?.manifest?.conda?.disabled && detected.conda) {
    const condaFile =
      sockJson.defaults?.manifest?.conda?.infile ||
      detected.condaFile ||
      ENVIRONMENT_YML
    logger.log(`Detected ${condaFile}, running default Conda generator...`)
    const beforeExitCode = process.exitCode
    await handleManifestConda({
      cwd,
      filename: condaFile,
      outputKind,
      out: sockJson.defaults?.manifest?.conda?.outfile ?? REQUIREMENTS_TXT,
      verbose: Boolean(sockJson.defaults?.manifest?.conda?.verbose),
    })
    abortManifestRunIfFailed('conda', beforeExitCode)
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

  return { generatedFiles }
}
