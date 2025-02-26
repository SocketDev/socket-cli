import path from 'node:path'

import spawn from '@npmcli/promise-spawn'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import constants from '../../constants'

export async function convertGradleToMaven(
  target: string,
  bin: string,
  _out: string,
  verbose: boolean,
  gradleOpts: Array<string>
) {
  const rbin = path.resolve(bin)
  const rtarget = path.resolve(target)
  // const rout = out === '-' ? '-' : path.resolve(out)

  if (verbose) {
    console.group('gradle2maven:')
    console.log(`[VERBOSE] - Absolute bin path: \`${rbin}\``)
    console.log(`[VERBOSE] - Absolute target path: \`${rtarget}\``)
    // console.log(`[VERBOSE] - Absolute out path: \`${rout}\``)
    console.groupEnd()
  } else {
    console.group('gradle2maven:')
    console.log(`- executing: \`${bin}\``)
    console.log(`- src dir: \`${target}\``)
    // console.log(`- dst dir: \`${out}\``)
    console.groupEnd()
  }

  const spinner = new Spinner()

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
      console.log('\n[VERBOSE] Executing:', bin, commandArgs)
    }

    const output = await spawn(bin, commandArgs, {
      cwd: target || '.'
    })
    spinner.success()
    if (verbose) {
      console.group('[VERBOSE] gradle stdout:')
      console.log(output)
      console.groupEnd()
    }

    if (output.stderr) {
      spinner.error('There were errors while running gradle')
      // (In verbose mode, stderr was printed above, no need to repeat it)
      if (!verbose) {
        console.group('[VERBOSE] stderr:')
        console.error(output.stderr)
        console.groupEnd()
      }
      process.exit(1)
    }

    console.log('Reported exports:')
    output.stdout.replace(
      /^POM file copied to: (.*)/gm,
      (_all: string, fn: string) => {
        console.log('- ', fn)
        return fn
      }
    )

    // const loc = output.stdout?.match(/Wrote (.*?.pom)\n/)?.[1]?.trim()
    // if (!loc) {
    //   spinner.error(
    //     'There were no errors from sbt but could not find the location of resulting .pom file either'
    //   )
    //   process.exit(1)
    // }
    //
    // // Move the pom file to ...? initial cwd? loc will be an absolute path, or dump to stdout
    // if (out === '-') {
    //   spinner.start('Result:\n```').success()
    //   console.log(await safeReadFile(loc, 'utf8'))
    //   console.log('```')
    //   spinner.start().success(`OK`)
    // } else {
    //   if (verbose) {
    //     spinner.start(
    //       `Moving manifest file from \`${loc.replace(/^\/home\/[^/]*?\//, '~/')}\` to \`${out}\``
    //     )
    //   } else {
    //     spinner.start('Moving output pom file')
    //   }
    //   // TODO: do we prefer fs-extra? renaming can be gnarly on windows and fs-extra's version is better
    //   await renamep(loc, out)
    //   spinner.success()
    //   spinner.start().success(`OK. File should be available in \`${out}\``)
    // }
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
