import { stripIndents } from 'common-tags'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleOrgScanMetadata } from './handle-scan-metadata'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { getConfigValue } from '../../utils/config'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type {
  CliCommandConfig,
  CliSubcommand
} from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'metadata',
  description: "Get a scan's metadata",
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <org slug> <scan id>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} FakeOrg 000aaaa1-0000-0a0a-00a0-00a0000000a0
  `
}

export const cmdScanMetadata: CliSubcommand = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const defaultOrgSlug = getConfigValue('defaultOrg')
  const orgSlug = defaultOrgSlug || cli.input[0] || ''
  const scanId = (defaultOrgSlug ? cli.input[0] : cli.input[1]) || ''

  if (!orgSlug || !scanId) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.fail(
      stripIndents`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:

      ${defaultOrgSlug ? '' : `- Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}`}

      - Scan ID to inspect as second argument ${!scanId ? colors.red('(missing!)') : colors.green('(ok)')}`
    )
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await handleOrgScanMetadata(
    orgSlug,
    scanId,
    cli.flags['json'] ? 'json' : cli.flags['markdown'] ? 'markdown' : 'print'
  )
}
