import process from 'node:process'

import meowOrExit from 'meow'

import { applyOptimization } from './apply-optimization.ts'
import { commonFlags } from '../../flags'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.ts'

const config: CliCommandConfig = {
  commandName: 'create',
  description: 'Optimize dependencies with @socketregistry overrides',
  hidden: false,
  flags: {
    ...commonFlags,
    pin: {
      type: 'boolean',
      default: false,
      description: 'Pin overrides to their latest version'
    },
    prod: {
      type: 'boolean',
      default: false,
      description: 'Only add overrides for production dependencies'
    }
  },
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName}

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${parentName} ${config.commandName}
  `
}

export const cmdOptimize = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit(config.help(parentName, config), {
    argv,
    description: config.description,
    importMeta,
    flags: config.flags
  })

  const cwd = process.cwd()

  await applyOptimization(
    cwd,
    Boolean(cli.flags['pin']),
    Boolean(cli.flags['prod'])
  )
}
