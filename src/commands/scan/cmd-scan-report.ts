import { logger } from '@socketsecurity/registry/lib/logger'

import { handleScanReport } from './handle-scan-report'
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
  commandName: 'report',
  description:
    'Check whether a scan result passes the organizational policies (security, license)',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    fold: {
      type: 'string',
      default: 'none',
      description: 'Fold reported alerts to some degree'
    },
    reportLevel: {
      type: 'string',
      default: 'warn',
      description: 'Which policy level alerts should be reported'
    },
    short: {
      type: 'boolean',
      default: false,
      description: 'Report only the healthy status'
    },
    // license: {
    //   type: 'boolean',
    //   default: true,
    //   description: 'Report the license policy status. Default: true'
    // },
    security: {
      type: 'boolean',
      default: true,
      description: 'Report the security policy status. Default: true'
    }
  },
  help: (command, config) => `
    Usage
      $ ${command} <org slug> <scan ID> [path to output file]

    Options
      ${getFlagListOutput(config.flags, 6)}

    This consumes 1 quota unit plus 1 for each of the requested policy types.

    Note: By default it reports both so by default it consumes 3 quota units.

    Your API token will need the \`full-scans:list\` scope regardless. Additionally
    it needs \`security-policy:read\` to report on the security policy.

    By default the result is a nested object that looks like this:
      \`{[ecosystem]: {[pkgName]: {[version]: {[file]: {[type:loc]: policy}}}}\`
    You can fold this up to given level: 'pkg', 'version', 'file', and 'none'.

    By default only the warn and error policy level alerts are reported. You can
    override this and request more ('defer' < 'ignore' < 'monitor' < 'warn' < 'error')

    Short responses: JSON: \`{healthy:bool}\`, markdown: \`healthy = bool\`, text: \`OK/ERR\`

    Examples
      $ ${command} FakeOrg 000aaaa1-0000-0a0a-00a0-00a0000000a0 --json --fold=version
  `
}

export const cmdScanReport: CliSubcommand = {
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

  const {
    fold = 'none',
    json,
    // license,
    markdown,
    reportLevel = 'warn',
    security
  } = cli.flags

  const defaultOrgSlug = getConfigValue('defaultOrg')
  const orgSlug = defaultOrgSlug || cli.input[0] || ''
  const scanId = (defaultOrgSlug ? cli.input[0] : cli.input[1]) || ''
  const file = (defaultOrgSlug ? cli.input[1] : cli.input[2]) || '-'
  const apiToken = getDefaultToken()

  const wasBadInput = handleBadInput(
    {
      nook: true,
      test: orgSlug,
      message: 'Org name as the first argument',
      pass: 'ok',
      fail: 'missing'
    },
    {
      test: scanId,
      message: 'Scan ID to fetch',
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

  await handleScanReport({
    orgSlug,
    scanId: scanId,
    includeLicensePolicy: false, // !!license,
    includeSecurityPolicy: typeof security === 'boolean' ? security : true,
    outputKind: json ? 'json' : markdown ? 'markdown' : 'text',
    filePath: file,
    fold: fold as 'none' | 'file' | 'pkg' | 'version',
    short: !!cli.flags['short'],
    reportLevel: reportLevel as
      | 'warn'
      | 'error'
      | 'defer'
      | 'ignore'
      | 'monitor'
  })
}
