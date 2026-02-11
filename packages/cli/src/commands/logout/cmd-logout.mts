import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mts'
import {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_ENFORCED_ORGS,
} from '../../constants/config.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { isConfigFromFlag, updateConfigValue } from '../../utils/config.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const logger = getDefaultLogger()

export const CMD_NAME = 'logout'

const description = 'Socket API logout'

const hidden = false

// Helper functions.

function applyLogout(): void {
  updateConfigValue(CONFIG_KEY_API_TOKEN, null)
  updateConfigValue(CONFIG_KEY_API_BASE_URL, null)
  updateConfigValue(CONFIG_KEY_API_PROXY, null)
  updateConfigValue(CONFIG_KEY_ENFORCED_ORGS, null)
}

function attemptLogout(): void {
  try {
    applyLogout()
    logger.success('Successfully logged out')
    if (isConfigFromFlag()) {
      logger.log('')
      logger.warn(
        'Note: config is in read-only mode, at least one key was overridden through flag/env, so the logout was not persisted!',
      )
    }
  } catch {
    logger.fail('Failed to complete logout steps')
  }
}

// Command handler.

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
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
      $ ${command} [options]

    Logs out of the Socket API and clears all Socket credentials from disk

    Examples
      $ ${command}
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

  attemptLogout()
}

// Exported command.

export const cmdLogout = {
  description,
  hidden,
  run,
}
