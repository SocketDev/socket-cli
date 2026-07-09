import { handleScanReport } from './handle-scan-report.mts'
import { FOLD_SETTING_NONE } from '../../constants/cli.mts'
import { outputDryRunFetch } from '../../util/dry-run/output.mts'
import { REPORT_LEVEL_WARN } from '../../constants/reporting.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { determineOrgSlug } from '../../util/socket/org-slug.mjs'
import { hasDefaultApiToken } from '../../util/socket/sdk.mjs'
import { checkCommandInput } from '../../util/validation/check-input.mts'

import type { FOLD_SETTING, REPORT_LEVEL } from './types.mts'
import type {
  CliCommandContext,
  CliSubcommand,
} from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'

// Flags interface for type safety.
export interface ScanReportFlags {
  fold: FOLD_SETTING
  json: boolean
  markdown: boolean
  org: string
  reportLevel: REPORT_LEVEL
}

export const CMD_NAME = 'report'

const description =
  'Check whether a scan result passes the organizational policies (security, license)'

const hidden = false

export const cmdScanReport: CliSubcommand = {
  description,
  hidden,
  run,
}

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: defineFlags({
      ...commonFlags,
      ...outputFlags,
      fold: {
        type: 'string',
        default: FOLD_SETTING_NONE,
        description: `Fold reported alerts to some degree (default '${FOLD_SETTING_NONE}')`,
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
        default: REPORT_LEVEL_WARN,
        description: `Which policy level alerts should be reported (default '${REPORT_LEVEL_WARN}')`,
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
    }),
    help: (command: string, helpConfig: { flags: MeowFlags }) => `
    Usage
      $ ${command} [options] <SCAN_ID> [OUTPUT_PATH]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(helpConfig.flags)}

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

  const {
    fold,
    json,
    markdown,
    org: orgFlag,
    reportLevel,
  } = cli.flags as unknown as ScanReportFlags

  const dryRun = !!cli.flags['dryRun']

  const interactive = !!cli.flags['interactive']

  const includeLicensePolicy = !!cli.flags['license']

  const short = !!cli.flags['short']

  const [scanId = '', filepath = ''] = cli.input

  const hasApiToken = hasDefaultApiToken()

  const { 0: orgSlug } = await determineOrgSlug(
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
    outputDryRunFetch('scan report', {
      organization: orgSlug,
      scanId,
      fold,
      reportLevel,
      includeLicense: includeLicensePolicy,
      short,
    })
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
