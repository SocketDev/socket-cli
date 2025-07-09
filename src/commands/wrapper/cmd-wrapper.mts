import { existsSync } from 'node:fs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { addSocketWrapper } from './add-socket-wrapper.mts'
import { checkSocketWrapperSetup } from './check-socket-wrapper-setup.mts'
import { postinstallWrapper } from './postinstall-wrapper.mts'
import { removeSocketWrapper } from './remove-socket-wrapper.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

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
  { parentName }: { parentName: string },
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

  const { json, markdown } = cli.flags
  const outputKind = getOutputKind(json, markdown) // TODO: impl json/md further

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

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      test: enable || disable,
      message: 'Must specify "on" or "off" argument',
      pass: 'ok',
      fail: 'missing',
    },
    {
      nook: true,
      test: cli.input.length <= 1,
      message: 'expecting exactly one argument',
      pass: 'ok',
      fail: `got multiple`,
    },
  )
  if (!wasValidInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  // Lazily access constants.bashRcPath and constants.zshRcPath.
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
