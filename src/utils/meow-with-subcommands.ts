import meow from 'meow'

import { printFlagList, printHelpList } from './formatting'

import type { Options } from 'meow'

interface CliAlias {
  description: string
  argv: readonly string[]
}

type CliAliases = Record<string, CliAlias>

type CliSubcommandRun = (
  argv: readonly string[],
  importMeta: ImportMeta,
  context: { parentName: string }
) => Promise<void> | void

export interface CliSubcommand {
  description: string
  run: CliSubcommandRun
}

interface MeowOptions extends Options<any> {
  aliases?: CliAliases
  argv: readonly string[]
  name: string
}

function sortKeys<T extends { [key: string]: any }>(object: T): T {
  return <T>Object.fromEntries(
    Object.keys(object)
      .sort()
      .map(k => [k, object[k]])
  )
}

export async function meowWithSubcommands(
  subcommands: Record<string, CliSubcommand>,
  options: MeowOptions
): Promise<void> {
  const { aliases = {}, argv, name, importMeta, ...additionalOptions } = options

  const [commandOrAliasName, ...rawCommandArgv] = argv

  // If we got at least some args, then lets find out if we can find a command
  if (commandOrAliasName) {
    const alias = aliases[commandOrAliasName]

    // First: Resolve argv data from alias if its an alias that's been given
    const [commandName, ...commandArgv] = alias
      ? [...alias.argv, ...rawCommandArgv]
      : [commandOrAliasName, ...rawCommandArgv]

    // Second: Find a command definition using that data
    const commandDefinition = commandName ? subcommands[commandName] : undefined

    // Third: If a valid command has been found, then we run it...
    if (commandDefinition) {
      return await commandDefinition.run(commandArgv, importMeta, {
        parentName: name
      })
    }
  }

  // ...else we provide basic instructions and help
  const cli = meow(
    `
    Usage
      $ ${name} <command>

    Commands
      ${printHelpList(
        {
          ...sortKeys(subcommands),
          ...sortKeys(aliases)
        },
        6
      )}

    Options
      ${printFlagList({}, 6)}

    Examples
      $ ${name} --help
  `,
    {
      argv,
      importMeta,
      ...additionalOptions
    }
  )

  cli.showHelp()
}
