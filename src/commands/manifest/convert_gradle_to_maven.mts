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
}: { bin: string; cwd: string; verbose: boolean; gradleOpts: string[] }) {
  // TODO: impl json/md

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
    const output = await execGradleWithSpinner(rBin, commandArgs, cwd)
    if (verbose) {
      logger.group('[VERBOSE] gradle stdout:')
      logger.log(output)
      logger.groupEnd()
    }
    if (output.code !== 0) {
      process.exitCode = 1
      logger.fail(`Gradle exited with exit code ${output.code}`)
      // (In verbose mode, stderr was printed above, no need to repeat it)
      if (!verbose) {
        logger.group('stderr:')
        logger.error(output.stderr)
        logger.groupEnd()
      }
      return
    }
    logger.success('Executed gradle successfully')
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

async function execGradleWithSpinner(
  bin: string,
  commandArgs: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  let pass = false
  try {
    logger.info(
      '(Running gradle can take a while, it depends on how long gradlew has to run)',
    )
    logger.info(
      '(It will show no output, you can use --verbose to see its output)',
    )
    spinner.start(`Running gradlew`)

    const output = await spawn(bin, commandArgs, {
      // We can pipe the output through to have the user see the result
      // of running gradlew, but then we can't (easily) gather the output
      // to discover the generated files... probably a flag we should allow?
      // stdio: isDebug() ? 'inherit' : undefined,
      cwd,
    })

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
