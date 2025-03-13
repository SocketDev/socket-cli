import { stripIndents } from 'common-tags'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { reportFullScan } from './report-full-scan'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type {
  CliCommandConfig,
  CliSubcommand
} from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'report',
  description:
    'Check whether a scan result passes the organizational policies (security, license)',
  hidden: true, // [beta]
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
    license: {
      type: 'boolean',
      default: true,
      description: 'Report the license policy status. Default: true'
    },
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
    it needs \`security-policy:read\` to report on the security policy and it needs
    the \`license-policy:read\` scope to report on the license policy.

    (Use \`--no-security\` or \`--no-license\` to omit one)

    By default the result is a nested object that looks like this:
      \`{[ecosystem]: {[pkgName]: {[version]: {[file]: {[type:loc]: policy}}}}\`
    You can fold this up to given level: 'pkg', 'version', 'file', and 'none'.

    By default only the warn and error policy level alerts are reported. You can
    override this and request more ('defer' < 'ignore' < 'monitor' < 'warn' < 'error')

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
    license,
    markdown,
    reportLevel = 'warn',
    security
  } = cli.flags

  const [orgSlug = '', fullScanId = '', file = '-'] = cli.input

  if (
    !orgSlug ||
    !fullScanId ||
    (json && markdown) ||
    (!license && !security)
  ) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.fail(
      stripIndents`
      ${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:

      - Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}

      - Full Scan ID to fetch as second argument ${!fullScanId ? colors.red('(missing!)') : colors.green('(ok)')}

      - Not both the --json and --markdown flags ${json && markdown ? colors.red('(pick one!)') : colors.green('(ok)')}

      - At least one policy to report ${!license && !security ? colors.red('(do not omit both!)') : colors.green('(ok)')}
    `
    )
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await reportFullScan({
    orgSlug,
    fullScanId,
    includeLicensePolicy: !!license,
    includeSecurityPolicy: !!security,
    outputKind: json ? 'json' : markdown ? 'markdown' : 'text',
    filePath: file,
    fold: fold as 'none' | 'file' | 'pkg' | 'version',
    reportLevel: reportLevel as
      | 'warn'
      | 'error'
      | 'defer'
      | 'ignore'
      | 'monitor'
  })
}
