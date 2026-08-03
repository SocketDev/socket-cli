import { handleConfigAuto } from './handle-config-auto.mts'
import { FLAG_JSON, FLAG_MARKDOWN } from '../../constants/cli.mts'
import { outputDryRunWrite } from '../../util/dry-run/output.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import {
  getSupportedConfigEntries,
  isSupportedConfigKey,
} from '../../util/config.mts'
import { getFlagListOutput } from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { checkCommandInput } from '../../util/validation/check-input.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'

// Flags interface for type safety.
export interface ConfigAutoFlags {
  json: boolean
  markdown: boolean
}

export const CMD_NAME = 'auto'

const description =
  'Automatically discover and set the correct value config item'

const hidden = false

export const cmdConfigAuto = {
  description,
  hidden,
  run,
}

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: defineFlags({
      ...commonFlags,
      ...outputFlags,
    }),
    help: (command: string, helpConfig: { flags: MeowFlags }) => `
    Usage
      $ ${command} [options] KEY

    Options
      ${getFlagListOutput(helpConfig.flags)}

    Attempt to automatically discover the correct value for a given config KEY.

    Examples
      $ ${command} defaultOrg

    Keys:
${getSupportedConfigEntries()
  .map(
    ({ 0: key, 1: entryDescription }) => `     - ${key} -- ${entryDescription}`,
  )
  .join('\n')}
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { json, markdown } = cli.flags

  const dryRun = cli.flags['dryRun']

  const [key = ''] = cli.input

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      test: key !== 'test' && isSupportedConfigKey(key),
      message: 'Config key should be the first arg',
      fail: key ? 'invalid config key' : 'missing',
    },
    {
      nook: true,
      test: !json || !markdown,
      message: `The \`${FLAG_JSON}\` and \`${FLAG_MARKDOWN}\` flags can not be used at the same time`,
      fail: 'bad',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    // Runtime read so tests that mutate process.env['HOME'] pick up changes.
    const configPath = `${process.env['HOME']}/.config/socket/config.json`
    outputDryRunWrite(
      configPath,
      `auto-discover and set config value for "${key}"`,
      [
        `Discover the correct value for config key: ${key}`,
        `Update config file with discovered value`,
      ],
    )
    return
  }

  // Re-assert the checkCommandInput guard for the type system.
  if (!isSupportedConfigKey(key)) {
    return
  }

  await handleConfigAuto({
    key,
    outputKind,
  })
}
