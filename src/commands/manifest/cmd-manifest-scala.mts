import { logger } from '@socketsecurity/registry/lib/logger'

import { convertSbtToMaven } from './convert_sbt_to_maven.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { checkCommandInput } from '../../utils/handle-bad-input.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAIL_TEXT } = constants

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
      $ ${command} [--bin=path/to/sbt/binary] [--out=path/to/result] FILE|DIR

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

    This is only for SBT. If your Scala setup uses gradle, please see the help
    sections for \`socket manifest gradle\` or \`socket cdxgen\`.

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
  const { json, markdown } = cli.flags
  const outputKind = getOutputKind(json, markdown) // TODO: impl json/md further

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

  const wasBadInput = checkCommandInput(
    outputKind,
    {
      test: !!target && target !== '-',
      message: 'The DIR arg is required',
      pass: 'ok',
      fail: target === '-' ? 'stdin is not supported' : 'missing'
    },
    {
      nook: true,
      test: cli.input.length <= 1,
      message: 'Can only accept one DIR (make sure to escape spaces!)',
      pass: 'ok',
      fail: 'received ' + cli.input.length
    }
  )
  if (wasBadInput) {
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
    logger.group()
    logger.log('- target:', target)
    logger.log('- gradle bin:', bin)
    logger.log('- out:', out)
    logger.groupEnd()
  }

  let sbtOpts: string[] = []
  if (cli.flags['sbtOpts']) {
    sbtOpts = (cli.flags['sbtOpts'] as string)
      .split(' ')
      .map(s => s.trim())
      .filter(Boolean)
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await convertSbtToMaven(target, bin, out, verbose, sbtOpts)
}
