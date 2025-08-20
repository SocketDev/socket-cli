import { createRequire } from 'node:module'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagApiRequirementsOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const require = createRequire(import.meta.url)

const { DRY_RUN_BAILING_NOW } = constants

export const CMD_NAME = 'npm'

const description = 'Run npm with the Socket wrapper'

const hidden = false

export const cmdNpm = {
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
    help: command => `
    Usage
      $ ${command} ...

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Note: Everything after "npm" is passed to the npm command.
          Only the \`--dry-run\` and \`--help\` flags are caught here.

    Use \`socket wrapper on\` to alias this command as \`npm\`.

    Examples
      $ ${command}
      $ ${command} install -g cowsay
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

  // Lazily access constants.shadowNpmBinPath.
  const shadowBin = /*@__PURE__*/ require(constants.shadowNpmBinPath)
  await shadowBin('npm', argv)
}
