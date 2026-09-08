import type { CliSubcommand } from './with-subcommands-shared.mts'

export function lookupSubcommand<CommandName extends string>(
  subcommands: Record<CommandName, CliSubcommand>,
  name: string,
): CliSubcommand | undefined {
  return Object.hasOwn(subcommands, name)
    ? subcommands[name as CommandName]
    : undefined
}
