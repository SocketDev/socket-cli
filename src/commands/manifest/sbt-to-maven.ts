import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

import spawn from '@npmcli/promise-spawn'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { safeReadFile } from '../../utils/fs.ts'

const renamep = util.promisify(fs.rename)

export async function sbtToMaven(
  target: string,
  bin: string,
  out: string,
  verbose: boolean,
  sbtOpts: Array<string>
) {
  const rbin = path.resolve(bin)
  const rtarget = path.resolve(target)
  const rout = out === '-' ? '-' : path.resolve(out)

  if (verbose) {
    console.log(`[VERBOSE] - Absolute bin path: \`${rbin}\``)
    console.log(`[VERBOSE] - Absolute target path: \`${rtarget}\``)
    console.log(`[VERBOSE] - Absolute out path: \`${rout}\``)
  } else {
    console.log(`- executing: \`${bin}\``)
    console.log(`- src dir: \`${target}\``)
    console.log(`- dst dir: \`${out}\``)
  }

  const spinner = new Spinner()

  spinner.start(`Running sbt from \`${bin}\` on \`${target}\`...`)

  try {
    // We must now run sbt, pick the generated xml from the /target folder (the stdout should tell you the location upon success) and store it somewhere else.
    // TODO: Not sure what this somewhere else might be tbh.

    const output = await spawn(bin, ['makePom'].concat(sbtOpts), {
      cwd: target || '.'
    })
    spinner.success()
    if (verbose) {
      console.group('[VERBOSE] sbt stdout:')
      console.log(output)
      console.groupEnd()
    }

    if (output.stderr) {
      spinner.error('There were errors while running sbt')
      // (In verbose mode, stderr was printed above, no need to repeat it)
      if (!verbose) {
        console.group('[VERBOSE] stderr:')
        console.error(output.stderr)
        console.groupEnd()
      }
      process.exit(1)
    }

    const loc = output.stdout?.match(/Wrote (.*?.pom)\n/)?.[1]?.trim()
    if (!loc) {
      spinner.error(
        'There were no errors from sbt but could not find the location of resulting .pom file either'
      )
      process.exit(1)
    }

    // Move the pom file to ...? initial cwd? loc will be an absolute path, or dump to stdout
    if (out === '-') {
      spinner.start('Result:\n```').success()
      console.log(await safeReadFile(loc, 'utf8'))
      console.log('```')
      spinner.start().success(`OK`)
    } else {
      if (verbose) {
        spinner.start(
          `Moving manifest file from \`${loc.replace(/^\/home\/[^/]*?\//, '~/')}\` to \`${out}\``
        )
      } else {
        spinner.start('Moving output pom file')
      }
      // TODO: do we prefer fs-extra? renaming can be gnarly on windows and fs-extra's version is better
      await renamep(loc, out)
      spinner.success()
      spinner.start().success(`OK. File should be available in \`${out}\``)
    }
  } catch (e) {
    spinner.error(
      'There was an unexpected error while running this' +
        (verbose ? '' : ' (use --verbose for details)')
    )
    if (verbose) {
      console.group('[VERBOSE] error:')
      console.log(e)
      console.groupEnd()
    }
    process.exit(1)
  }
}
