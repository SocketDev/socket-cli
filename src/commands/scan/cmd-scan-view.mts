import { logger } from '@socketsecurity/registry/lib/logger'

import { handleScanView } from './handle-scan-view.mts'
import { streamScan } from './stream-scan.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { hasDefaultToken } from '../../utils/sdk.mts'

import type {
  CliCommandConfig,
  CliSubcommand,
} from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'view',
  description: 'View the raw results of a scan',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    stream: {
      type: 'boolean',
      default: false,
      description:
        'Only valid with --json. Streams the response as "ndjson" (chunks of valid json blobs).',
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
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] <SCAN_ID> [OUTPUT_FILE]

    API Token Requirements
      - Quota: 1 unit
      - Permissions: full-scans:list

    When no output path is given the contents is sent to stdout.

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command} 000aaaa1-0000-0a0a-00a0-00a0000000a0
      $ ${command} 000aaaa1-0000-0a0a-00a0-00a0000000a0 ./stream.txt
  `,
}

export const cmdScanView: CliSubcommand = {
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

  const { interactive, json, markdown, org: orgFlag, stream } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  const [scanId = '', file = ''] = cli.input

  const hasApiToken = hasDefaultToken()

  const [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    !!interactive,
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
      message: 'Scan ID to view',
      fail: 'missing',
    },
    {
      nook: true,
      test: !json || !markdown,
      message:
        'The `--json` and `--markdown` flags can not be used at the same time',
      fail: 'bad',
    },
    {
      nook: true,
      test: hasApiToken,
      message: 'This command requires a Socket API token for access',
      fail: 'try `socket login`',
    },
    {
      nook: true,
      test: !stream || !!json,
      message: 'You can only use --stream when using --json',
      fail: 'Either remove --stream or add --json',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  if (json && stream) {
    await streamScan(orgSlug, scanId, { file })
  } else {
    await handleScanView(orgSlug, scanId, file, outputKind)
  }
}
