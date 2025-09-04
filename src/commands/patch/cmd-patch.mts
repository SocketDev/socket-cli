import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handlePatch } from './handle-patch.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

export const CMD_NAME = 'patch'

const description = 'Apply CVE patches to dependencies'

const hidden = true

export const cmdPatch = {
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
      ...outputFlags,
      package: {
        type: 'string',
        default: [],
        description:
          'Specify packages to patch, as either a comma separated value or as multiple flags',
        isMultiple: true,
        shortFlag: 'p',
      },
    },
    help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} --package lodash
      $ ${command} ./proj/tree --package lodash,react
    `,
  }

  const cli = meowOrExit({
    allowUnknownFlags: false,
    argv,
    config,
    importMeta,
    parentName,
  })

  const dryRun = !!cli.flags['dryRun']
  const outputKind = getOutputKind(cli.flags['json'], cli.flags['markdown'])

  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: !cli.flags['json'] || !cli.flags['markdown'],
    message: 'The json and markdown flags cannot be both set, pick one',
    fail: 'omit one',
  })
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_NOT_SAVING)
    return
  }

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  const dotSocketDirPath = path.join(cwd, '.socket')
  if (!existsSync(dotSocketDirPath)) {
    logger.error('Error: No .socket directory found in current directory')
    return
  }

  const manifestPath = path.join(dotSocketDirPath, 'manifest.json')
  if (!existsSync(manifestPath)) {
    logger.error('Error: No manifest.json found in .socket directory')
  }

  const { spinner } = constants

  const packages = cmdFlagValueToArray(cli.flags['package'])

  await handlePatch({
    cwd,
    outputKind,
    packages,
    spinner,
  })
}
