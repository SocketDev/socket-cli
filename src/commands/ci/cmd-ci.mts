import { logger } from '@socketsecurity/registry/lib/logger'

import { handleCI } from './handle-ci.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'ci',
  description:
    'Create a new scan and report whether it passes your security policy',
  hidden: true,
  flags: {
    ...commonFlags,
    autoManifest: {
      type: 'boolean',
      default: false, // dev tools is not likely to be set up so this is safer
      description:
        'Auto generate manifest files where detected? See autoManifest flag in `socket scan create`',
    },
  },
  help: (command, _config) => `
    Usage
      $ ${command} [options]

    Options
      ${getFlagListOutput(config.flags)}

    This command is intended to use in CI runs to allow automated systems to
    accept or reject a current build. When the scan does not pass your security
    policy, the exit code will be non-zero.

    It will use the default org for the set API token.

    The --autoManifest flag does the same as the one from \`socket scan create\`
    but is not enabled by default since the CI is less likely to be set up with
    all the necessary dev tooling. Enable it if you want the scan to include
    locally generated manifests like for gradle and sbt.

    Examples
      $ ${command}
      $ ${command} --autoManifest
  `,
}

export const cmdCI = {
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

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleCI(Boolean(cli.flags['autoManifest']))
}
