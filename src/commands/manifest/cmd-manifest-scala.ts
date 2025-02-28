import colors from 'yoctocolors-cjs'

import { convertSbtToMaven } from './convert_sbt_to_maven'
import { commonFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const config: CliCommandConfig = {
  commandName: 'scala',
  description:
    "[beta] Generate a manifest file (`pom.xml`) from Scala's `build.sbt` file",
  hidden: false,
  flags: {
    ...commonFlags,
    bin: {
      type: 'string',
      default: 'sbt',
      description: 'Location of sbt binary to use'
    },
    cwd: {
      type: 'string',
      description: 'Set the cwd, defaults to process.cwd()'
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
    sbtOpts: {
      type: 'string',
      default: '',
      description: 'Additional options to pass on to sbt, as per `sbt --help`'
    },
    verbose: {
      type: 'boolean',
      description: 'Print debug messages'
    }
  },
  help: (command, config) => `
    Usage
      $ ${command} [--sbt=path/to/sbt/binary] [--out=path/to/result] FILE|DIR

    Options
      ${getFlagListOutput(config.flags, 6)}

    Uses \`sbt makePom\` to generate a \`pom.xml\` from your \`build.sbt\` file.
    This xml file is the dependency manifest (like a package.json
    for Node.js or requirements.txt for PyPi), but specifically for Scala.

    There are some caveats with \`build.sbt\` to \`pom.xml\` conversion:

    - the xml is exported as socket.pom.xml as to not confuse existing build tools
      but it will first hit your /target/sbt<version> folder (as a different name)

    - the pom.xml format (standard by Scala) does not support certain sbt features
      - \`excludeAll()\`, \`dependencyOverrides\`, \`force()\`, \`relativePath\`
      - For details: https://www.scala-sbt.org/1.x/docs/Library-Management.html

    - it uses your sbt settings and local configuration verbatim

    - it can only export one target per run, so if you have multiple targets like
      development and production, you must run them separately.

    You can optionally configure the path to the \`sbt\` bin to invoke.

    Support is beta. Please report issues or give us feedback on what's missing.

    Examples

      $ ${command} ./build.sbt
      $ ${command} --bin=/usr/bin/sbt ./build.sbt
  `
}

export const cmdManifestScala = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  // console.log('scala', argv, parentName)
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
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

  // TODO: I'm not sure it's feasible to parse source file from stdin. We could try, store contents in a file in some folder, target that folder... what would the file name be?

  if (!target || target === '-' || cli.input.length > 1) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    console.error(
      `${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - The DIR or FILE arg is required ${!target ? colors.red('(missing!)') : target === '-' ? colors.red('(stdin is not supported)') : colors.green('(ok)')}\n
      - Can only accept one DIR or FILE (make sure to escape spaces!) ${cli.input.length > 1 ? colors.red(`(received ${cli.input.length}!)`) : colors.green('(ok)')}\n`
    )
    return
  }

  let bin: string = 'sbt'
  if (cli.flags['bin']) {
    bin = cli.flags['bin'] as string
  }

  let out: string = './socket.pom.xml'
  if (cli.flags['out']) {
    out = cli.flags['out'] as string
  }
  if (cli.flags['stdout']) {
    out = '-'
  }

  if (verbose) {
    console.group()
    console.log('- target:', target)
    console.log('- gradle bin:', bin)
    console.log('- out:', out)
    console.groupEnd()
  }

  let sbtOpts: Array<string> = []
  if (cli.flags['sbtOpts']) {
    sbtOpts = (cli.flags['sbtOpts'] as string)
      .split(' ')
      .map(s => s.trim())
      .filter(Boolean)
  }

  if (cli.flags['dryRun']) {
    return console.log('[DryRun] Bailing now')
  }

  await convertSbtToMaven(target, bin, out, verbose, sbtOpts)
}
