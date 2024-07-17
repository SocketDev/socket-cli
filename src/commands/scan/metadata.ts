import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api-helpers'
import { printFlagList } from '../../utils/formatting'
import { getDefaultKey, setupSdk } from '../../utils/sdk'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'
import type { Ora } from 'ora'

export const metadata: CliSubcommand = {
  description: "Get a scan's metadata",
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} metadata`
    const input = setupCommand(name, metadata.description, argv, importMeta)
    if (input) {
      const spinnerText = "Getting scan's metadata... \n"
      const spinner = ora(spinnerText).start()
      await getOrgScanMetadata(input.orgSlug, input.scanID, spinner)
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

  const { json: outputJson, markdown: outputMarkdown } = cli.flags

  if (cli.input.length < 2) {
    console.error(
      `${chalk.bgRed('Input error')}: Please specify an organization slug and a scan ID.\n`
    )
    cli.showHelp()
    return
  }

  const { 0: orgSlug = '', 1: scanID = '' } = cli.input

  return <CommandContext>{
    outputJson,
    outputMarkdown,
    orgSlug,
    scanID
  }
}

async function getOrgScanMetadata(
  orgSlug: string,
  scanId: string,
  spinner: Ora
): Promise<void> {
  const socketSdk = await setupSdk(getDefaultKey())
  const result = await handleApiCall(
    socketSdk.getOrgFullScanMetadata(orgSlug, scanId),
    'Listing scans'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgFullScanMetadata', result, spinner)
    return
  }
  spinner.stop()

  console.log('\nScan metadata:\n')
  console.log(result.data)
}
