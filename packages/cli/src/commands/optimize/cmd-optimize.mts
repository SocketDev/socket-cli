import path from 'node:path'

import { handleOptimize } from './handle-optimize.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { outputDryRunPreview } from '../../utils/dry-run/output.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'
import type { DryRunAction } from '../../utils/dry-run/output.mts'

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

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  const outputKind = getOutputKind(json, markdown)

  if (dryRun) {
    const actions: DryRunAction[] = [
      {
        type: 'fetch',
        description: 'Analyze dependencies for @socketregistry overrides',
        target: cwd,
      },
      {
        type: 'modify',
        description: 'Add or update overrides section in package.json',
        target: 'package.json',
        details: {
          pin: pin ? 'Yes - pin to specific versions' : 'No - use version ranges',
          prod: prod ? 'Yes - production dependencies only' : 'No - all dependencies',
        },
      },
      {
        type: 'execute',
        description: 'Run package manager to install optimized dependencies',
      },
    ]

    outputDryRunPreview({
      summary: 'Optimize dependencies with @socketregistry overrides',
      actions,
      wouldSucceed: true,
    })
    return
  }

  await handleOptimize({
    cwd,
    pin: Boolean(pin),
    outputKind,
    prod: Boolean(prod),
  })
}
