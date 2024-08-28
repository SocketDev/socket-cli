import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'
import util from 'util'

import { outputFlags } from '../../flags'
import { printFlagList } from '../../utils/formatting'
import { getDefaultKey } from '../../utils/sdk'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'
import type { Ora } from 'ora'
import { AuthError } from '../../utils/errors'
import { handleAPIError, queryAPI } from '../../utils/api-helpers'

export const get: CliSubcommand = {
  description: 'Get a diff scan for an organization',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} get`
    const input = setupCommand(name, get.description, argv, importMeta)
    if (input) {
      const apiKey = getDefaultKey()
      if(!apiKey){
        throw new AuthError("User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.")
      }
      const spinnerText = 'Getting diff scan... \n'
      const spinner = ora(spinnerText).start()
      await getDiffScan(input.before, input.after, spinner, apiKey, input.orgSlug)
    }
  }
}

const getDiffScanFlags: { [key: string]: any } = {
  before: {
    type: 'string',
    shortFlag: 'b',
    default: '',
    description: 'The full scan ID of the base scan'
  },
  after: {
    type: 'string',
    shortFlag: 'a',
    default: '',
    description: 'The full scan ID of the head scan'
  },
  preview: {
    type: 'boolean',
    shortFlag: 'p',
    default: true,
    description: 'A boolean flag to persist or not the diff scan result'
  },
}

// Internal functions

type CommandContext = {
  outputJson: boolean
  outputMarkdown: boolean
  before: string
  after: string
  preview: boolean
  orgSlug: string
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): CommandContext | undefined {
  const flags: { [key: string]: any } = {
    ...outputFlags,
    ...getDiffScanFlags
  }

  const cli = meow(
    `
    Usage
      $ ${name}

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name}
  `,
    {
      argv,
      description,
      importMeta,
      flags
    }
  )

  const {
    json: outputJson,
    markdown: outputMarkdown,
    before,
    after,
    preview,
  } = cli.flags

  if (!before || !after) {
    console.error(
      `${chalk.bgRed.white('Input error')}: Please specify a before and after full scan ID. To get full scans IDs, you can run the command "socket scan list <your org slug>". \n`
    )
    cli.showHelp()
    return
  }

  if(cli.input.length < 1){
    console.error(
      `${chalk.bgRed.white('Input error')}: Please provide an organization slug \n`
    )
    cli.showHelp()
    return
  }

  const [orgSlug = ''] = cli.input

  return <CommandContext>{
    outputJson,
    outputMarkdown,
    before,
    after,
    preview,
    orgSlug
  }
}

async function getDiffScan(
  before: string,
  after: string,
  spinner: Ora, 
  apiKey: string,
  orgSlug: string
): Promise<void> {
  const response = await queryAPI(`${orgSlug}/full-scans/diff?before=${before}&after=${after}&preview`, apiKey)
  const data = await response.json();

  if(response.status !== 200){
    spinner.stop()
    const err = await handleAPIError(response.status)
    console.error(err)
    return
  }

  spinner.stop()

  // before: dfc4cf0c-aefd-4081-9e4e-7385257f26e2
  // after: 922e45f5-8a7b-4b16-95a5-e98ad00470f1

  console.log(`\n Diff scan result: \n`)
//   console.log(data);

  console.log(util.inspect(data, {showHidden: false, depth: null, colors: true}))
}
