/**
 * Alias/command resolution and dispatch for the CLI sub-command router —
 * given the parsed command name, finds (or suggests) the matching
 * sub-command and runs it.
 *
 * Extracted from with-subcommands.mts to keep that file under the 1000-line
 * File size hard cap.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { findBestCommandMatch } from './with-subcommands-fuzzy-match.mts'

import type { CliAliases, CliSubcommand } from './with-subcommands-shared.mts'
import type { CliCommandContext } from './with-subcommands.mts'

const logger = getDefaultLogger()

export interface DispatchSubcommandOptions {
  aliases: CliAliases
  commandOrAliasName: string
  defaultSub: string | undefined
  importMeta: ImportMeta
  name: string
  rawCommandArgv: string[]
  subcommands: Record<string, CliSubcommand>
}

/**
 * Resolve `commandOrAliasName` against `subcommands`/`aliases` and run the
 * match. Returns `true` once the router should stop (either because a
 * sub-command ran, or because an unknown-command error was already reported).
 */
export async function tryDispatchSubcommand(
  options: DispatchSubcommandOptions,
): Promise<boolean> {
  const {
    aliases,
    commandOrAliasName,
    defaultSub,
    importMeta,
    name,
    rawCommandArgv,
    subcommands,
  } = options

  // Skip command lookup if first arg is a flag (starts with -)
  if (!commandOrAliasName || commandOrAliasName.startsWith('-')) {
    return false
  }

  const alias = aliases[commandOrAliasName]
  // First: Resolve argv data from alias if its an alias that's been given.
  const [commandName, ...commandArgv] = alias
    ? [...alias.argv, ...rawCommandArgv]
    : [commandOrAliasName, ...rawCommandArgv]
  // Second: Find a command definition using that data.
  const commandDefinition = commandName ? subcommands[commandName] : undefined
  // Third: If a valid command has been found, then we run it...
  if (commandDefinition) {
    // Extract the original command arguments from the full argv
    // by skipping the command name
    const context: CliCommandContext = { parentName: name }
    if (alias) {
      context.invokedAs = commandOrAliasName
    }
    await commandDefinition.run(commandArgv, importMeta, context)
    return true
  }

  // If no command found but defaultSub exists, use it as the command.
  // This treats the first arg as an argument to the default subcommand.
  if (!commandDefinition && defaultSub && subcommands[defaultSub]) {
    await subcommands[defaultSub]!.run(
      [commandOrAliasName, ...rawCommandArgv],
      importMeta,
      {
        parentName: name,
      },
    )
    return true
  }

  // Suggest similar commands for typos.
  if (commandName && !commandDefinition) {
    const suggestion = findBestCommandMatch(commandName, subcommands, aliases)
    if (suggestion) {
      process.exitCode = 2
      logger.fail(
        `Unknown command "${commandName}". Did you mean "${suggestion}"?`,
      )
      return true
    }

    // Unknown command with no suggestion - show error and fall through to help.
    process.exitCode = 2
    logger.fail(`Unknown command "${commandName}".`)
    logger.info('Tip: Use `socket pycli` to invoke the Python CLI directly.')
    return true
  }

  return false
}
