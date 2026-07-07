import { promises as fs } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { renderResolutionErrorReport } from './scripts/resolution-report-render.mts'
import { runManifestScript } from './scripts/run.mts'
import { accumulateSidecar } from './scripts/sidecar.mts'
import constants from '../../constants.mts'

import type { BuildTool } from './scripts/build-tool.mts'
import type { ManifestRunResult } from './scripts/run.mts'
import type { SidecarAccumulator } from './scripts/sidecar.mts'

const MAX_FAILURE_OUTPUT_LINES = 40

// Last N non-empty lines of the captured build output, for diagnosing a crash
// without forcing a --verbose rebuild.
function tailBuildOutput(stdout: string, stderr: string): string {
  const combined = [stdout, stderr]
    .map(s => s.trimEnd())
    .filter(Boolean)
    .join('\n')
  return combined.split('\n').slice(-MAX_FAILURE_OUTPUT_LINES).join('\n')
}

// Runs the bundled build-tool resolution script for a JVM project and writes
// `.socket.facts.json`. `withFiles` (reachability only) additionally folds
// resolved artifact paths into `sidecarAcc`. A blocking resolution failure sets
// a non-zero exit code and returns (matching the `--pom` generator) unless
// `ignoreUnresolved`; a crashed build — a process failure, not an unresolved
// dependency — always fails.
export async function runManifestFacts({
  bin,
  buildOpts,
  cwd,
  ecosystem,
  excludeConfigs,
  ignoreUnresolved,
  includeConfigs,
  sidecarAcc,
  verbose,
  withFiles,
}: {
  bin: string
  buildOpts: string[]
  cwd: string
  ecosystem: BuildTool
  excludeConfigs: string
  ignoreUnresolved: boolean
  includeConfigs: string
  sidecarAcc?: SidecarAccumulator | undefined
  verbose: boolean
  withFiles?: boolean | undefined
}): Promise<void> {
  const factsPath = path.join(cwd, constants.DOT_SOCKET_DOT_FACTS_JSON)

  logger.log(
    `Generating Socket facts for the ${ecosystem} project at \`${cwd}\` ...`,
  )

  const scriptOpts = {
    bin: bin || undefined,
    excludeConfigs: excludeConfigs || undefined,
    includeConfigs: includeConfigs || undefined,
    projectDir: cwd,
    // Stream the build tool's output only when asked; otherwise capture it and
    // show a spinner, surfacing the output only if the build crashes.
    stdio: verbose ? ('inherit' as const) : ('pipe' as const),
    toolOpts: buildOpts,
    withFiles,
  }
  const { spinner } = constants
  let result: ManifestRunResult
  try {
    if (verbose) {
      logger.info(
        `(Running ${ecosystem} with output streaming; this can take a while.)`,
      )
      result = await runManifestScript(ecosystem, scriptOpts)
    } else {
      logger.info(
        `(No live output; pass --verbose to stream the ${ecosystem} build output.)`,
      )
      spinner.start(`Resolving ${ecosystem} dependencies ...`)
      result = await runManifestScript(ecosystem, scriptOpts)
      if (result.code === 0) {
        spinner.successAndStop(`Resolved ${ecosystem} dependencies.`)
      } else {
        spinner.failAndStop(
          `${ecosystem} build exited with code ${result.code}.`,
        )
      }
    }
  } catch (e) {
    // Only a spawn-level failure (e.g. the build tool missing from PATH) reaches
    // here; runNeverThrow returns non-zero build exits rather than throwing.
    if (!verbose) {
      spinner.failAndStop(`Failed to run ${ecosystem}.`)
    }
    process.exitCode = 1
    logger.fail(
      `Could not run the ${ecosystem} build tool` +
        (verbose ? `: ${e}` : ' (run with --verbose for details).'),
    )
    return
  }
  const { artifactPaths, code, facts, report, stderr, stdout } = result

  const rendered = renderResolutionErrorReport(
    report.failures,
    report.scannedConfigs,
    ecosystem,
    { ignoreUnresolved, unscannable: report.unscannable },
  )

  if (rendered.hasBlockingFailures) {
    if (ignoreUnresolved) {
      logger.warn(rendered.summary)
    } else {
      process.exitCode = 1
      logger.fail(rendered.summary)
      if (verbose && rendered.details) {
        logger.log(rendered.details)
      }
      return
    }
  }
  if (rendered.nonBlockingNotice) {
    logger.info(rendered.nonBlockingNotice)
  }
  if (verbose && rendered.details) {
    logger.log(rendered.details)
  }

  // A non-zero build exit with no usable output (no graph, no first-party
  // modules, no failure records) means the build died before the socketFacts
  // task emitted anything — a script/plugin compile error, OOM, or an unchecked
  // exception in the extension. The build tool's own exit is the only signal, so
  // fail closed rather than silently dropping the ecosystem with an empty SBOM
  // (the empty-facts branch below would otherwise just log "nothing to upload").
  if (
    code !== 0 &&
    !facts.components.length &&
    !facts.projects?.length &&
    !report.failures.length &&
    !report.unscannable.length
  ) {
    if (!verbose) {
      const tail = tailBuildOutput(stdout, stderr)
      if (tail) {
        logger.group('Build output:')
        logger.error(tail)
        logger.groupEnd()
      }
    }
    // A crashed build is a process failure (missing JDK/build tool, unparseable
    // project, OOM, plugin error), not an unresolved dependency, so it fails
    // regardless of `ignoreUnresolved` — that flag only tolerates dependencies a
    // successful run couldn't resolve.
    process.exitCode = 1
    logger.fail(
      `The ${ecosystem} build failed (exit code ${code}) before producing any Socket facts.`,
    )
    return
  }

  // Nothing resolved at all — no dependencies and no first-party modules. A
  // project with only first-party modules (empty components, non-empty projects)
  // still has source roots reachability needs, so it must be written.
  if (!facts.components.length && !facts.projects?.length) {
    logger.warn(
      `No resolvable ${ecosystem} dependencies found; nothing to upload.`,
    )
    return
  }

  await fs.writeFile(factsPath, JSON.stringify(facts, null, 2), 'utf8')

  if (withFiles && sidecarAcc) {
    accumulateSidecar(sidecarAcc, facts, artifactPaths)
  }

  logger.success('Generated Socket facts')
}
