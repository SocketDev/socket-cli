import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { convertGradleToMaven } from './convert_gradle_to_maven'
import constants from '../../constants'
import { commonFlags } from '../../flags'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

// TODO: we may want to dedupe some pieces for all gradle languages. I think it
//       makes sense to have separate commands for them and I think it makes
//       sense for the help panels to note the requested language, rather than
//       `socket manifest kotlin` to print help screens with `gradle` as the
//       command. Room for improvement.
const config: CliCommandConfig = {
  commandName: 'kotlin',
  description:
    '[beta] Use Gradle to generate a manifest file (`pom.xml`) for a Kotlin project',
  hidden: false,
  flags: {
    ...commonFlags,
    bin: {
      type: 'string',
      description: 'Location of gradlew binary to use, default: CWD/gradlew'
    },
    cwd: {
      type: 'string',
      description: 'Set the cwd, defaults to process.cwd()'
    },
    gradleOpts: {
      type: 'string',
      default: '',
      description:
        'Additional options to pass on to ./gradlew, see `./gradlew --help`'
    },
    out: {
      type: 'string',
      default: './socket.pom.xml',
      description:
        'Path of output file; where to store the resulting manifest, see also --stdout'
    },
    stdout: {
      type: 'boolean',
      description: 'Print resulting pom.xml to stdout (supersedes --out)'
    },
    task: {
      type: 'string',
      default: 'all',
      description: 'Task to target. By default targets all'
    },
    verbose: {
      type: 'boolean',
      description: 'Print debug messages'
    }
  },
  help: (command, config) => `
    Usage
      $ ${command} [--gradle=path/to/gradle/binary] [--out=path/to/result] DIR

    Options
      ${getFlagListOutput(config.flags, 6)}

    Uses gradle, preferably through your local project \`gradlew\`, to generate a
    \`pom.xml\` file for each task. If you have no \`gradlew\` you can try the
    global \`gradle\` binary but that may not work (hard to predict).

    The \`pom.xml\` is a manifest file similar to \`package.json\` for npm or
    or requirements.txt for PyPi), but specifically for Maven, which is Java's
    dependency repository. Languages like Kotlin and Scala piggy back on it too.

    There are some caveats with the gradle to \`pom.xml\` conversion:

    - each task will generate its own xml file and by default it generates one xml
      for every task. (This may be a good thing!)

    - it's possible certain features don't translate well into the xml. If you
      think something is missing that could be supported please reach out.

    - it works with your \`gradlew\` from your repo and local settings and config

    Support is beta. Please report issues or give us feedback on what's missing.

    Examples

      $ ${command} .
      $ ${command} --gradlew=../gradlew .
  `
}

export const cmdManifestKotlin = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const verbose = Boolean(cli.flags['verbose'])

  if (verbose) {
    logger.group('- ', parentName, config.commandName, ':')
    logger.group('- flags:', cli.flags)
    logger.groupEnd()
    logger.log('- input:', cli.input)
    logger.groupEnd()
  }

  const [target = ''] = cli.input

  // TODO: I'm not sure it's feasible to parse source file from stdin. We could
  //       try, store contents in a file in some folder, target that folder... what
  //       would the file name be?

  const wasBadInput = handleBadInput(
    {
      test: target && target !== '-',
      message: 'The DIR arg is required',
      pass: 'ok',
      fail: target === '-' ? 'stdin is not supported' : 'missing'
    },
    {
      nook: true,
      test: cli.input.length === 1,
      message: 'Can only accept one DIR (make sure to escape spaces!)',
      pass: 'ok',
      fail: 'received ' + cli.input.length
    }
  )
  if (wasBadInput) {
    return
  }

  let bin: string
  if (cli.flags['bin']) {
    bin = cli.flags['bin'] as string
  } else {
    bin = path.join(target, 'gradlew')
  }

  let out: string = './socket.pom.xml'
  if (cli.flags['out']) {
    out = cli.flags['out'] as string
  }
  if (cli.flags['stdout']) {
    out = '-'
  }

  if (verbose) {
    logger.group()
    logger.log('- target:', target)
    logger.log('- gradle bin:', bin)
    logger.log('- out:', out)
    logger.groupEnd()
  }

  let gradleOpts: string[] = []
  if (cli.flags['gradleOpts']) {
    gradleOpts = (cli.flags['gradleOpts'] as string)
      .split(' ')
      .map(s => s.trim())
      .filter(Boolean)
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await convertGradleToMaven(target, bin, out, verbose, gradleOpts)
}
