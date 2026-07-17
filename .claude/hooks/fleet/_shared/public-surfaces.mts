/**
 * @file Shared "is this command a public-facing publish?" check. The
 *   public-surface-nudge (Stop, nudges), private-name-nudge (PreToolUse),
 *   and issue-autolink-nudge all gate on the same set of outward-facing
 *   commands — commit, push, gh pr/issue/release, mutating gh api. One
 *   source keeps the gates from drifting. Detection rides the
 *   shell-quote-backed AST parser (commandsFor + gitSubcommand), never a raw
 *   regex over the command string: a quoted "git push" inside an echo body
 *   or heredoc is not a publish and must not fire the nudges.
 */

import { gitSubcommand } from './commit-command.mts'
import { commandsFor } from './shell-command.mts'

import type { Command } from './shell-command.mts'

// gh subcommand → the actions that publish content outside the local
// machine. Keep broad — better to remind on an extra read than miss a write.
const GH_PUBLIC_VERBS = new Map<string, readonly string[]>([
  ['issue', ['comment', 'create', 'edit']],
  ['pr', ['comment', 'create', 'edit', 'review']],
  ['release', ['create', 'edit']],
])

// HTTP methods that make a `gh api` call mutating (publish-capable).
const GH_MUTATING_METHODS = new Set(['PATCH', 'POST', 'PUT'])

/**
 * True when a parsed `gh` segment is a mutating `gh api` call — an `api`
 * subcommand whose `-X`/`--method` names PATCH/POST/PUT (separate or
 * `=`/`-X`-joined value).
 */
export function isMutatingGhApi(c: Command): boolean {
  if (c.args[0] !== 'api') {
    return false
  }
  for (let i = 0, { length } = c.args; i < length; i += 1) {
    const a = c.args[i]!
    if (a === '-X' || a === '--method') {
      const value = c.args[i + 1]
      if (value && GH_MUTATING_METHODS.has(value.toUpperCase())) {
        return true
      }
      continue
    }
    if (
      a.startsWith('-X') &&
      GH_MUTATING_METHODS.has(a.slice(2).toUpperCase())
    ) {
      return true
    }
    if (
      a.startsWith('--method=') &&
      GH_MUTATING_METHODS.has(a.slice('--method='.length).toUpperCase())
    ) {
      return true
    }
  }
  return false
}

/**
 * True when a parsed `gh` segment publishes content: a public verb pair
 * (`pr comment`, `issue create`, `release edit`, …) or a mutating `gh api`.
 */
export function isPublicGhSurface(c: Command): boolean {
  const verbs = c.args.filter(a => !a.startsWith('-'))
  const actions = GH_PUBLIC_VERBS.get(verbs[0] ?? '')
  if (actions && verbs[1] !== undefined && actions.includes(verbs[1])) {
    return true
  }
  return isMutatingGhApi(c)
}

/**
 * True when `command` invokes one of the public-surface publish commands as
 * a real shell segment.
 */
export function isPublicSurface(command: string): boolean {
  const gitPublishes = commandsFor(command, 'git').some(c => {
    const sub = gitSubcommand(c)
    return sub === 'commit' || sub === 'push'
  })
  if (gitPublishes) {
    return true
  }
  return commandsFor(command, 'gh').some(c => isPublicGhSurface(c))
}
