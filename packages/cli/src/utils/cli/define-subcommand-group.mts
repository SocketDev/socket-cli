/**
 * Factory for "subcommand group" routers like `socket scan`, `socket package`,
 * `socket manifest`, `socket organization`. These commands are pure routers:
 * they delegate to a static map of child subcommands and optional aliases.
 *
 * Pre-factory the four router files used three subtly different shapes — one
 * declared a top-level `config` object whose flags were never consumed,
 * another inlined the meow call, the third had a `hidden: false` field that
 * only existed to satisfy the CliSubcommand type. This helper unifies the
 * shape into a single declarative spec:
 *
 *   export const cmdScan = defineSubcommandGroup({
 *     name: 'scan',
 *     description: 'Manage Socket scans',
 *     subcommands: { create: cmdScanCreate, … },
 *     aliases: { meta: { argv: ['metadata'], hidden: true, … } },
 *   })
 */

import { commonFlags } from '../../flags.mts'
import { defineFlags } from '../../meow.mts'
import { meowWithSubcommands } from './with-subcommands.mts'

import type { MeowFlags } from '../../flags.mts'
import type { CliAliases, CliSubcommand } from './with-subcommands-shared.mts'

export interface DefineSubcommandGroupOptions {
  /**
   * Group name as it appears under `socket`. Used as the second token of the
   * usage string (`socket <name> <subcommand>`).
   */
  name: string
  /**
   * One-line description for the parent command's help bucket and the
   * `socket --help` listing.
   */
  description: string
  /**
   * Hide the group from `socket --help`. Defaults to false.
   */
  hidden?: boolean | undefined
  /**
   * Map of subcommand name → CliSubcommand. The router routes the first
   * positional arg to the matching entry.
   */
  subcommands: Record<string, CliSubcommand>
  /**
   * Optional aliases. Each key is an alternative name for the group; its
   * `argv` is the canonical command tokens to invoke (e.g.
   * `aliases: { deps: { argv: ['dependencies'], … } }`).
   */
  aliases?: CliAliases | undefined
  /**
   * If true, pass the standard `commonFlags` (--dry-run, --help, --json,
   * --markdown, etc.) to meowWithSubcommands so the group's `--help` page
   * lists them. Defaults to false (no flags surface).
   *
   * Routers that previously declared `config = { flags: defineFlags({
   * ...commonFlags }) }` should pass `passCommonFlags: true` to preserve
   * the existing help output and any test assertions that inspect the
   * outgoing `config.flags`.
   */
  passCommonFlags?: boolean | undefined
  /**
   * Override the flags passed to meowWithSubcommands. Takes precedence over
   * `passCommonFlags`. Useful for groups that need extra flags beyond the
   * common set.
   */
  flags?: MeowFlags | undefined
}

/**
 * Define a subcommand-group router. Returns a CliSubcommand-shaped object
 * ready to plug into the parent meow router.
 *
 * The returned object only includes a `hidden` field when the caller
 * explicitly passes one — this preserves the shape of the pre-refactor
 * routers (which never had a `hidden` field at all) and keeps existing
 * test assertions about object identity / strict shape working.
 */
export function defineSubcommandGroup(
  opts: DefineSubcommandGroupOptions,
): CliSubcommand {
  const {
    aliases,
    description,
    flags,
    hidden,
    name,
    passCommonFlags,
    subcommands,
  } = opts

  const effectiveFlags =
    flags ?? (passCommonFlags ? defineFlags({ ...commonFlags }) : undefined)

  const result: CliSubcommand = {
    description,
    async run(argv, importMeta, { parentName }) {
      await meowWithSubcommands(
        {
          argv,
          name: `${parentName} ${name}`,
          importMeta,
          subcommands,
        },
        {
          ...(aliases ? { aliases } : {}),
          description,
          ...(effectiveFlags ? { flags: effectiveFlags } : {}),
        },
      )
    },
  }

  if (hidden !== undefined) {
    result.hidden = hidden
  }

  return result
}
