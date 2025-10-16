import { logger } from '@socketsecurity/registry/lib/logger'

import { handleCi } from './handle-ci.mts'
import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { getFlagListOutput } from '../../utils/output/formatting.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const config: CliCommandConfig = {
  commandName: 'ci',
  description:
    'Alias for `socket scan create --report` (creates report and exits with error if unhealthy)',
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

    The --auto-manifest flag does the same as the one from \`socket scan create\`
    but is not enabled by default since the CI is less likely to be set up with
    all the necessary dev tooling. Enable it if you want the scan to include
    locally generated manifests like for gradle and sbt.

    Examples
      $ ${command}
      $ ${command} --auto-manifest
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
  { parentName }: CliCommandContext,
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    parentName,
    importMeta,
  })

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleCi(Boolean(cli.flags['autoManifest']))
}
