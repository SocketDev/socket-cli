import process from 'node:process'

import { applyOptimization } from './apply-optimization'
import { commonFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const config: CliCommandConfig = {
  commandName: 'optimize',
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
  help: (command, config) => `
    Usage
      $ ${command}

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command}
      $ ${command} --pin
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
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const cwd = process.cwd()

  if (cli.flags['dryRun']) return console.log('[DryRun] Bailing now')

  await applyOptimization(
    cwd,
    Boolean(cli.flags['pin']),
    Boolean(cli.flags['prod'])
  )
}
