import { promises as fs } from 'node:fs'
import path from 'node:path'

import { safeReadFile } from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { getErrorCause } from '../../utils/errors.mts'

// Walk up from a pom path to find a `target` directory ancestor and return
// its parent (the project root). Returns undefined if no `target` ancestor
// is found, which means we cannot safely lift the file out of the ignored
// build dir.
function findProjectRootAboveTarget(pomPath: string): string | undefined {
  let dir = path.dirname(pomPath)
  const { root } = path.parse(dir)
  while (dir !== root) {
    if (path.basename(dir) === 'target') {
      return path.dirname(dir)
    }
    dir = path.dirname(dir)
  }
  return undefined
}

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

  const { spinner } = constants

  logger.group('sbt2maven:')
  logger.info(`- executing: \`${bin}\``)
  logger.info(`- src dir: \`${cwd}\``)
  logger.groupEnd()

  try {
    spinner.start(`Converting sbt to maven from \`${bin}\` on \`${cwd}\`...`)

    // Run sbt with the init script we provide which should yield zero or more
    // pom files. We have to figure out where to store those pom files such that
    // we can upload them and predict them through the GitHub API. We could do a
    // .socket folder. We could do a socket.pom.gz with all the poms, although
    // I'd prefer something plain-text if it is to be committed.
    const output = await spawn(bin, ['makePom', ...sbtOpts], { cwd })

    spinner.stop()

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
    output.stdout.replace(/Wrote (.*?.pom)\n/g, (_all: string, fn: string) => {
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
      logger.success(`OK`)
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
      // sbt writes poms inside each project's `target/` directory, which is
      // typically gitignored. Copy them out to a sibling of `target/` so
      // downstream SBOM/scan steps see them.
      const copied: string[] = []
      const outBasename = path.basename(out) || 'pom.xml'
      for (const pomPath of poms) {
        let destPath: string
        if (poms.length === 1 && out !== outBasename) {
          // Honor the full `--out` path verbatim when exactly one pom was
          // produced and the user (or default) supplied a path, not just a
          // bare filename.
          destPath = path.resolve(cwd, out)
        } else {
          const projectRoot = findProjectRootAboveTarget(pomPath)
          if (!projectRoot) {
            logger.warn(
              `Could not locate \`target/\` ancestor for \`${pomPath}\`, leaving in place`,
            )
            continue
          }
          destPath = path.join(projectRoot, outBasename)
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          await fs.mkdir(path.dirname(destPath), { recursive: true })
          // eslint-disable-next-line no-await-in-loop
          await fs.copyFile(pomPath, destPath)
          copied.push(destPath)
        } catch (e) {
          logger.warn(
            `Failed to copy \`${pomPath}\` to \`${destPath}\`: ${getErrorCause(e)}`,
          )
        }
      }
      logger.success(
        `Generated ${copied.length} pom file${copied.length === 1 ? '' : 's'}`,
      )
      logger.log('Reported exports:')
      for (const fn of copied) {
        logger.log('-', fn)
      }
    }
  } catch (e) {
    process.exitCode = 1
    spinner.stop()
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
