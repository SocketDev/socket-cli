import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleScanReach } from './handle-scan-reach.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'reach',
  description: 'Compute tier 1 reachability',
  hidden: true,
  flags: {
    ...commonFlags,
    ...outputFlags,
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.]

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command}
      $ ${command} ./proj
  `,
}

export const cmdScanReach = {
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

  const { dryRun, json, markdown } = cli.flags

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(outputKind)
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  const { unknownFlags } = cli

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  await handleScanReach({
    cwd,
    outputKind,
    unknownFlags,
  })
}
