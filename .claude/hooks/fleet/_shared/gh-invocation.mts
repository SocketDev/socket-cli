/*
 * @file Command-position readers for a parsed `gh` invocation. A hook that asks
 *   "which GitHub subcommand is this" must read the PARSED positional
 *   arguments, never the raw command line: substring matching harvests prose
 *   that merely quotes a command as if it were one.
 *
 *   `commandsFor(command, 'gh')` in `shell-command.mts` does the tokenizing and
 *   hands back one `Command` per `gh` segment; these helpers turn that
 *   segment's `args` into the answers a hook needs.
 *
 *   Two hooks share them. `honeypot-echo-guard` posts to a thread and
 *   `untrusted-content-directive-nudge` reads one, so keeping the parsing in
 *   one place stops the two from drifting on what counts as a subcommand or a
 *   thread endpoint.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

/**
 * The positional (non-flag) arguments of a parsed `gh` invocation, in order.
 */
export function ghPositionalArgs(args: readonly string[]): string[] {
  return args.filter(a => !a.startsWith('-'))
}

/**
 * The `noun verb` subcommand this positional list carries, or undefined when it
 * carries none of `verbsByNoun`'s pairs.
 *
 * A pair counts only when the noun is IMMEDIATELY followed by one of its verbs
 * — `pr comment`, `pr view`, `issue view`. Adjacency is what makes the pair a
 * subcommand rather than two loose words that happen to appear in the same
 * command line. A global flag's value (`gh --repo o/r pr view`) is itself
 * positional, so scanning for the adjacent pair also keeps that value from
 * being mistaken for the subcommand.
 */
export function findGhSubcommand(
  positional: readonly string[],
  verbsByNoun: ReadonlyMap<string, ReadonlySet<string>>,
): string | undefined {
  for (let i = 0, { length } = positional; i < length - 1; i += 1) {
    const noun = positional[i]!
    const verb = positional[i + 1]!
    if (verbsByNoun.get(noun)?.has(verb)) {
      return `${noun} ${verb}`
    }
  }
  return undefined
}

/**
 * True when the positional list carries one of `verbsByNoun`'s subcommand
 * pairs.
 */
export function hasGhSubcommand(
  positional: readonly string[],
  verbsByNoun: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  return findGhSubcommand(positional, verbsByNoun) !== undefined
}

/**
 * The positionals that follow `api` in a `gh api …` invocation — the endpoint
 * path and anything after it. Returns undefined when the invocation is not
 * `gh api` at all, which a caller reads as "no API endpoint to inspect".
 */
export function ghApiPositionals(
  positional: readonly string[],
): string[] | undefined {
  const apiIndex = positional.indexOf('api')
  return apiIndex < 0 ? undefined : positional.slice(apiIndex + 1)
}

/**
 * True when a `gh api` positional names a comments or reviews endpoint — the
 * REST paths that carry thread prose in either direction.
 */
export function isGhThreadEndpoint(arg: string): boolean {
  const normalized = normalizePath(arg)
  return (
    normalized.includes('/comments') ||
    normalized.includes('/reviews') ||
    normalized.endsWith('comments') ||
    normalized.endsWith('reviews')
  )
}
