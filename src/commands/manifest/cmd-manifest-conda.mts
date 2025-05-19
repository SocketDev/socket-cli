import { logger } from '@socketsecurity/registry/lib/logger'

import { handleManifestConda } from './handle-manifest-conda.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

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
    cwd: {
      type: 'string',
      description: 'Set the cwd, defaults to process.cwd()',
    },
    out: {
      type: 'string',
      default: '-',
      description: 'Output target (use `-` or omit to print to stdout)',
    },
    verbose: {
      type: 'boolean',
      description: 'Print debug messages',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} FILE

    Warning: While we don't support Conda necessarily, this tool extracts the pip
             block from an environment.yml and outputs it as a requirements.txt
             which you can scan as if it were a pypi package.

    USE AT YOUR OWN RISK

    Note: FILE can be a dash (-) to indicate stdin. This way you can pipe the
          contents of a file to have it processed.

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples

      $ ${command} ./environment.yml
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

  const {
    cwd = process.cwd(),
    json = false,
    markdown = false,
    out = '-',
    verbose = false,
  } = cli.flags
  const outputKind = getOutputKind(json, markdown) // TODO: impl json/md further

  const [target = ''] = cli.input

  if (verbose) {
    logger.group('- ', parentName, config.commandName, ':')
    logger.group('- flags:', cli.flags)
    logger.groupEnd()
    logger.log('- target:', target)
    logger.log('- output:', out)
    logger.groupEnd()
  }

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      test: !!target,
      message: 'The FILE arg is required',
      pass: 'ok',
      fail: 'missing',
    },
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

  logger.error(
    'Warning: This will approximate your Conda dependencies using PyPI. We do not yet officially support Conda. Use at your own risk.',
  )

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleManifestConda(
    target,
    String(out || ''),
    json ? 'json' : markdown ? 'markdown' : 'text',
    String(cwd),
    Boolean(verbose),
  )
}
