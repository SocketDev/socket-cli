import { logger } from '@socketsecurity/registry/lib/logger'

import { handleScanReport } from './handle-scan-report.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output-formatting.mts'
import { hasDefaultApiToken } from '../../utils/sdk.mts'

import type { FOLD_SETTING, REPORT_LEVEL } from './types.mts'
import type {
  CliCommandConfig,
  CliSubcommand,
} from '../../utils/meow-with-subcommands.mts'

export const CMD_NAME = 'report'

const description =
  'Check whether a scan result passes the organizational policies (security, license)'

const hidden = false

export const cmdScanReport: CliSubcommand = {
  description,
  hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: {
      ...commonFlags,
      ...outputFlags,
      fold: {
        type: 'string',
        default: constants.FOLD_SETTING_NONE,
        description: `Fold reported alerts to some degree (default '${constants.FOLD_SETTING_NONE}')`,
      },
      interactive: {
        type: 'boolean',
        default: true,
        description:
          'Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.',
      },
      org: {
        type: 'string',
        description:
          'Force override the organization slug, overrides the default org from config',
      },
      reportLevel: {
        type: 'string',
        default: constants.REPORT_LEVEL_WARN,
        description: `Which policy level alerts should be reported (default '${constants.REPORT_LEVEL_WARN}')`,
      },
      short: {
        type: 'boolean',
        default: false,
        description: 'Report only the healthy status',
      },
      license: {
        type: 'boolean',
        default: false,
        description: 'Also report the license policy status. Default: false',
      },
    },
    help: (command, config) => `
    Usage
      $ ${command} [options] <SCAN_ID> [OUTPUT_PATH]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    When no output path is given the contents is sent to stdout.

    By default the result is a nested object that looks like this:
      \`{
        [ecosystem]: {
          [pkgName]: {
            [version]: {
              [file]: {
                [line:col]: alert
      }}}}\`
    So one alert for each occurrence in every file, version, etc, a huge response.

    You can --fold these up to given level: 'pkg', 'version', 'file', and 'none'.
    For example: \`socket scan report --fold=version\` will dedupe alerts to only
    show one alert of a particular kind, no matter how often it was found in a
    file or in how many files it was found. At most one per version that has it.

    By default only the warn and error policy level alerts are reported. You can
    override this and request more ('defer' < 'ignore' < 'monitor' < 'warn' < 'error')

    Short responses look like this:
      --json:     \`{healthy:bool}\`
      --markdown: \`healthy = bool\`
      neither:    \`OK/ERR\`

    Examples
      $ ${command} 000aaaa1-0000-0a0a-00a0-00a0000000a0 --json --fold=version
      $ ${command} 000aaaa1-0000-0a0a-00a0-00a0000000a0 --license --markdown --short
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { json, markdown, org: orgFlag } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  const fold = cli.flags['fold'] as FOLD_SETTING

  const interactive = !!cli.flags['interactive']

  const includeLicensePolicy = !!cli.flags['license']

  const reportLevel = cli.flags['reportLevel'] as REPORT_LEVEL

  const short = !!cli.flags['short']

  const [scanId = '', filepath = ''] = cli.input

  const hasApiToken = hasDefaultApiToken()

  const [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    interactive,
    dryRun,
  )

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !!orgSlug,
      message: 'Org name by default setting, --org, or auto-discovered',
      fail: 'dot is an invalid org, most likely you forgot the org name here?',
    },
    {
      test: !!scanId,
      message: 'Scan ID to report on',
      fail: 'missing',
    },
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      fail: 'omit one',
    },
    {
      nook: true,
      test: hasApiToken,
      message: 'This command requires a Socket API token for access',
      fail: 'try `socket login`',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  await handleScanReport({
    orgSlug,
    scanId,
    includeLicensePolicy,
    outputKind,
    filepath,
    fold,
    short,
    reportLevel,
  })
}
