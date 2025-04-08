import { logger } from '@socketsecurity/registry/lib/logger'

import { handleSecurityPolicy } from './handle-security-policy'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { getConfigValue } from '../../utils/config'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

// TODO: secret toplevel alias `socket security policy`?
const config: CliCommandConfig = {
  commandName: 'security',
  description: 'Retrieve the security policy of an organization',
  hidden: true,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (command, _config) => `
    Usage
      $ ${command} <org slug>

    API Token Requirements
      - Quota: 1 unit
      - Permissions: security-policy:read

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

  const defaultOrgSlug = getConfigValue('defaultOrg')
  const orgSlug = defaultOrgSlug || cli.input[0] || ''
  const apiToken = getDefaultToken()

  const wasBadInput = handleBadInput(
    {
      nook: true,
      test: !!orgSlug,
      message: 'Org name as the first argument',
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

  await handleSecurityPolicy(
    orgSlug,
    json ? 'json' : markdown ? 'markdown' : 'text'
  )
}
