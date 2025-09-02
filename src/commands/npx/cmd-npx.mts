import { createRequire } from 'node:module'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagApiRequirementsOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const require = createRequire(import.meta.url)

const { DRY_RUN_BAILING_NOW } = constants

const CMD_NAME = 'npx'

const description = 'Run npx with the Socket wrapper'

const hidden = false

export const cmdNpx = {
  description,
  hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: {
      ...commonFlags,
    },
    help: (command, _config) => `
    Usage
      $ ${command} ...

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Note: Everything after "npx" is passed to the npx command.
          Only the \`--dry-run\` and \`--help\` flags are caught here.

    Use \`socket wrapper on\` to alias this command as \`npx\`.

    Examples
      $ ${command} cowsay
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  const shadowBin = /*@__PURE__*/ require(constants.shadowNpmBinPath)
  await shadowBin('npx', argv, { stdio: 'inherit' })
}
