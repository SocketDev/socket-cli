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

export const stream: CliSubcommand = {
  description: 'Stream the output of a scan',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} stream`
    const input = setupCommand(name, stream.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Streaming scan...\n'
      const spinner = ora(spinnerText).start()
      await getOrgFullScan(input.orgSlug, input.fullScanId, input.file, spinner)
    }
  }
}

// Internal functions

type CommandContext = {
  outputJson: boolean
  outputMarkdown: boolean
  orgSlug: string
  fullScanId: string
  file: string | undefined
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
      $ ${name} <org slug> <scan ID> <path to output file>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} FakeOrg 000aaaa1-0000-0a0a-00a0-00a0000000a0 ./stream.txt
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

  const { 0: orgSlug = '', 1: fullScanId = '', 2: file } = cli.input

  return <CommandContext>{
    outputJson,
    outputMarkdown,
    orgSlug,
    fullScanId,
    file
  }
}

async function getOrgFullScan(
  orgSlug: string,
  fullScanId: string,
  file: string | undefined,
  spinner: Ora
): Promise<void> {
  const socketSdk = await setupSdk(getDefaultKey())
  const result = await handleApiCall(
    socketSdk.getOrgFullScan(orgSlug, fullScanId, file),
    'Streaming a scan'
  )

  if (!result?.success) {
    handleUnsuccessfulApiResponse('getOrgFullScan', result, spinner)
    return
  }

  spinner.stop()

  console.log(
    file ? `\nFull scan details written to ${file}\n` : '\nFull scan details:\n'
  )
}
