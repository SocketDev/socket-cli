import meow from 'meow'

import { printFlagList, printHelpList } from './formatting.js'

/**
 * @typedef CliAlias
 * @property {string} description
 * @property {readonly string[]} argv
 */

/** @typedef {Record<string, CliAlias>} CliAliases */

/**
 * @callback CliSubcommandRun
 * @param {readonly string[]} argv
 * @param {ImportMeta} importMeta
 * @param {{ parentName: string }} context
 * @returns {Promise<void>|void}
 */

/**
 * @typedef CliSubcommand
 * @property {string} description
 * @property {CliSubcommandRun} run
 */

/**
 * @template {import('meow').AnyFlags} Flags
 * @param {Record<string, CliSubcommand>} subcommands
 * @param {import('meow').Options<Flags> & { aliases?: CliAliases, argv: readonly string[], name: string }} options
 * @returns {Promise<void>}
 */
export async function meowWithSubcommands (subcommands, options) {
  const {
    aliases = {},
    argv,
    name,
    importMeta,
    ...additionalOptions
  } = options

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
      return await commandDefinition.run(
        commandArgv,
        importMeta,
        {
          parentName: name
        }
      )
    }
  }

  // ...else we provide basic instructions and help
  const cli = meow(`
    Usage
      $ ${name} <command>

    Commands
      ${printHelpList({ ...subcommands, ...aliases }, 6)}

    Options
      ${printFlagList({}, 6)}

    Examples
      $ ${name} --help
  `, {
    argv,
    importMeta,
    ...additionalOptions,
  })

  cli.showHelp()
}
