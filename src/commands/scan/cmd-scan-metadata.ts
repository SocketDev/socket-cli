import { logger } from '@socketsecurity/registry/lib/logger'

import { handleOrgScanMetadata } from './handle-scan-metadata'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { getConfigValue } from '../../utils/config'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

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

    API Token Requirements
      - Quota: 1 unit
      - Permissions: full-scans:list

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

  const { json, markdown } = cli.flags
  const defaultOrgSlug = getConfigValue('defaultOrg')
  const orgSlug = defaultOrgSlug || cli.input[0] || ''
  const scanId = (defaultOrgSlug ? cli.input[0] : cli.input[1]) || ''
  const apiToken = getDefaultToken()

  const wasBadInput = handleBadInput(
    {
      nook: !!defaultOrgSlug,
      test: orgSlug && orgSlug !== '.',
      message: 'Org name as the first argument',
      pass: 'ok',
      fail:
        orgSlug === '.'
          ? 'dot is an invalid org, most likely you forgot the org name here?'
          : 'missing'
    },
    {
      test: scanId,
      message: 'Scan ID to inspect as argument',
      pass: 'ok',
      fail: 'missing'
    },
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      pass: 'ok',
      fail: 'omit one'
    },
    {
      nook: true,
      test: apiToken,
      message:
        'You need to be logged in to use this command. See `socket login`.',
      pass: 'ok',
      fail: 'missing API token'
    }
  )
  if (wasBadInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await handleOrgScanMetadata(
    orgSlug,
    scanId,
    json ? 'json' : markdown ? 'markdown' : 'text'
  )
}
