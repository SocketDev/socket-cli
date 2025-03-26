import { logger } from '@socketsecurity/registry/lib/logger'

import { handleDiffScan } from './handle-diff-scan'
import constants from '../../constants'
import { commonFlags } from '../../flags'
import { getConfigValue } from '../../utils/config'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'get',
  description: 'Get a diff scan for an organization',
  hidden: false,
  flags: {
    ...commonFlags,
    after: {
      type: 'string',
      shortFlag: 'a',
      default: '',
      description: 'The scan ID of the head scan'
    },
    before: {
      type: 'string',
      shortFlag: 'b',
      default: '',
      description: 'The scan ID of the base scan'
    },
    depth: {
      type: 'number',
      default: 2,
      description:
        'Max depth of JSON to display before truncating, use zero for no limit (without --json/--file)'
    },
    json: {
      type: 'boolean',
      shortFlag: 'j',
      default: false,
      description:
        'Output result as json. This can be big. Use --file to store it to disk without truncation.'
    },
    file: {
      type: 'string',
      shortFlag: 'f',
      default: '',
      description:
        'Path to a local file where the output should be saved. Use `-` to force stdout.'
    }
  },
  help: (command, config) => `
    Usage
      $ ${command} <org slug> --before=<before> --after=<after>

    This command displays the package changes between two scans. The full output
    can be pretty large depending on the size of your repo and time range. It is
    best stored to disk to be further analyzed by other tools.

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} FakeCorp --before=aaa0aa0a-aaaa-0000-0a0a-0000000a00a0 --after=aaa1aa1a-aaaa-1111-1a1a-1111111a11a1
  `
}

export const cmdDiffScanGet = {
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

  const { after, before, depth, file, json, markdown } = cli.flags

  const defaultOrgSlug = getConfigValue('defaultOrg')
  const orgSlug = defaultOrgSlug || cli.input[0] || ''

  const wasBadInput = handleBadInput(
    {
      test: !!(before && after),
      message:
        'Specify a before and after scan ID\nThe args are expecting a full `aaa0aa0a-aaaa-0000-0a0a-0000000a00a0` scan ID.',
      pass: 'ok',
      fail:
        !before && !after
          ? 'missing before and after'
          : !before
            ? 'missing before'
            : 'missing after'
    },
    {
      test: !!orgSlug,
      hide: !!defaultOrgSlug,
      message: 'Org name as the first argument',
      pass: 'ok',
      fail: 'missing'
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
    before: String(before || ''),
    after: String(after || ''),
    depth: Number(depth),
    orgSlug,
    outputKind: json ? 'json' : markdown ? 'markdown' : 'text',
    file: String(file || '')
  })
}
