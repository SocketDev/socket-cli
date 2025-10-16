import { getSpinner } from '@socketsecurity/registry/constants/process'
import { safeReadFile } from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

export async function convertSbtToMaven({
  bin,
  cwd,
  out,
  sbtOpts,
  verbose,
}: {
  bin: string
  cwd: string
  out: string
  sbtOpts: string[]
  verbose: boolean
}) {
  // TODO: Implement json/md.

  logger.group('sbt2maven:')
  logger.info(`- executing: \`${bin}\``)
  logger.info(`- src dir: \`${cwd}\``)
  logger.groupEnd()

  const spinner = getSpinner()
  try {
    spinner?.start(`Converting sbt to maven from \`${bin}\` on \`${cwd}\`...`)

    // Run sbt with the init script we provide which should yield zero or more
    // pom files. We have to figure out where to store those pom files such that
    // we can upload them and predict them through the GitHub API. We could do a
    // .socket folder. We could do a socket.pom.gz with all the poms, although
    // I'd prefer something plain-text if it is to be committed.
    const output = await spawn(bin, ['makePom', ...sbtOpts], { cwd })

    spinner?.stop()

    if (verbose) {
      logger.group('[VERBOSE] sbt stdout:')
      logger.log(output)
      logger.groupEnd()
    }
    if (output.stderr) {
      process.exitCode = 1
      logger.fail('There were errors while running sbt')
      // (In verbose mode, stderr was printed above, no need to repeat it)
      if (!verbose) {
        logger.group('[VERBOSE] stderr:')
        logger.error(output.stderr)
        logger.groupEnd()
      }
      return
    }
    const poms: string[] = []
    const stdoutStr =
      typeof output.stdout === 'string'
        ? output.stdout
        : output.stdout.toString('utf8')
    stdoutStr.replace(/Wrote (.*?.pom)\n/g, (_all: string, fn: string) => {
      poms.push(fn)
      return fn
    })
    if (!poms.length) {
      process.exitCode = 1
      logger.fail(
        'There were no errors from sbt but it seems to not have generated any poms either',
      )
      return
    }
    // Move the pom file to ...? initial cwd? loc will be an absolute path, or dump to stdout
    // TODO: What do we do with multiple output files? Do we want to dump them to stdout? Raw or with separators or ?
    // TODO: Maybe we can add an option to target a specific file to dump to stdout.
    if (out === '-' && poms.length === 1) {
      logger.log('Result:\n```')
      logger.log(await safeReadFile(poms[0]!))
      logger.log('```')
      logger.success('OK')
    } else if (out === '-') {
      process.exitCode = 1
      logger.error('')
      logger.fail(
        'Requested output target was stdout but there are multiple generated files',
      )
      logger.error('')
      poms.forEach(fn => logger.info('-', fn))
      if (poms.length > 10) {
        logger.error('')
        logger.fail(
          'Requested output target was stdout but there are multiple generated files',
        )
      }
      logger.error('')
      logger.info('Exiting now...')
      return
    } else {
      // if (verbose) {
      //   logger.log(
      //     `Moving manifest file from \`${loc.replace(/^\/home\/[^/]*?\//, '~/')}\` to \`${out}\``
      //   )
      // } else {
      //   logger.log('Moving output pom file')
      // }
      // TODO: Do we prefer fs-extra? Renaming can be gnarly on windows and fs-extra's version is better.
      // await renamep(loc, out)
      logger.success(`Generated ${poms.length} pom files`)
      poms.forEach(fn => logger.log('-', fn))
      logger.success('OK')
    }
  } catch (e) {
    process.exitCode = 1
    spinner?.stop()
    logger.fail(
      'There was an unexpected error while running this' +
        (verbose ? '' : ' (use --verbose for details)'),
    )
    if (verbose) {
      logger.group('[VERBOSE] error:')
      logger.log(e)
      logger.groupEnd()
    }
  }
}
