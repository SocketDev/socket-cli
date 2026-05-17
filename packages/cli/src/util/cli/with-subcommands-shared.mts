/**
 * Shared types + the small `description()` helper for the CLI
 * sub-command router.
 *
 * Extracted from with-subcommands.mts so help-rendering and the
 * router can each pull in only what they need without circular
 * imports between with-subcommands.mts and with-subcommands-help.mts.
 */

import { indentString } from '@socketsecurity/lib/strings'

import type { Options } from '../../meow.mts'

export interface CliAlias {
  description: string
  argv: readonly string[]
  hidden?: boolean | undefined
}

export type CliAliases = Record<string, CliAlias>

export type CliSubcommandRun = (
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  context: { parentName: string; rawArgv?: readonly string[] | undefined },
) => Promise<void> | void

export interface CliSubcommand {
  description: string
  hidden?: boolean | undefined
  run: CliSubcommandRun
}

/**
 * Bucket assignments used by the root-help layout. The keys are
 * subcommand names that appear in the `subcommands` map; each value
 * is the bucket the command belongs to. Commands without an entry
 * here are reachable but not surfaced in the bucketed `socket --help`
 * layout — useful for ecosystem-specific or experimental commands.
 *
 * The application owns its bucket map (e.g. `rootCommandBuckets` in
 * `src/commands.mts`); the help builder reads it through
 * `MeowOptions.buckets` so this generic util doesn't need to import
 * the concrete registry.
 */
export type CliBucket = 'main' | 'api' | 'tools' | 'config'

export type CliBuckets = Readonly<Record<string, CliBucket>>

export interface MeowOptions extends Omit<Options, 'argv' | 'importMeta'> {
  aliases?: CliAliases | undefined
  /**
   * Per-subcommand bucket assignments for the root-help layout. Only
   * consumed by the root-command help text; ignored for sub-commands.
   */
  buckets?: CliBuckets | undefined
  // When no sub-command is given, default to this sub-command.
  defaultSub?: string | undefined
}

const HELP_PAD_NAME = 28

/**
 * Format a command description for help output.
 */
export function description(command: CliSubcommand | undefined): string {
  const description = command?.description
  const str =
    typeof description === 'string' ? description : String(description)
  return indentString(str, { count: HELP_PAD_NAME }).trimStart()
}
