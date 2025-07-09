import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleManifestConda } from './handle-manifest-conda.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { readOrDefaultSocketJson } from '../../utils/socketjson.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'conda',
  description:
    '[beta] Convert a Conda environment.yml file to a python requirements.txt',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    file: {
      type: 'string',
      description:
        'Input file name (by default for Conda this is "environment.yml"), relative to cwd',
    },
    stdin: {
      type: 'boolean',
      description: 'Read the input from stdin (supersedes --file)',
    },
    out: {
      type: 'string',
      description: 'Output path (relative to cwd)',
    },
    stdout: {
      type: 'boolean',
      description:
        'Print resulting requirements.txt to stdout (supersedes --out)',
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
             block from an environment.yml and outputs it as a requirements.txt
             which you can scan as if it were a pypi package.

    USE AT YOUR OWN RISK

    Note: FILE can be a dash (-) to indicate stdin. This way you can pipe the
          contents of a file to have it processed.

    Options
      ${getFlagListOutput(config.flags)}

    Examples

      $ ${command}
      $ ${command} ./project/foo --file environment.yaml
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
  { parentName }: { parentName: string },
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { json = false, markdown = false } = cli.flags
  let { file: filename, out, stdin, stdout, verbose } = cli.flags
  const outputKind = getOutputKind(json, markdown)
  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  const sockJson = await readOrDefaultSocketJson(cwd)

  // Set defaults for any flag/arg that is not given. Check socket.json first.
  if (
    stdin === undefined &&
    sockJson.defaults?.manifest?.conda?.stdin !== undefined
  ) {
    stdin = sockJson.defaults?.manifest?.conda?.stdin
    logger.info('Using default --stdin from socket.json:', stdin)
  }
  if (stdin) {
    filename = '-'
  } else if (!filename) {
    if (sockJson.defaults?.manifest?.conda?.infile) {
      filename = sockJson.defaults?.manifest?.conda?.infile
      logger.info('Using default --file from socket.json:', filename)
    } else {
      filename = 'environment.yml'
    }
  }
  if (
    stdout === undefined &&
    sockJson.defaults?.manifest?.conda?.stdout !== undefined
  ) {
    stdout = sockJson.defaults?.manifest?.conda?.stdout
    logger.info('Using default --stdout from socket.json:', stdout)
  }
  if (stdout) {
    out = '-'
  } else if (!out) {
    if (sockJson.defaults?.manifest?.conda?.outfile) {
      out = sockJson.defaults?.manifest?.conda?.outfile
      logger.info('Using default --out from socket.json:', out)
    } else {
      out = 'requirements.txt'
    }
  }
  if (
    verbose === undefined &&
    sockJson.defaults?.manifest?.conda?.verbose !== undefined
  ) {
    verbose = sockJson.defaults?.manifest?.conda?.verbose
    logger.info('Using default --verbose from socket.json:', verbose)
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

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: cli.input.length <= 1,
      message: 'Can only accept one DIR (make sure to escape spaces!)',
      pass: 'ok',
      fail: 'received ' + cli.input.length,
    },
    {
      nook: true,
      test: !json || !markdown,
      message:
        'The `--json` and `--markdown` flags can not be used at the same time',
      pass: 'ok',
      fail: 'bad',
    },
  )
  if (!wasValidInput) {
    return
  }

  logger.warn(
    'Warning: This will approximate your Conda dependencies using PyPI. We do not yet officially support Conda. Use at your own risk.',
  )

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleManifestConda({
    cwd,
    filename: String(filename),
    out: String(out || ''),
    outputKind,
    verbose: Boolean(verbose),
  })
}
