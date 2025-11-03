import { existsSync } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { addSocketWrapper } from './add-socket-wrapper.mts'
import { checkSocketWrapperSetup } from './check-socket-wrapper-setup.mts'
import { postinstallWrapper } from './postinstall-wrapper.mts'
import { removeSocketWrapper } from './remove-socket-wrapper.mts'
import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mjs'
import { getBashRcPath, getZshRcPath } from '../../constants/paths.mjs'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { getFlagListOutput } from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'
import { checkCommandInput } from '../../utils/validation/check-input.mts'
const logger = getDefaultLogger()


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

  // Feature request: Implement json/markdown output for wrapper command status.
  const { json, markdown } = cli.flags

  const dryRun = !!cli.flags['dryRun']

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
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  const bashRcPath = getBashRcPath()
  const zshRcPath = getZshRcPath()
  const modifiedFiles: string[] = []
  const skippedFiles: string[] = []

  if (enable) {
    if (existsSync(bashRcPath)) {
      if (!checkSocketWrapperSetup(bashRcPath)) {
        addSocketWrapper(bashRcPath)
        modifiedFiles.push(bashRcPath)
      } else {
        skippedFiles.push(bashRcPath)
      }
    }
    if (existsSync(zshRcPath)) {
      if (!checkSocketWrapperSetup(zshRcPath)) {
        addSocketWrapper(zshRcPath)
        modifiedFiles.push(zshRcPath)
      } else {
        skippedFiles.push(zshRcPath)
      }
    }
  } else {
    if (existsSync(bashRcPath)) {
      removeSocketWrapper(bashRcPath)
      modifiedFiles.push(bashRcPath)
    }
    if (existsSync(zshRcPath)) {
      removeSocketWrapper(zshRcPath)
      modifiedFiles.push(zshRcPath)
    }
  }

  if (!existsSync(bashRcPath) && !existsSync(zshRcPath)) {
    logger.fail(
      'There was an issue setting up the alias in your bash profile',
    )
    return
  }

  // Output results in requested format.
  if (outputKind === 'json') {
    const result = {
      action: enable ? 'enabled' : 'disabled',
      modifiedFiles,
      skippedFiles,
      success: modifiedFiles.length > 0 || skippedFiles.length > 0,
    }
    logger.log(JSON.stringify(result, null, 2))
  } else if (outputKind === 'markdown') {
    const arr = []
    arr.push(`# Socket Wrapper ${enable ? 'Enabled' : 'Disabled'}`)
    arr.push('')

    if (modifiedFiles.length > 0) {
      arr.push('## Modified Files')
      arr.push('')
      for (const file of modifiedFiles) {
        arr.push(`- \`${file}\``)
      }
      arr.push('')
    }

    if (skippedFiles.length > 0) {
      arr.push('## Skipped Files (already configured)')
      arr.push('')
      for (const file of skippedFiles) {
        arr.push(`- \`${file}\``)
      }
      arr.push('')
    }

    arr.push('## Status')
    arr.push('')
    arr.push(
      `Socket npm/npx wrapper has been **${enable ? 'enabled' : 'disabled'}**.`,
    )
    arr.push('')

    logger.log(arr.join('\n'))
  }
  // Text mode output is already handled by add/remove functions.
}
