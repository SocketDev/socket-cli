import path from 'node:path'

import spawn from '@npmcli/promise-spawn'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { safeReadFile } from '../../utils/fs'

export async function convertSbtToMaven(
  target: string,
  bin: string,
  out: string,
  verbose: boolean,
  sbtOpts: Array<string>
) {
  const rbin = path.resolve(bin)
  const rtarget = path.resolve(target)
  // const rout = out === '-' ? '-' : path.resolve(out)

  if (verbose) {
    console.group('sbt2maven:')
    console.log(`[VERBOSE] - Absolute bin path: \`${rbin}\``)
    console.log(`[VERBOSE] - Absolute target path: \`${rtarget}\``)
    // console.log(`[VERBOSE] - Absolute out path: \`${rout}\``)
    console.groupEnd()
  } else {
    console.group('sbt2maven:')
    console.log(`- executing: \`${bin}\``)
    console.log(`- src dir: \`${target}\``)
    // console.log(`- dst dir: \`${out}\``)
    console.groupEnd()
  }

  const spinner = new Spinner()

  spinner.start(`Converting sbt to maven from \`${bin}\` on \`${target}\`...`)

  try {
    // Run sbt with the init script we provide which should yield zero or more pom files.
    // We have to figure out where to store those pom files such that we can upload them and predict them through the GitHub API.
    // We could do a .socket folder. We could do a socket.pom.gz with all the poms, although I'd prefer something plain-text if it is to be committed.

    const output = await spawn(bin, ['makePom'].concat(sbtOpts), {
      cwd: target || '.'
    })
    spinner.successAndStop()
    if (verbose) {
      console.group('[VERBOSE] sbt stdout:')
      console.log(output)
      console.groupEnd()
    }

    if (output.stderr) {
      spinner.start()
      spinner.errorAndStop('There were errors while running sbt')
      // (In verbose mode, stderr was printed above, no need to repeat it)
      if (!verbose) {
        console.group('[VERBOSE] stderr:')
        console.error(output.stderr)
        console.groupEnd()
      }
      process.exit(1)
    }

    const poms: Array<string> = []
    output.stdout.replace(/Wrote (.*?.pom)\n/g, (_all: string, fn: string) => {
      poms.push(fn)
      return fn
    })

    if (!poms.length) {
      spinner.errorAndStop(
        'There were no errors from sbt but it seems to not have generated any poms either'
      )
      process.exit(1)
    }

    // Move the pom file to ...? initial cwd? loc will be an absolute path, or dump to stdout
    // TODO: what to do with multiple output files? Do we want to dump them to stdout? Raw or with separators or ?
    // TODO: maybe we can add an option to target a specific file to dump to stdout
    if (out === '-' && poms.length === 1) {
      spinner.start('Result:\n```').success()
      console.log(await safeReadFile(poms[0] as string, 'utf8'))
      console.log('```')
      spinner.start().success(`OK`)
    } else if (out === '-') {
      spinner
        .start()
        .error(
          'Requested out target was stdout but there are multiple generated files'
        )
      poms.forEach(fn => console.error('-', fn))
      console.error('Exiting now...')
      process.exit(1)
    } else {
      // if (verbose) {
      //   spinner.start(
      //     `Moving manifest file from \`${loc.replace(/^\/home\/[^/]*?\//, '~/')}\` to \`${out}\``
      //   )
      // } else {
      //   spinner.start('Moving output pom file')
      // }
      // TODO: do we prefer fs-extra? renaming can be gnarly on windows and fs-extra's version is better
      // await renamep(loc, out)
      spinner.start().success(`Generated ${poms.length} pom files`)
      poms.forEach(fn => console.log('-', fn))
      spinner.start().success(`OK`)
    }
  } catch (e) {
    spinner.errorAndStop(
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
