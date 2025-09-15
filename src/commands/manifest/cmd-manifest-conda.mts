import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleManifestConda } from './handle-manifest-conda.mts'
import constants, {
  ENVIRONMENT_YAML,
  ENVIRONMENT_YML,
  REQUIREMENTS_TXT,
  SOCKET_JSON,
} from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

const config: CliCommandConfig = {
  commandName: 'conda',
  description: `[beta] Convert a Conda ${ENVIRONMENT_YML} file to a python ${REQUIREMENTS_TXT}`,
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    file: {
      type: 'string',
      default: '',
      description: `Input file name (by default for Conda this is "${ENVIRONMENT_YML}"), relative to cwd`,
    },
    stdin: {
      type: 'boolean',
      description: 'Read the input from stdin (supersedes --file)',
    },
    out: {
      type: 'string',
      default: '',
      description: 'Output path (relative to cwd)',
    },
    stdout: {
      type: 'boolean',
      description: `Print resulting ${REQUIREMENTS_TXT} to stdout (supersedes --out)`,
    },
    verbose: {
      type: 'boolean',
      description: 'Print debug messages',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.]

    Warning: While we don't support Conda necessarily, this tool extracts the pip
             block from an ${ENVIRONMENT_YML} and outputs it as a ${REQUIREMENTS_TXT}
             which you can scan as if it were a PyPI package.

    USE AT YOUR OWN RISK

    Note: FILE can be a dash (-) to indicate stdin. This way you can pipe the
          contents of a file to have it processed.

    Options
      ${getFlagListOutput(config.flags)}

    Examples

      $ ${command}
      $ ${command} ./project/foo --file ${ENVIRONMENT_YAML}
  `,
}

export const cmdManifestConda = {
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

  const { dryRun, json, markdown } = cli.flags as {
    dryRun: boolean
    json: boolean
    markdown: boolean
  }

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  const sockJson = readOrDefaultSocketJson(cwd)

  let {
    file: filename,
    out,
    stdin,
    stdout,
    verbose,
  } = cli.flags as {
    file: string
    out: string
    stdin: boolean | undefined
    stdout: boolean | undefined
    verbose: boolean | undefined
  }

  // Set defaults for any flag/arg that is not given. Check socket.json first.
  if (
    stdin === undefined &&
    sockJson.defaults?.manifest?.conda?.stdin !== undefined
  ) {
    stdin = sockJson.defaults?.manifest?.conda?.stdin
    logger.info(`Using default --stdin from ${SOCKET_JSON}:`, stdin)
  }
  if (stdin) {
    filename = '-'
  } else if (!filename) {
    if (sockJson.defaults?.manifest?.conda?.infile) {
      filename = sockJson.defaults?.manifest?.conda?.infile
      logger.info(`Using default --file from ${SOCKET_JSON}:`, filename)
    } else {
      filename = ENVIRONMENT_YML
    }
  }
  if (
    stdout === undefined &&
    sockJson.defaults?.manifest?.conda?.stdout !== undefined
  ) {
    stdout = sockJson.defaults?.manifest?.conda?.stdout
    logger.info(`Using default --stdout from ${SOCKET_JSON}:`, stdout)
  }
  if (stdout) {
    out = '-'
  } else if (!out) {
    if (sockJson.defaults?.manifest?.conda?.outfile) {
      out = sockJson.defaults?.manifest?.conda?.outfile
      logger.info(`Using default --out from ${SOCKET_JSON}:`, out)
    } else {
      out = REQUIREMENTS_TXT
    }
  }
  if (
    verbose === undefined &&
    sockJson.defaults?.manifest?.conda?.verbose !== undefined
  ) {
    verbose = sockJson.defaults?.manifest?.conda?.verbose
    logger.info(`Using default --verbose from ${SOCKET_JSON}:`, verbose)
  } else if (verbose === undefined) {
    verbose = false
  }

  if (verbose) {
    logger.group('- ', parentName, config.commandName, ':')
    logger.group('- flags:', cli.flags)
    logger.groupEnd()
    logger.log('- target:', cwd)
    logger.log('- output:', out)
    logger.groupEnd()
  }

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: cli.input.length <= 1,
      message: 'Can only accept one DIR (make sure to escape spaces!)',
      fail: `received ${cli.input.length}`,
    },
    {
      nook: true,
      test: !json || !markdown,
      message:
        'The `--json` and `--markdown` flags can not be used at the same time',
      fail: 'bad',
    },
  )
  if (!wasValidInput) {
    return
  }

  logger.warn(
    'Warning: This will approximate your Conda dependencies using PyPI. We do not yet officially support Conda. Use at your own risk.',
  )

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  await handleManifestConda({
    cwd,
    filename,
    out,
    outputKind,
    verbose,
  })
}
