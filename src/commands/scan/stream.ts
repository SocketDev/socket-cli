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
import type { SocketSdkResultType } from '@socketsecurity/sdk'

export const stream: CliSubcommand = {
  description: 'Stream the output of a scan',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} stream`
    const input = setupCommand(name, stream.description, argv, importMeta)
    if (input) {
      const apiKey = getDefaultKey()
      if (!apiKey) {
        throw new AuthError(
          'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
        )
      }
      const spinner = new Spinner({ text: 'Streaming scan...' }).start()
      const result = await getOrgFullScan(
        input.orgSlug,
        input.fullScanId,
        input.file,
        apiKey
      )

      if (result?.success) {
        spinner.stop(
          input.file ? `Full scan details written to ${input.file}` : ''
        )
      } else {
        handleUnsuccessfulApiResponse('getOrgFullScan', result, spinner)
      }
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
    ...commonFlags,
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
  const { 0: orgSlug = '', 1: fullScanId = '', 2: file } = cli.input
  return <CommandContext>{
    outputJson: cli.flags['json'],
    outputMarkdown: cli.flags['markdown'],
    orgSlug,
    fullScanId,
    file
  }
}

async function getOrgFullScan(
  orgSlug: string,
  fullScanId: string,
  file: string | undefined,
  apiKey: string
): Promise<SocketSdkResultType<'getOrgFullScan'>> {
  const socketSdk = await setupSdk(apiKey)
  return await handleApiCall(
    socketSdk.getOrgFullScan(orgSlug, fullScanId, file),
    'Streaming a scan'
  )
}
