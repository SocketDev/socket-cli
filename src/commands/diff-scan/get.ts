import fs from 'node:fs'
import util from 'node:util'

import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags'
import { handleAPIError, queryAPI } from '../../utils/api-helpers'
import { AuthError } from '../../utils/errors'
import { printFlagList } from '../../utils/formatting'
import { getDefaultKey } from '../../utils/sdk'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'
import type { Ora } from 'ora'

export const get: CliSubcommand = {
  description: 'Get a diff scan for an organization',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} get`
    const input = setupCommand(name, get.description, argv, importMeta)
    if (input) {
      const apiKey = getDefaultKey()
      if (!apiKey) {
        throw new AuthError(
          'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
        )
      }
      const spinnerText = 'Getting diff scan... \n'
      const spinner = ora(spinnerText).start()
      await getDiffScan(input, spinner, apiKey)
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
  file: {
    type: 'string',
    shortFlag: 'f',
    default: '',
    description: 'Path to a local file where the output should be saved'
  }
}

// Internal functions

type CommandContext = {
  outputJson: boolean
  outputMarkdown: boolean
  before: string
  after: string
  preview: boolean
  orgSlug: string
  file: string
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): CommandContext | undefined {
  const flags: { [key: string]: any } = {
    __proto__: null,
    ...outputFlags,
    ...getDiffScanFlags
  }

  const cli = meow(
    `
    Usage
      $ ${name} <org slug> --before=<before> --after=<after>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} FakeCorp --before=aaa0aa0a-aaaa-0000-0a0a-0000000a00a0 --after=aaa1aa1a-aaaa-1111-1a1a-1111111a11a1
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
    file
  } = cli.flags

  if (!before || !after) {
    console.error(
      `${chalk.bgRed.white('Input error')}: Please specify a before and after full scan ID. To get full scans IDs, you can run the command "socket scan list <your org slug>".\n`
    )
    cli.showHelp()
    return
  }

  if (cli.input.length < 1) {
    console.error(
      `${chalk.bgRed.white('Input error')}: Please provide an organization slug\n`
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
    orgSlug,
    file
  }
}

async function getDiffScan(
  { before, after, orgSlug, file, outputJson }: CommandContext,
  spinner: Ora,
  apiKey: string
): Promise<void> {
  const response = await queryAPI(
    `${orgSlug}/full-scans/diff?before=${before}&after=${after}&preview`,
    apiKey
  )
  const data = await response.json()

  if (!response.ok) {
    spinner.stop()
    const err = await handleAPIError(response.status)
    console.error(`${chalk.bgRed.white(response.statusText)}: ${err}\n`)
    return
  }

  spinner.stop()

  if (file && !outputJson) {
    fs.writeFile(file, JSON.stringify(data), err => {
      err
        ? console.error(err)
        : console.log(`Data successfully written to ${file}`)
    })
    return
  }

  if (outputJson) {
    console.log(`\n Diff scan result: \n`)
    console.log(
      util.inspect(data, { showHidden: false, depth: null, colors: true })
    )
    // @ts-ignore
    console.log(
      `\n View this diff scan in the Socket dashboard: ${chalk.cyan((data as any)?.['diff_report_url'])}\n`
    )
    return
  }

  console.log('Diff scan result: ')
  console.log(data)
  console.log(
    `\n 📝 To display the detailed report in the terminal, use the --json flag \n`
  )
  // @ts-ignore
  console.log(
    `\n View this diff scan in the Socket dashboard: ${chalk.cyan((data as any)?.['diff_report_url'])}\n`
  )
}
