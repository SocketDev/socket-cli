import fs from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'

export async function convertGradleToFacts({
  bin,
  cwd,
  gradleOpts,
  verbose,
}: {
  bin: string
  cwd: string
  gradleOpts: string[]
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
    const commandArgs = [
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
    logger.log('Reported exports:')
    output.stdout.replace(
      /^Socket facts file written to: (.*)/gm,
      (_all: string, fn: string) => {
        logger.log('- ', fn)
        return fn
      },
    )
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
