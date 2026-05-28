import fs from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'

export async function convertGradleToFacts({
  bin,
  configs,
  cwd,
  gradleOpts,
  ignoreUnresolved,
  verbose,
}: {
  bin: string
  configs: string
  cwd: string
  gradleOpts: string[]
  ignoreUnresolved: boolean
  verbose: boolean
}): Promise<void> {
  const rBin = path.resolve(cwd, bin)
  const binExists = fs.existsSync(rBin)
  const cwdExists = fs.existsSync(cwd)

  logger.group('gradle2facts:')
  logger.info(`- executing: \`${rBin}\``)
  if (!binExists) {
    logger.warn(
      `Warning: It appears the executable could not be found. An error might be printed later because of that.`,
    )
  }
  logger.info(`- src dir: \`${cwd}\``)
  if (!cwdExists) {
    logger.warn(
      `Warning: It appears the src dir could not be found. An error might be printed later because of that.`,
    )
  }
  logger.groupEnd()

  try {
    // The init script is bundled alongside the existing pom-generating one.
    // See .config/rollup.dist.config.mjs:copySocketFactsInitGradle.
    const initLocation = path.join(
      constants.distPath,
      'socket-facts.init.gradle',
    )
    // Disable Gradle's configuration cache for the facts run. The init
    // script resolves dependencies via the legacy
    // `Configuration.resolvedConfiguration` API (the only public API that
    // surfaces classifier + extension metadata) and registers per-
    // subproject tasks that share a `gradle.ext` accumulator — neither
    // pattern is compatible with the configuration cache, which would
    // otherwise be on by default for projects with
    // `org.gradle.configuration-cache=true` in `gradle.properties`. The
    // Provider-based CC-safe alternatives (`ResolutionResult` /
    // `ArtifactView.resolvedArtifacts`) only exist in Gradle 7.4+ and
    // they don't expose classifier/extension, so they aren't a usable
    // replacement here. Using `-D` rather than `--no-configuration-cache`
    // keeps us compatible with older Gradle versions that don't recognize
    // the flag — the system property is silently ignored when the
    // feature doesn't exist.
    // Both knobs are passed as Gradle project properties so the init script
    // can read them via `rp.findProperty(...)`, matching how
    // `socket.outputDirectory` / `socket.outputFile` are already wired.
    const socketProps: string[] = []
    if (ignoreUnresolved) {
      socketProps.push('-Psocket.ignoreUnresolved=true')
    }
    if (configs) {
      socketProps.push(`-Psocket.configs=${configs}`)
    }
    const commandArgs = [
      '-Dorg.gradle.configuration-cache=false',
      ...socketProps,
      '--init-script',
      initLocation,
      ...gradleOpts,
      'socketFacts',
    ]
    if (verbose) {
      logger.log('[VERBOSE] Executing:', [bin], ', args:', commandArgs)
    }
    logger.log(`Generating Socket facts from \`${bin}\` on \`${cwd}\` ...`)
    const output = await execGradle(rBin, commandArgs, cwd, verbose)
    if (output.code) {
      process.exitCode = 1
      logger.fail(`Gradle exited with exit code ${output.code}`)
      if (!verbose) {
        logger.group('stderr:')
        logger.error(output.stderr)
        logger.groupEnd()
      }
      return
    }
    logger.success('Executed gradle successfully')
    if (verbose) {
      // Output already streamed; the "Reported exports:" summary lines were
      // visible inline. No need to repeat them from a captured stdout.
      logger.log('')
      logger.log(
        'Next step is to generate a Scan by running the `socket scan create` command on the same directory.',
      )
      return
    }
    const exports = Array.from(
      output.stdout.matchAll(/^Socket facts file written to: (.*)/gm),
      m => m[1],
    )
    if (exports.length) {
      logger.log('Reported exports:')
      for (const fn of exports) {
        logger.log('- ', fn)
      }
    } else {
      // Gradle script may have skipped emission when no resolvable
      // dependencies were found (see the `components.isEmpty()` branch in
      // socket-facts.init.gradle). Surface the skip reason if present so
      // the user understands why nothing was written.
      const skipMatch = output.stdout.match(
        /^\[socket-facts\] no resolvable dependencies.*/m,
      )
      if (skipMatch) {
        logger.warn(skipMatch[0])
      }
    }
    logger.log('')
    logger.log(
      'Next step is to generate a Scan by running the `socket scan create` command on the same directory.',
    )
  } catch (e) {
    process.exitCode = 1
    logger.fail(
      'There was an unexpected error while generating Socket facts' +
        (verbose ? '' : '  (use --verbose for details)'),
    )
    if (verbose) {
      logger.group('[VERBOSE] error:')
      logger.log(e)
      logger.groupEnd()
    }
  }
}

async function execGradle(
  bin: string,
  commandArgs: string[],
  cwd: string,
  verbose: boolean,
): Promise<{ code: number; stdout: string; stderr: string }> {
  // When verbose, stream gradle stdout/stderr directly to the user's
  // terminal — no spinner, no capture. The trade-off is that the post-run
  // "Reported exports:" summary is skipped (the lines were already visible
  // inline). For huge builds where the user wants to see progress, this is
  // the right default. Non-verbose runs still get the spinner + summary.
  if (verbose) {
    logger.info(
      '(Running gradle with output streaming. This can take a while.)',
    )
    const output = await spawn(bin, commandArgs, { cwd, stdio: 'inherit' })
    return { code: output.code, stdout: '', stderr: '' }
  }

  const { spinner } = constants
  let pass = false
  try {
    logger.info(
      '(Running gradle can take a while, depending on the size of the project)',
    )
    logger.info(
      '(No live output. Pass --verbose to stream gradle output instead.)',
    )
    spinner.start(`Running gradlew...`)
    const output = await spawn(bin, commandArgs, { cwd })
    pass = true
    const { code, stderr, stdout } = output
    return { code, stdout, stderr }
  } finally {
    if (pass) {
      spinner.successAndStop('Gracefully completed gradlew execution.')
    } else {
      spinner.failAndStop('There was an error while trying to run gradlew.')
    }
  }
}
