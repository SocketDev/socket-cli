import meow from 'meow'
import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { commonFlags, outputFlags } from '../../flags'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api-helpers'
import { AuthError } from '../../utils/errors'
import { printFlagList } from '../../utils/formatting'
import { getDefaultKey, setupSdk } from '../../utils/sdk'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

export const metadata: CliSubcommand = {
  description: "Get a scan's metadata",
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} metadata`
    const input = setupCommand(name, metadata.description, argv, importMeta)
    if (input) {
      const apiKey = getDefaultKey()
      if (!apiKey) {
        throw new AuthError(
          'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
        )
      }
      const spinnerText = "Getting scan's metadata... \n"
      const spinner = new Spinner({ text: spinnerText }).start()
      await getOrgScanMetadata(input.orgSlug, input.scanID, spinner, apiKey)
    }
  }
}

// Internal functions

type CommandContext = {
  outputJson: boolean
  outputMarkdown: boolean
  orgSlug: string
  scanID: string
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): CommandContext | undefined {
  const flags: { [key: string]: any } = {
    ...commonFlags,
    ...outputFlags
  }
  const cli = meow(
    `
    Usage
      $ ${name} <org slug> <scan id>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} FakeOrg 000aaaa1-0000-0a0a-00a0-00a0000000a0
  `,
    {
      argv,
      description,
      importMeta,
      flags
    }
  )
  let showHelp = cli.flags['help']
  if (cli.input.length < 2) {
    showHelp = true
    console.error(
      `${colors.bgRed(colors.white('Input error'))}: Please specify an organization slug and a scan ID.`
    )
  }
  if (showHelp) {
    cli.showHelp()
    return
  }
  const { 0: orgSlug = '', 1: scanID = '' } = cli.input
  return <CommandContext>{
    outputJson: cli.flags['json'],
    outputMarkdown: cli.flags['markdown'],
    orgSlug,
    scanID
  }
}

async function getOrgScanMetadata(
  orgSlug: string,
  scanId: string,
  spinner: Spinner,
  apiKey: string
): Promise<void> {
  const socketSdk = await setupSdk(apiKey)
  const result = await handleApiCall(
    socketSdk.getOrgFullScanMetadata(orgSlug, scanId),
    'Listing scans'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgFullScanMetadata', result, spinner)
    return
  }

  spinner.stop('Scan metadata:')
  console.log(result.data)
}
