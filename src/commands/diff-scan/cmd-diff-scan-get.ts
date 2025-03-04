import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { getDiffScan } from './get-diff-scan'
import constants from '../../constants'
import { commonFlags } from '../../flags'
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
      description: 'The full scan ID of the head scan'
    },
    before: {
      type: 'string',
      shortFlag: 'b',
      default: '',
      description: 'The full scan ID of the base scan'
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

  const before = String(cli.flags['before'] || '')
  const after = String(cli.flags['after'] || '')
  const [orgSlug = ''] = cli.input

  if (!before || !after || cli.input.length < 1) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.fail(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - Specify a before and after full scan ID ${!before && !after ? colors.red('(missing before and after!)') : !before ? colors.red('(missing before!)') : !after ? colors.red('(missing after!)') : colors.green('(ok)')}\n
          - To get full scans IDs, you can run the command "socket scan list <your org slug>".
            The args are expecting a full \`aaa0aa0a-aaaa-0000-0a0a-0000000a00a0\` ID.\n
      - Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}\n`)
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await getDiffScan({
    outputJson: Boolean(cli.flags['json']),
    before,
    after,
    depth: Number(cli.flags['depth']),
    orgSlug,
    file: String(cli.flags['file'] || '')
  })
}
