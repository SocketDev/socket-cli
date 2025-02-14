import path from 'node:path'

import meow from 'meow'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { convertGradleToMaven } from './convert_gradle_to_maven.ts'
import { commonFlags } from '../../flags.ts'
import { getFlagListOutput } from '../../utils/output-formatting.ts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

// TODO: we may want to dedupe some pieces for all gradle languages. I think it
//       makes sense to have separate commands for them and I think it makes
//       sense for the help panels to note the requested language, rather than
//       `socket manifest kotlin` to print help screens with `gradle` as the
//       command. Room for improvement.
const config: CliCommandConfig = {
  commandName: 'kotlin',
  description:
    'Use Gradle to generate a manifest file (`pom.xml`) for a Kotlin project',
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
      description: 'Task to target. By default targets all.'
    },
    verbose: {
      type: 'boolean',
      description: 'Print debug messages'
    }
  },
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName} [--gradle=path/to/gradle/binary] [--out=path/to/result] DIR

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

    Examples

      $ ${parentName} ${config.commandName} .
      $ ${parentName} ${config.commandName} --gradlew=../gradlew .
  `
}

export const cmdManifestKotlin = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  // note: meow will exit if it prints the --help screen
  const cli = meow(config.help(parentName, config), {
    flags: config.flags,
    argv: argv.length === 0 ? ['--help'] : argv,
    description: config.description,
    allowUnknownFlags: false,
    importMeta
  })

  const verbose = Boolean(cli.flags['verbose'])

  if (verbose) {
    console.group('- ', parentName, config.commandName, ':')
    console.group('- flags:', cli.flags)
    console.groupEnd()
    console.log('- input:', cli.input)
    console.groupEnd()
  }

  const target = cli.input[0]
  if (!target) {
    // will exit.
    new Spinner()
      .start('Parsing...')
      .error(
        `Failure: Missing DIR argument. See \`${parentName} ${config.commandName} --help\` for details.`
      )
    process.exit(1)
  }

  if (cli.input.length > 1) {
    // will exit.
    new Spinner()
      .start('Parsing...')
      .error(
        `Failure: Can only accept one FILE or DIR, received ${cli.input.length} (make sure to escape spaces!). See \`${parentName} ${config.commandName} --help\` for details.`
      )
    process.exit(1)
  }

  let bin: string
  if (cli.flags['bin']) {
    bin = cli.flags['bin'] as string
  } else {
    bin = path.join(target, './gradlew')
  }

  let out: string = './socket.pom.xml'
  if (cli.flags['out']) {
    out = cli.flags['out'] as string
  }
  if (cli.flags['stdout']) {
    out = '-'
  }

  // TODO: I'm not sure it's feasible to parse source file from stdin. We could try, store contents in a file in some folder, target that folder... what would the file name be?
  if (target === '-') {
    new Spinner()
      .start('Parsing...')
      .error(
        `Failure: Currently source code from stdin is not supported. See \`${parentName} ${config.commandName} --help\` for details.`
      )
    process.exit(1)
  }

  if (verbose) {
    console.group()
    console.log('- target:', target)
    console.log('- gradle bin:', bin)
    console.log('- out:', out)
    console.groupEnd()
  }

  let gradleOpts: Array<string> = []
  if (cli.flags['gradleOpts']) {
    gradleOpts = (cli.flags['gradleOpts'] as string)
      .split(' ')
      .map(s => s.trim())
      .filter(Boolean)
  }

  await convertGradleToMaven(target, bin, out, verbose, gradleOpts)
}
