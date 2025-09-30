import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { convertSbtToMaven } from './convert_sbt_to_maven.mts'
import constants, { REQUIREMENTS_TXT, SOCKET_JSON } from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { debugFn } from '../../utils/debug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

const config: CliCommandConfig = {
  commandName: 'scala',
  description:
    "[beta] Generate a manifest file (`pom.xml`) from Scala's `build.sbt` file",
  hidden: false,
  flags: {
    ...commonFlags,
    bin: {
      type: 'string',
      description: 'Location of sbt binary to use',
    },
    out: {
      type: 'string',
      description:
        'Path of output file; where to store the resulting manifest, see also --stdout',
    },
    stdout: {
      type: 'boolean',
      description: 'Print resulting pom.xml to stdout (supersedes --out)',
    },
    sbtOpts: {
      type: 'string',
      description: 'Additional options to pass on to sbt, as per `sbt --help`',
    },
    verbose: {
      type: 'boolean',
      description: 'Print debug messages',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.]

    Options
      ${getFlagListOutput(config.flags)}

    Uses \`sbt makePom\` to generate a \`pom.xml\` from your \`build.sbt\` file.
    This xml file is the dependency manifest (like a package.json
    for Node.js or ${REQUIREMENTS_TXT} for PyPi), but specifically for Scala.

    There are some caveats with \`build.sbt\` to \`pom.xml\` conversion:

    - the xml is exported as socket.pom.xml as to not confuse existing build tools
      but it will first hit your /target/sbt<version> folder (as a different name)

    - the pom.xml format (standard by Scala) does not support certain sbt features
      - \`excludeAll()\`, \`dependencyOverrides\`, \`force()\`, \`relativePath\`
      - For details: https://www.scala-sbt.org/1.x/docs/Library-Management.html

    - it uses your sbt settings and local configuration verbatim

    - it can only export one target per run, so if you have multiple targets like
      development and production, you must run them separately.

    You can specify --bin to override the path to the \`sbt\` binary to invoke.

    Support is beta. Please report issues or give us feedback on what's missing.

    This is only for SBT. If your Scala setup uses gradle, please see the help
    sections for \`socket manifest gradle\` or \`socket cdxgen\`.

    Examples

      $ ${command}
      $ ${command} ./proj --bin=/usr/bin/sbt --file=boot.sbt
  `,
}

export const cmdManifestScala = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { json = false, markdown = false } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  // TODO: Implement json/md further.
  const outputKind = getOutputKind(json, markdown)

  const sockJson = readOrDefaultSocketJson(cwd)

  debugFn(
    'inspect',
    `override: ${SOCKET_JSON} sbt`,
    sockJson?.defaults?.manifest?.sbt,
  )

  let { bin, out, sbtOpts, stdout, verbose } = cli.flags

  // Set defaults for any flag/arg that is not given. Check socket.json first.
  if (!bin) {
    if (sockJson.defaults?.manifest?.sbt?.bin) {
      bin = sockJson.defaults?.manifest?.sbt?.bin
      logger.info(`Using default --bin from ${SOCKET_JSON}:`, bin)
    } else {
      bin = 'sbt'
    }
  }
  if (
    stdout === undefined &&
    sockJson.defaults?.manifest?.sbt?.stdout !== undefined
  ) {
    stdout = sockJson.defaults?.manifest?.sbt?.stdout
    logger.info(`Using default --stdout from ${SOCKET_JSON}:`, stdout)
  }
  if (stdout) {
    out = '-'
  } else if (!out) {
    if (sockJson.defaults?.manifest?.sbt?.outfile) {
      out = sockJson.defaults?.manifest?.sbt?.outfile
      logger.info(`Using default --out from ${SOCKET_JSON}:`, out)
    } else {
      out = './socket.pom.xml'
    }
  }
  if (!sbtOpts) {
    if (sockJson.defaults?.manifest?.sbt?.sbtOpts) {
      sbtOpts = sockJson.defaults?.manifest?.sbt?.sbtOpts
      logger.info(`Using default --sbt-opts from ${SOCKET_JSON}:`, sbtOpts)
    } else {
      sbtOpts = ''
    }
  }
  if (
    verbose === undefined &&
    sockJson.defaults?.manifest?.sbt?.verbose !== undefined
  ) {
    verbose = sockJson.defaults?.manifest?.sbt?.verbose
    logger.info(`Using default --verbose from ${SOCKET_JSON}:`, verbose)
  } else if (verbose === undefined) {
    verbose = false
  }

  if (verbose) {
    logger.group('- ', parentName, config.commandName, ':')
    logger.group('- flags:', cli.flags)
    logger.groupEnd()
    logger.log('- input:', cli.input)
    logger.groupEnd()
  }

  // TODO: We're not sure it's feasible to parse source file from stdin. We could
  //       try, store contents in a file in some folder, target that folder... what
  //       would the file name be?

  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: cli.input.length <= 1,
    message: 'Can only accept one DIR (make sure to escape spaces!)',
    fail: 'received ' + cli.input.length,
  })
  if (!wasValidInput) {
    return
  }

  if (verbose) {
    logger.group()
    logger.log('- target:', cwd)
    logger.log('- sbt bin:', bin)
    logger.log('- out:', out)
    logger.groupEnd()
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  await convertSbtToMaven({
    bin: String(bin),
    cwd: cwd,
    out: String(out),
    sbtOpts: String(sbtOpts)
      .split(' ')
      .map(s => s.trim())
      .filter(Boolean),
    verbose: Boolean(verbose),
  })
}
