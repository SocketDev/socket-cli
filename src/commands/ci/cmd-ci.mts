import { logger } from '@socketsecurity/registry/lib/logger'

import { handleCi } from './handle-ci.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'ci',
  description: 'Shorthand for `socket scan create --report --no-interactive`',
  hidden: false,
  flags: {
    ...commonFlags,
    autoManifest: {
      type: 'boolean',
      // Dev tools in CI environments are not likely to be set up, so this is safer.
      default: false,
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
    accept or reject a current build. It will use the default org of the
    Socket API token. The exit code will be non-zero when the scan does not pass
    your security policy.

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

  await handleCi(Boolean(cli.flags['autoManifest']))
}
