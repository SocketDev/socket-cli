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

export const del: CliSubcommand = {
  description: 'Delete a scan',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} del`
    const input = setupCommand(name, del.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Deleting scan...'
      const spinner = ora(spinnerText).start()
      await deleteOrgFullScan(input.orgSlug, input.fullScanId, spinner)
    }
  }
}

// Internal functions

type CommandContext = {
  outputJson: boolean
  outputMarkdown: boolean
  orgSlug: string
  fullScanId: string
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
      $ ${name} <org slug> <scan ID>

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

  const { 0: orgSlug = '', 1: fullScanId = '' } = cli.input

  return <CommandContext>{
    outputJson,
    outputMarkdown,
    orgSlug,
    fullScanId
  }
}

async function deleteOrgFullScan(
  orgSlug: string,
  fullScanId: string,
  spinner: Ora
): Promise<void> {
  const socketSdk = await setupSdk(getDefaultKey())
  const result = await handleApiCall(
    socketSdk.deleteOrgFullScan(orgSlug, fullScanId),
    'Deleting scan'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('deleteOrgFullScan', result, spinner)
    return
  }

  spinner.stop()

  console.log('\n ✅ Scan deleted successfully\n')
}
