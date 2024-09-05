import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../flags'
import { printFlagList } from '../utils/formatting'
import { getDefaultKey } from '../utils/sdk'

import type { CliSubcommand } from '../utils/meow-with-subcommands'
import type { Ora } from 'ora'
import { AuthError } from '../utils/errors'
import { queryAPI } from '../utils/api-helpers'

export const threatFeed: CliSubcommand = {
  description: 'Look up the threat feed',
  async run(argv, importMeta, { parentName }) {
    const name = parentName + ' threat-feed'

    const input = setupCommand(name, threatFeed.description, argv, importMeta)
    if (input) {
      const apiKey = getDefaultKey()
      if(!apiKey){
        throw new AuthError("User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.")
      }
      const spinner = ora(`Looking up the threat feed \n`).start()
      await fetchThreatFeed(spinner, apiKey)
    }
  }
}

// Internal functions

type CommandContext = {
  outputJson: boolean
  outputMarkdown: boolean
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
      $ ${name} <org slug>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} FakeOrg
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
  } = cli.flags

  return <CommandContext>{
    outputJson,
    outputMarkdown
  }
}

async function fetchThreatFeed(
  spinner: Ora,
  apiKey: string
): Promise<void> {
  const response = await queryAPI(`threat-feed`, apiKey)
  const data = await response.json();

  spinner.stop()
  console.log(data)
}
