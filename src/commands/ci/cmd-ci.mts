import { handleCi } from './handle-ci.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import {
  setCiExitCode,
  setCiExitCodePolicy,
} from '../../utils/ci-exit-code.mts'
import { logger } from '../../utils/logger.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

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
    disableBlocking: {
      type: 'boolean',
      default: false,
      description:
        'Return success for findings and infrastructure failures, but keep usage errors non-zero.',
    },
    exitCodeOnApiError: {
      type: 'number',
      default: 3,
      description:
        'Exit code for Socket API errors (default: 3). Ignored with --disable-blocking.',
    },
  },
  help: (command, _config) => `
    Usage
      $ ${command} [options]

    Options
      ${getFlagListOutput(config.flags)}

    This command is intended to use in CI runs to allow automated systems to
    accept or reject a current build. It will use the default org of the
    Socket API token. Exit codes are 0 for success, 1 for blocking findings, 2
    for usage errors, 3 for infrastructure errors, and 130 for interruption.
    --disable-blocking returns 0 for findings and runtime failures, but not
    usage errors. --exit-code-on-api-error changes the API failure code.

    The --auto-manifest flag does the same as the one from \`socket scan create\`
    but is not enabled by default since the CI is less likely to be set up with
    all the necessary dev tooling. Enable it if you want the scan to include
    locally generated manifests like for gradle and sbt.

    Examples
      $ ${command}
      $ ${command} --auto-manifest
      $ ${command} --disable-blocking
      $ ${command} --exit-code-on-api-error 5
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
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  const exitCodeOnApiError = Number(cli.flags['exitCodeOnApiError'])
  setCiExitCodePolicy({
    disableBlocking: Boolean(cli.flags['disableBlocking']),
    exitCodeOnApiError,
  })

  if (
    !Number.isInteger(exitCodeOnApiError) ||
    exitCodeOnApiError < 0 ||
    exitCodeOnApiError > 255
  ) {
    logger.fail('--exit-code-on-api-error must be an integer from 0 to 255.')
    setCiExitCode('usage')
    return
  }

  await handleCi(Boolean(cli.flags['autoManifest']))
}
