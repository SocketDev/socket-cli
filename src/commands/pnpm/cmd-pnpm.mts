import { createRequire } from 'node:module'
import { PNPM } from '@socketsecurity/lib/constants/agents'
import { logger } from '@socketsecurity/lib/logger'

import {
  DRY_RUN_BAILING_NOW,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../constants/cli.mts'
import { getShadowPnpmBinPath } from '../../constants/paths.mts'
import { commonFlags } from '../../flags.mts'
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { getFlagApiRequirementsOutput } from '../../utils/output/formatting.mts'
import { filterFlags } from '../../utils/process/cmd.mts'

const require = createRequire(import.meta.url)

export const CMD_NAME = PNPM

const description = 'Wraps pnpm with Socket security scanning'

const hidden = true

export const cmdPnpm = {
  description,
  hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  context: CliCommandContext,
): Promise<void> {
  const { parentName } = { __proto__: null, ...context } as CliCommandContext
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: {
      ...commonFlags,
    },
    help: command => `
    Usage
      $ ${command} ...

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Note: Everything after "${PNPM}" is passed to the ${PNPM} command.
          Only the \`${FLAG_DRY_RUN}\` and \`${FLAG_HELP}\` flags are caught here.

    Use \`socket wrapper on\` to alias this command as \`${PNPM}\`.

    Examples
      $ ${command}
      $ ${command} install
      $ ${command} add package-name
      $ ${command} dlx package-name
    `,
  }

  const cli = meowOrExit({
    argv,
    config,
    parentName,
    importMeta,
  })

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  const shadowPnpmBin = /*@__PURE__*/ require(getShadowPnpmBinPath())

  process.exitCode = 1

  // Filter Socket flags from argv.
  const filteredArgv = filterFlags(argv, config.flags)

  const { spawnPromise } = await shadowPnpmBin(filteredArgv, {
    stdio: 'inherit',
  })

  await spawnPromise
  process.exitCode = 0
}
