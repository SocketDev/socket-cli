import path from 'node:path'

import { isDirSync } from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'

import { extractBazelToMaven } from './bazel/extract_bazel_to_maven.mts'
import { convertDotnetToFacts } from './convert-dotnet-to-facts.mts'
import { convertGradleToMaven } from './convert_gradle_to_maven.mts'
import { convertSbtToMaven } from './convert_sbt_to_maven.mts'
import {
  resolveEcosystemConfig,
  socketFactsRunOptions,
} from './generate-recursive-manifests.mts'
import { handleManifestConda } from './handle-manifest-conda.mts'
import { parseBuildToolOpts } from './parse-build-tool-opts.mts'
import {
  REACH_CONTINUE_ON_INSTALL_ERRORS_FLAG,
  keepFacts,
  runManifestFacts,
} from './run-manifest-facts.mts'
import { resolveBuildToolBin } from './scripts/build-tool.mts'
import {
  ENVIRONMENT_YML,
  REQUIREMENTS_TXT,
  SOCKET_JSON,
} from '../../constants.mts'
import { InputError } from '../../utils/errors.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'

import type { GeneratableManifests } from './detect-manifest-actions.mts'
import type { BuildRoot } from './discover-manifest-roots.mts'
import type { EcosystemBuildConfig } from './generate-recursive-manifests.mts'
import type {
  BuildOptionHints,
  RunManifestFactsOutcome,
  SocketFactsContext,
} from './run-manifest-facts.mts'
import type { BuildTool } from './scripts/build-tool.mts'
import type { OutputKind } from '../../types.mts'

// Auto-manifest reads every build option from the root socket.json.
const AUTO_MANIFEST_HINTS: BuildOptionHints = {
  flags: new Set(),
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

// Maven's `-f, --file`: "Force the use of an alternate POM file (or directory
// with pom.xml)" (`mvn --help`), relative to where Maven runs.
function mavenRoot(cwd: string, file: string | undefined): BuildRoot {
  if (file === undefined) {
    return { dir: cwd, entryFile: 'pom.xml' }
  }
  const named = path.resolve(cwd, file)
  return isDirSync(named)
    ? { dir: named, entryFile: 'pom.xml' }
    : { dir: path.dirname(named), entryFile: path.basename(named) }
}

// A command naming a path runs that file, relative to `dir`; a bare name is
// looked up on PATH.
function binIn(dir: string, bin: string): string {
  return /[/\\]/.test(bin) ? path.resolve(dir, bin) : bin
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
  excludePathsFlag,
  outputKind,
  verbose,
}: {
  context?: SocketFactsContext | undefined
  detected: GeneratableManifests
  cwd: string
  // Scan-root-relative `--exclude-paths`: skip excluded subprojects.
  excludePaths?: string[] | undefined
  // The invoking command's flag for `excludePaths`, when it takes one.
  excludePathsFlag?: string | undefined
  outputKind: OutputKind
  verbose: boolean
}): Promise<GenerateAutoManifestResult> {
  const sockJson = readOrDefaultSocketJson(cwd)
  const generatedFiles: string[] = []
  const hints: BuildOptionHints = {
    ...AUTO_MANIFEST_HINTS,
    continueOnInstallErrorsFlag: context?.workDir?.withFiles
      ? REACH_CONTINUE_ON_INSTALL_ERRORS_FLAG
      : undefined,
    excludePathsFlag,
  }

  if (verbose) {
    logger.info(`Using this ${SOCKET_JSON} for defaults:`, sockJson)
  }

  const generateFacts = async (
    tool: BuildTool,
    root: BuildRoot,
    config: EcosystemBuildConfig,
  ) => {
    const outcome = await runManifestFacts(
      socketFactsRunOptions(tool, root, config, {
        context,
        excludeBase: cwd,
        excludePaths,
        hints,
      }),
    )
    if (outcome) {
      await keepFacts(context?.workDir, outcome)
    }
    abortFactsRunIfFailed(tool, outcome)
  }

  if (!sockJson?.defaults?.manifest?.sbt?.disabled && detected.sbt) {
    // Socket facts is the default; opt into pom generation with
    // `defaults.manifest.sbt.facts: false` in socket.json.
    if (sockJson.defaults?.manifest?.sbt?.facts !== false) {
      logger.log('Detected a Scala sbt build, generating Socket facts...')
      await generateFacts(
        'sbt',
        { dir: cwd },
        resolveEcosystemConfig('sbt', cwd, sockJson),
      )
    } else {
      logger.log('Detected a Scala sbt build, generating pom files with sbt...')
      const beforeExitCode = process.exitCode
      await convertSbtToMaven({
        // Note: `sbt` is more likely to be resolved against PATH env.
        bin: sockJson.defaults?.manifest?.sbt?.bin ?? 'sbt',
        cwd,
        out: sockJson.defaults?.manifest?.sbt?.outfile ?? './pom.xml',
        sbtOpts: parseBuildToolOpts(
          sockJson.defaults?.manifest?.sbt?.sbtOpts ?? undefined,
        ),
        verbose: Boolean(sockJson.defaults?.manifest?.sbt?.verbose),
      })
      abortManifestRunIfFailed('sbt', beforeExitCode)
    }
  }

  if (!sockJson?.defaults?.manifest?.gradle?.disabled && detected.gradle) {
    // Socket facts is the default; opt into pom generation with
    // `defaults.manifest.gradle.facts: false` in socket.json.
    if (sockJson.defaults?.manifest?.gradle?.facts !== false) {
      logger.log(
        'Detected a gradle build (Gradle, Kotlin, Scala), generating Socket facts...',
      )
      await generateFacts(
        'gradle',
        { dir: cwd },
        resolveEcosystemConfig('gradle', cwd, sockJson),
      )
    } else {
      logger.log(
        'Detected a gradle build (Gradle, Kotlin, Scala), running default gradle generator...',
      )
      const beforeExitCode = process.exitCode
      await convertGradleToMaven({
        // Configured bin wins; else prefer ./gradlew, else gradle on PATH.
        bin: sockJson.defaults?.manifest?.gradle?.bin
          ? path.resolve(cwd, sockJson.defaults.manifest.gradle.bin)
          : resolveBuildToolBin('gradle', cwd),
        cwd,
        verbose: Boolean(sockJson.defaults?.manifest?.gradle?.verbose),
        gradleOpts: parseBuildToolOpts(
          sockJson.defaults?.manifest?.gradle?.gradleOpts ?? undefined,
        ),
      })
      abortManifestRunIfFailed('gradle', beforeExitCode)
    }
  }

  if (!sockJson?.defaults?.manifest?.maven?.disabled && detected.maven) {
    logger.log('Detected a Maven pom.xml build, generating Socket facts...')
    const config = resolveEcosystemConfig('maven', cwd, sockJson)
    await generateFacts('maven', mavenRoot(cwd, config.mavenFile), {
      ...config,
      // Maven runs in the POM's directory, which `--file` can move.
      bin: binIn(cwd, config.bin),
    })
  }

  if (!sockJson?.defaults?.manifest?.dotnet?.disabled && detected.dotnet) {
    logger.log(
      'Detected a .NET solution or project, generating Socket facts...',
    )
    const outcome = await convertDotnetToFacts({
      config: resolveEcosystemConfig('dotnet', cwd, sockJson),
      context,
      cwd,
      excludePaths,
      hints,
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
