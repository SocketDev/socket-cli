import { stripIndents } from 'common-tags'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { getSecurityPolicy } from './get-security-policy'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

// TODO: secret toplevel alias `socket security policy`?
const config: CliCommandConfig = {
  commandName: 'security',
  description: 'Retrieve the security policy of an organization.',
  hidden: true,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (command, _config) => `
    Usage
      $ ${command} <org slug>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Your API token will need the \`security-policy:read\` permission otherwise
    the request will fail with an authentication error.

    Examples
      $ ${command} mycorp
      $ ${command} mycorp --json
  `
}

export const cmdOrganizationPolicyPolicy = {
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

  const json = Boolean(cli.flags['json'])
  const markdown = Boolean(cli.flags['markdown'])

  const [orgSlug = ''] = cli.input

  if (!orgSlug || (json && markdown)) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.fail(stripIndents`
${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:

  - Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}
  - The json and markdown flags cannot be both set ${json && markdown ? colors.red('(pick one!)') : colors.green('(ok)')}
    `)
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await getSecurityPolicy(
    orgSlug,
    json ? 'json' : markdown ? 'markdown' : 'text'
  )
}
