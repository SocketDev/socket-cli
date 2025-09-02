import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleScanConfig } from './handle-scan-config.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const config: CliCommandConfig = {
  commandName: 'setup',
  description:
    'Start interactive configurator to customize default flag values for `socket scan` in this dir',
  hidden: false,
  flags: {
    ...commonFlags,
    defaultOnReadError: {
      type: 'boolean',
      description:
        'If reading the socket.json fails, just use a default config? Warning: This might override the existing json file!',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.]

    Options
      ${getFlagListOutput(config.flags)}

    Interactive configurator to create a local json file in the target directory
    that helps to set flag defaults for \`socket scan create\`.

    This helps to configure the (Socket reported) repo and branch names, as well
    as which branch name is the "default branch" (main, master, etc). This way
    you don't have to specify these flags when creating a scan in this dir.

    This generated configuration file will only be used locally by the CLI. You
    can commit it to the repo (useful for collaboration) or choose to add it to
    your .gitignore all the same. Only this CLI will use it.

    Examples

      $ ${command}
      $ ${command} ./proj
  `,
}

export const cmdScanSetup = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  const { defaultOnReadError = false } = cli.flags

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  await handleScanConfig(cwd, Boolean(defaultOnReadError))
}
