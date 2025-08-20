import { logger } from '@socketsecurity/registry/lib/logger'

import { handleDiffScan } from './handle-diff-scan.mts'
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
import { hasDefaultToken } from '../../utils/sdk.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW, SOCKET_WEBSITE_URL } = constants

export const CMD_NAME = 'diff'

const SOCKET_SBOM_URL_PREFIX = `${SOCKET_WEBSITE_URL}/dashboard/org/SocketDev/sbom/`

const { length: SOCKET_SBOM_URL_PREFIX_LENGTH } = SOCKET_SBOM_URL_PREFIX

const description = 'See what changed between two Scans'

const hidden = false

export const cmdScanDiff = {
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
      depth: {
        type: 'number',
        default: 2,
        description:
          'Max depth of JSON to display before truncating, use zero for no limit (without --json/--file)',
      },
      file: {
        type: 'string',
        shortFlag: 'f',
        default: '',
        description:
          'Path to a local file where the output should be saved. Use `-` to force stdout.',
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
      $ ${command} [options] <SCAN_ID1> <SCAN_ID2>

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    This command displays the package changes between two scans. The full output
    can be pretty large depending on the size of your repo and time range. It is
    best stored to disk (with --json) to be further analyzed by other tools.

    Note: While it will work in any order, the first Scan ID is assumed to be the
          older ID, even if it is a newer Scan. This is only relevant for the
          added/removed list (similar to diffing two files with git).

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command} aaa0aa0a-aaaa-0000-0a0a-0000000a00a0 aaa1aa1a-aaaa-1111-1a1a-1111111a11a1
      $ ${command} aaa0aa0a-aaaa-0000-0a0a-0000000a00a0 aaa1aa1a-aaaa-1111-1a1a-1111111a11a1 --json
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { depth, file, json, markdown, org: orgFlag } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  const interactive = !!cli.flags['interactive']

  let [id1 = '', id2 = ''] = cli.input
  // Support dropping in full socket urls to an sbom.
  if (id1.startsWith(SOCKET_SBOM_URL_PREFIX)) {
    id1 = id1.slice(SOCKET_SBOM_URL_PREFIX_LENGTH)
  }
  if (id2.startsWith(SOCKET_SBOM_URL_PREFIX)) {
    id2 = id2.slice(SOCKET_SBOM_URL_PREFIX_LENGTH)
  }

  const hasApiToken = hasDefaultToken()

  const [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    interactive,
    dryRun,
  )

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      test: !!(id1 && id2),
      message:
        'Specify two Scan IDs.\nA Scan ID looks like `aaa0aa0a-aaaa-0000-0a0a-0000000a00a0`.',
      fail:
        !id1 && !id2
          ? 'missing both Scan IDs'
          : !id2
            ? 'missing second Scan ID'
            : 'missing first Scan ID', // Not sure how this can happen but ok.
    },
    {
      test: !!orgSlug,
      nook: true,
      message: 'Org name by default setting, --org, or auto-discovered',
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
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleDiffScan({
    id1: String(id1 || ''),
    id2: String(id2 || ''),
    depth: Number(depth),
    orgSlug,
    outputKind,
    file: String(file || ''),
  })
}
