import fs from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'

export async function convertGradleToMaven({
  bin,
  cwd,
  gradleOpts,
  verbose,
}: {
  bin: string
  cwd: string
  verbose: boolean
  gradleOpts: string[]
}) {
  // TODO: Implement json/md.

  // Note: use resolve because the bin could be an absolute path, away from cwd
  // TODO: what about $PATH resolved commands? (`gradlew` without dir prefix)
  const rBin = path.resolve(cwd, bin)
  const binExists = fs.existsSync(rBin)
  const cwdExists = fs.existsSync(cwd)

  logger.group('gradle2maven:')
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
    // Run gradlew with the init script we provide which should yield zero or more
    // pom files. We have to figure out where to store those pom files such that
    // we can upload them and predict them through the GitHub API. We could do a
    // .socket folder. We could do a socket.pom.gz with all the poms, although
    // I'd prefer something plain-text if it is to be committed.
    // Note: init.gradle will be exported by .config/rollup.dist.config.mjs
    const initLocation = path.join(constants.distPath, 'init.gradle')
    const commandArgs = ['--init-script', initLocation, ...gradleOpts, 'pom']
    if (verbose) {
      logger.log('[VERBOSE] Executing:', [bin], ', args:', commandArgs)
    }
    logger.log(`Converting gradle to maven from \`${bin}\` on \`${cwd}\` ...`)
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
      // Output already streamed; "POM file copied to:" lines were visible
      // inline. Skip the captured-stdout summary.
      logger.log('')
      logger.log(
        'Next step is to generate a Scan by running the `socket scan create` command on the same directory',
      )
      return
    }
    logger.log('Reported exports:')
    output.stdout.replace(
      /^POM file copied to: (.*)/gm,
      (_all: string, fn: string) => {
        logger.log('- ', fn)
        return fn
      },
    )
    logger.log('')
    logger.log(
      'Next step is to generate a Scan by running the `socket scan create` command on the same directory',
    )
  } catch (e) {
    process.exitCode = 1
    logger.fail(
      'There was an unexpected error while generating manifests' +
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
  // inline). Non-verbose runs still get the spinner + summary.
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
