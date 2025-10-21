import { logger } from '@socketsecurity/lib/logger'
import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { getFlagListOutput } from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'
import { hasDefaultApiToken } from '../../utils/socket/sdk.mjs'
import { checkCommandInput } from '../../utils/validation/check-input.mts'
import { handleQuota } from './handle-quota.mts'

const config: CliCommandConfig = {
  commandName: 'quota',
  description: 'List organizations associated with the Socket API token',
  hidden: true,
  flags: {
    ...commonFlags,
    ...outputFlags,
  },
  help: (command, _config) => `
    Usage
      $ ${command} [options]

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} --json
  `,
}

export const cmdOrganizationQuota = {
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
    parentName,
    importMeta,
  })

  const dryRun = !!cli.flags['dryRun']

  const json = Boolean(cli.flags['json'])

  const markdown = Boolean(cli.flags['markdown'])

  const hasApiToken = hasDefaultApiToken()

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      fail: 'omit one',
    },
    {
      nook: true,
      test: hasApiToken,
      message: 'This command requires a Socket API token for access',
      fail: 'try `socket login`',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleQuota(outputKind)
}
