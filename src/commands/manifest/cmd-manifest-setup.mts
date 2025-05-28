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
    'Start interactive configurator to customize default flag values for `socket manifest` in this dir',
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

    This command will try to detect all supported ecosystems in given CWD. Then
    it starts a configurator where you can setup default values for certain flags
    when creating manifest files in that dir. These configuration details are
    then stored in a local \`socket.json\` file (which you may or may not commit
    to the repo). Next time you run \`socket manifest ...\` it will load this
    json file and any flags which are not explicitly set in the command but which
    have been registered in the json file will get the default value set to that
    value you stored rather than the hardcoded defaults.

    This helps with for example when your build binary is in a particular path
    or when your build tool needs specific opts and you don't want to specify
    them when running the command every time.

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
