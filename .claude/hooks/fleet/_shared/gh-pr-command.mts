/**
 * @file Shared parsing of `gh pr create` / `gh pr new` Bash commands. The
 *   no-pr-from-default-branch-guard (vets the PR HEAD) and
 *   no-pr-from-default-checkout-guard (vets the checkout the command runs
 *   from) are twins gating the same invocation shape; they share this ONE
 *   detector so the two can never drift. Detection rides the
 *   shell-quote-backed AST parser, never a raw regex over the command string,
 *   so `&&` chains, quoting, and `$(…)` substitution are handled and a
 *   literal "gh pr create" inside a grep string can't false-fire.
 */

import { commandsFor } from './shell-command.mts'

import type { Command } from './shell-command.mts'

/**
 * The first `gh pr create` / `gh pr new` command segment, or undefined.
 */
export function ghPrCreateCommand(command: string): Command | undefined {
  return ghPrCreateCommands(command)[0]
}

/**
 * Every `gh pr create` / `gh pr new` command segment of `command`.
 */
export function ghPrCreateCommands(command: string): Command[] {
  return commandsFor(command, 'gh').filter(c => isGhPrCreateCmd(c))
}

/**
 * True when the command opens a PR (`gh pr create` / `gh pr new`).
 */
export function isGhPrCreate(command: string): boolean {
  return ghPrCreateCommand(command) !== undefined
}

/**
 * True when a parsed `gh` segment is a `pr create` / `pr new`. The verb is
 * the first two non-flag args after the binary, so `gh repo create` (a
 * different subcommand) does not match.
 */
export function isGhPrCreateCmd(c: Command): boolean {
  const verbs = c.args.filter(a => !a.startsWith('-'))
  return verbs[0] === 'pr' && (verbs[1] === 'create' || verbs[1] === 'new')
}
