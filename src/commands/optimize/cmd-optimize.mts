/** @fileoverview Optimize command implementation for Socket CLI. Automatically applies @socketregistry overrides to package.json for security-enhanced package alternatives. Supports pinning versions and production-only dependencies. */

import path from 'node:path'

import { handleOptimize } from './handle-optimize.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output-formatting.mts'
import { logIf } from '../../utils/output.mts'

import type { OutputKind } from '../../types.mts'
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

export const CMD_NAME = 'optimize'

const description = 'Optimize dependencies with @socketregistry overrides'

const hidden = false

export const cmdOptimize = {
  description,
  hidden,
  run,
}

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
      pin: {
        type: 'boolean',
        default: false,
        description: 'Pin overrides to latest version',
      },
      prod: {
        type: 'boolean',
        default: false,
        description: 'Add overrides for production dependencies only',
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
      $ ${command} ./path/to/project --pin
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const dryRun = !!cli.flags['dryRun']
  const { json, markdown, pin, prod } = cli.flags
  const outputKind: OutputKind = json ? 'json' : markdown ? 'markdown' : 'text'

  if (dryRun) {
    logIf(outputKind, constants.DRY_RUN_BAILING_NOW)
    return
  }

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  await handleOptimize({
    cwd,
    pin: Boolean(pin),
    outputKind,
    prod: Boolean(prod),
  })
}
