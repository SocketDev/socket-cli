import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleManifestSetup } from './handle-manifest-setup.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'setup',
  description:
    'Setup persistent options for generating manifest files with the `socket manifest` command',
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
      $ ${command} [CWD=.]

    Options
      ${getFlagListOutput(config.flags, 6)}

    This command will try to detect all supported ecosystems in given dir and
    start a configuration setup for every one it finds. These configuration
    details are then stored in a local file (which you may or may not commit
    to the repo) and which are loaded when you run \`socket manifest\` for that
    particular dir.

    You can also disable manifest generation for certain ecosystems.

    This generated configuration file will only be used locally by the CLI. You
    can commit it to the repo (useful for collaboration) or choose to add it to
    your .gitignore all the same. Only this CLI will use it.

    Examples

      $ ${command}
      $ ${command} ./proj
  `,
}

export const cmdManifestSetup = {
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
  const { defaultOnReadError = false } = cli.flags
  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join: If given path is abs then cwd should not affect it
  cwd = path.resolve(process.cwd(), cwd)

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleManifestSetup(cwd, Boolean(defaultOnReadError))
}
