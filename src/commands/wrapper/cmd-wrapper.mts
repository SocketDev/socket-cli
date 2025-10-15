import { existsSync } from 'node:fs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { addSocketWrapper } from './add-socket-wrapper.mts'
import { checkSocketWrapperSetup } from './check-socket-wrapper-setup.mts'
import { postinstallWrapper } from './postinstall-wrapper.mts'
import { removeSocketWrapper } from './remove-socket-wrapper.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { getFlagListOutput } from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'
import { checkCommandInput } from '../../utils/validation/check-input.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const config: CliCommandConfig = {
  commandName: 'wrapper',
  description: 'Enable or disable the Socket npm/npx wrapper',
  hidden: false,
  flags: {
    ...commonFlags,
  },
  help: (command, config) => `
    Usage
      $ ${command} <"on" | "off">

    Options
      ${getFlagListOutput(config.flags)}

    While enabled, the wrapper makes it so that when you call npm/npx on your
    machine, it will automatically actually run \`socket npm\` / \`socket npx\`
    instead.

    Examples
      $ ${command} on
      $ ${command} off
  `,
}

export const cmdWrapper = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  // I don't think meow would mess with this but ...
  if (argv[0] === '--postinstall') {
    await postinstallWrapper()
    return
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  // TODO: Implement json/md further.
  const { json, markdown } = cli.flags

  const dryRun = !!cli.flags.dryRun

  let enable = false
  let disable = false
  const [arg] = cli.input
  if (arg === 'on' || arg === 'enable' || arg === 'enabled') {
    enable = true
    disable = false
  } else if (arg === 'off' || arg === 'disable' || arg === 'disabled') {
    enable = false
    disable = true
  }

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      test: enable || disable,
      message: 'Must specify "on" or "off" argument',
      fail: 'missing',
    },
    {
      nook: true,
      test: cli.input.length <= 1,
      message: 'expecting exactly one argument',
      fail: 'got multiple',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  const { bashRcPath, zshRcPath } = constants
  if (enable) {
    if (existsSync(bashRcPath) && !checkSocketWrapperSetup(bashRcPath)) {
      addSocketWrapper(bashRcPath)
    }
    if (existsSync(zshRcPath) && !checkSocketWrapperSetup(zshRcPath)) {
      addSocketWrapper(zshRcPath)
    }
  } else {
    if (existsSync(bashRcPath)) {
      removeSocketWrapper(bashRcPath)
    }
    if (existsSync(zshRcPath)) {
      removeSocketWrapper(zshRcPath)
    }
  }
  if (!existsSync(bashRcPath) && !existsSync(zshRcPath)) {
    logger.fail('There was an issue setting up the alias in your bash profile')
  }
}
