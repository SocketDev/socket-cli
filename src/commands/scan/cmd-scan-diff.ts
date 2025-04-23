import { logger } from '@socketsecurity/registry/lib/logger'

import { handleDiffScan } from './handle-diff-scan'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { isTestingV1 } from '../../utils/config'
import { determineOrgSlug } from '../../utils/determine-org-slug'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const SOCKET_SBOM_URL_PREFIX =
  'https://socket.dev/dashboard/org/SocketDev/sbom/'

const config: CliCommandConfig = {
  commandName: 'diff',
  description: 'See what changed between two Scans',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    depth: {
      type: 'number',
      default: 2,
      description:
        'Max depth of JSON to display before truncating, use zero for no limit (without --json/--file)'
    },
    file: {
      type: 'string',
      shortFlag: 'f',
      default: '',
      description:
        'Path to a local file where the output should be saved. Use `-` to force stdout.'
    },
    interactive: {
      type: 'boolean',
      default: true,
      description:
        'Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.'
    },
    org: {
      type: 'string',
      description:
        'Force override the organization slug, overrides the default org from config'
    }
  },
  help: (command, config) => `
    Usage
      $ ${command}${isTestingV1() ? '' : ' <org slug>'} <ID1> <ID2>

    API Token Requirements
      - Quota: 1 unit
      - Permissions: full-scans:list

    This command displays the package changes between two scans. The full output
    can be pretty large depending on the size of your repo and time range. It is
    best stored to disk (with --json) to be further analyzed by other tools.

    Note: First Scan ID is assumed to be the older ID. This is only relevant for
          the added/removed list (similar to diffing two files with git).

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command}${isTestingV1() ? '' : ' FakeOrg'} aaa0aa0a-aaaa-0000-0a0a-0000000a00a0 aaa1aa1a-aaaa-1111-1a1a-1111111a11a1
      $ ${command}${isTestingV1() ? '' : ' FakeOrg'} aaa0aa0a-aaaa-0000-0a0a-0000000a00a0 aaa1aa1a-aaaa-1111-1a1a-1111111a11a1 --json
  `
}

export const cmdScanDiff = {
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
    depth,
    dryRun,
    file,
    interactive,
    json,
    markdown,
    org: orgFlag
  } = cli.flags

  const [orgSlug, defaultOrgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    cli.input[0] || '',
    !!interactive,
    !!dryRun
  )

  let id1 = cli.input[defaultOrgSlug ? 0 : 1] || ''
  let id2 = cli.input[defaultOrgSlug ? 1 : 2] || ''
  if (id1.startsWith(SOCKET_SBOM_URL_PREFIX)) {
    id1 = id1.slice(SOCKET_SBOM_URL_PREFIX.length)
  }
  if (id2.startsWith(SOCKET_SBOM_URL_PREFIX)) {
    id2 = id2.slice(SOCKET_SBOM_URL_PREFIX.length)
  }

  const apiToken = getDefaultToken()

  const wasBadInput = handleBadInput(
    {
      test: !!(id1 && id2),
      message:
        'Specify two Scan IDs.\nA Scan ID looks like `aaa0aa0a-aaaa-0000-0a0a-0000000a00a0`.',
      pass: 'ok',
      fail:
        !id1 && !id2
          ? 'missing both Scan IDs'
          : !id2
            ? 'missing second Scan ID'
            : 'missing first Scan ID' // Not sure how this can happen but ok.
    },
    {
      test: !!orgSlug,
      nook: true,
      message: isTestingV1()
        ? 'Org name by default setting, --org, or auto-discovered'
        : 'Org name must be the first argument',
      pass: 'ok',
      fail: 'missing'
    },
    {
      nook: true,
      test: !json || !markdown,
      message:
        'The `--json` and `--markdown` flags can not be used at the same time',
      pass: 'ok',
      fail: 'bad'
    },
    {
      nook: true,
      test: !!apiToken,
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

  await handleDiffScan({
    id1: String(id1 || ''),
    id2: String(id2 || ''),
    depth: Number(depth),
    orgSlug,
    outputKind: json ? 'json' : markdown ? 'markdown' : 'text',
    file: String(file || '')
  })
}
