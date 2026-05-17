import { handleQuota } from './handle-quota.mts'
import { outputDryRunFetch } from '../../util/dry-run/output.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { getFlagListOutput } from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { hasDefaultApiToken } from '../../util/socket/sdk.mjs'
import { checkCommandInput } from '../../util/validation/check-input.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'

const config = {
  commandName: 'quota',
  description:
    'Show remaining Socket API quota for the current token, plus refresh window',
  hidden: false,
  flags: defineFlags({
    ...commonFlags,
    ...outputFlags,
  }),
  help: (command: string, _config: { flags: MeowFlags }) => `
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

export async function run(
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
    outputDryRunFetch('organization quota')
    return
  }

  await handleQuota(outputKind)
}
