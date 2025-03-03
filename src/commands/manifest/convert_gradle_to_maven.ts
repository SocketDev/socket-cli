import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants'

export async function convertGradleToMaven(
  target: string,
  bin: string,
  _out: string,
  verbose: boolean,
  gradleOpts: string[]
) {
  // Lazily access constants.spinner.
  const { spinner } = constants
  const rbin = path.resolve(bin)
  const rtarget = path.resolve(target)

  if (verbose) {
    logger.group('gradle2maven:')
    logger.log(`[VERBOSE] - Absolute bin path: \`${rbin}\``)
    logger.log(`[VERBOSE] - Absolute target path: \`${rtarget}\``)
    logger.groupEnd()
  } else {
    logger.group('gradle2maven:')
    logger.log(`- executing: \`${bin}\``)
    logger.log(`- src dir: \`${target}\``)
    logger.groupEnd()
  }

  spinner.start(
    `Converting gradle to maven from \`${bin}\` on \`${target}\`...`
  )

  try {
    // Run sbt with the init script we provide which should yield zero or more pom files.
    // We have to figure out where to store those pom files such that we can upload them and predict them through the GitHub API.
    // We could do a .socket folder. We could do a socket.pom.gz with all the poms, although I'd prefer something plain-text if it is to be committed.

    // Note: init.gradle will be exported by .config/rollup.dist.config.mjs
    const initLocation = path.join(constants.rootDistPath, 'init.gradle')
    const commandArgs = ['--init-script', initLocation, ...gradleOpts, 'pom']

    if (verbose) {
      spinner.log('[VERBOSE] Executing:', bin, commandArgs)
    }
    const output = await spawn(bin, commandArgs, {
      cwd: target || '.'
    })

    spinner.stop()

    if (verbose) {
      logger.group('[VERBOSE] gradle stdout:')
      logger.log(output)
      logger.groupEnd()
    }
    if (output.stderr) {
      logger.error('There were errors while running gradle')
      // (In verbose mode, stderr was printed above, no need to repeat it)
      if (!verbose) {
        logger.group('[VERBOSE] stderr:')
        logger.error(output.stderr)
        logger.groupEnd()
      }
      process.exit(1)
    }
    logger.success('Executed gradle successfully')
    logger.log('Reported exports:')
    output.stdout.replace(
      /^POM file copied to: (.*)/gm,
      (_all: string, fn: string) => {
        logger.log('- ', fn)
        return fn
      }
    )

    // const loc = output.stdout?.match(/Wrote (.*?.pom)\n/)?.[1]?.trim()
    // if (!loc) {
    //   logger.error(
    //     'There were no errors from sbt but could not find the location of resulting .pom file either'
    //   )
    //   process.exit(1)
    // }
    //
    // // Move the pom file to ...? initial cwd? loc will be an absolute path, or dump to stdout
    // if (out === '-') {
    //   spinner.start('Result:\n```')
    //   spinner.log(await safeReadFile(loc, 'utf8'))
    //   spinner.log('```')
    //   spinner.successAndStop(`OK`)
    // } else {
    //   spinner.start()
    //   if (verbose) {
    //     spinner.log(
    //       `Moving manifest file from \`${loc.replace(/^\/home\/[^/]*?\//, '~/')}\` to \`${out}\``
    //     )
    //   } else {
    //     spinner.log('Moving output pom file')
    //   }
    //   // TODO: do we prefer fs-extra? renaming can be gnarly on windows and fs-extra's version is better
    //   await renamep(loc, out)
    //   spinner.successAndStop(`OK. File should be available in \`${out}\``)
    // }
  } catch (e: any) {
    spinner.stop()
    logger.error(
      'There was an unexpected error while running this' +
        (verbose ? '' : ' (use --verbose for details)')
    )
    if (verbose) {
      logger.group('[VERBOSE] error:')
      logger.log(e)
      logger.groupEnd()
    }
    process.exit(1)
  }
}
