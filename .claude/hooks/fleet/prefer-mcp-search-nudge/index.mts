/*
 * @file Claude Code PreToolUse hook — prefer-mcp-search-nudge.
 *
 * The fff MCP server is wired in `.mcp.json`, so `mcp__fff__grep`,
 * `mcp__fff__find_files`, and `mcp__fff__multi_grep` are available in every
 * session. Being available is not the same as being used: a session that
 * reached for Bash + `rg` 603 times called the MCP tools zero times, and its
 * searches carried costs the structured tools do not have.
 *
 * Three of those costs are concrete:
 *   - Short-flag clusters corrupt silently. `rg -rn pattern` parses as
 *     `--replace 'n'` and prints every match as `n` while still exiting 0, which
 *     is why `rg-replace-flag-guard` exists. A structured call has no flag
 *     string to fumble.
 *   - Case and naming variants become several sequential calls, where
 *     `multi_grep` takes them in one.
 *   - Frecency ranking is lost. fff boosts git-dirty and recently-touched
 *     files, which is exactly the ordering that helps in a tree another actor is
 *     actively writing.
 *
 * Stderr reminder; never blocks. `rg` remains correct for the cases the MCP
 * tools cannot serve, and the carve-outs below encode those.
 *
 * Scope: Bash tool only. It nudges ONLY a search standing at the head of its
 * own pipeline, because that is the shape the MCP tools replace. Skipped:
 *   - a search DOWNSTREAM of a pipe (`cmd | rg pattern`) — it filters another
 *     command's stdout, which no file-search tool can do;
 *   - `find` carrying `-delete` or `-exec` — that performs an operation rather
 *     than answering a question;
 *   - `--version` / `--help` probes.
 */

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import {
  commandsFor,
  normalizeNewlineSeparators,
} from '../_shared/shell-command.mts'

// The search binaries the fff MCP tools stand in for.
const SEARCH_BINARIES: readonly string[] = ['find', 'grep', 'rg']

// Flags that make an invocation something other than a search to replace.
const NOT_A_SEARCH_FLAGS: ReadonlySet<string> = new Set([
  '--delete',
  '--help',
  '--version',
  '-delete',
  '-exec',
  '-execdir',
  '-h',
  '-ok',
])

/**
 * The text of each pipeline's HEAD command, one entry per statement.
 *
 * Statements are cut first on `;`, `&&`, and `||` so a `||` is never read as a
 * pipe; each statement's head is then everything before its first `|`. So
 * `rg a | head` yields `rg a`, and `cmd | rg a` yields `cmd`.
 */
export function pipelineHeadSegments(command: string): string[] {
  const flat = normalizeNewlineSeparators(command)
  const statements = flat.split(/;|&&|\|\|/)
  const heads: string[] = []
  for (let i = 0, { length } = statements; i < length; i += 1) {
    const statement = statements[i]!
    const pipeAt = statement.indexOf('|')
    heads.push(pipeAt === -1 ? statement : statement.slice(0, pipeAt))
  }
  return heads
}

/**
 * True when `args` mark the invocation as an operation or a probe rather than a
 * search the MCP tools could answer.
 */
export function isNonSearchInvocation(args: readonly string[]): boolean {
  return args.some(arg => NOT_A_SEARCH_FLAGS.has(arg))
}

/**
 * The search binaries standing at a pipeline head in `command`, deduplicated
 * and in the order first seen.
 *
 * Parsed rather than regex-matched, so a quoted mention of `rg` in a commit
 * message and a `--replace rg` value are not harvested as commands.
 */
export function searchesAtPipelineHead(command: string): string[] {
  const found: string[] = []
  const heads = pipelineHeadSegments(command)
  for (let i = 0, { length } = heads; i < length; i += 1) {
    const head = heads[i]!
    for (let j = 0, jLen = SEARCH_BINARIES.length; j < jLen; j += 1) {
      const binary = SEARCH_BINARIES[j]!
      if (found.includes(binary)) {
        continue
      }
      const matches = commandsFor(head, binary)
      if (matches.some(match => !isNonSearchInvocation(match.args))) {
        found.push(binary)
      }
    }
  }
  return found
}

export const hook = defineHook({
  check: bashGuard(command => {
    const searches = searchesAtPipelineHead(command)
    if (searches.length === 0) {
      return undefined
    }
    return notify(
      [
        `[prefer-mcp-search-nudge] \`${searches.join('`, `')}\` at a pipeline head — the fff MCP tools answer this.`,
        '',
        '  fff is wired in .mcp.json, so these are already available:',
        '',
        '    mcp__fff__grep         file CONTENTS by one bare identifier',
        '    mcp__fff__find_files   which files exist for a topic',
        '    mcp__fff__multi_grep   several identifiers in ONE call',
        '',
        '  Why they beat a shelled search: results are frecency-ranked, so',
        '  git-dirty and recently-touched files come first; there is no',
        '  short-flag cluster to corrupt (`rg -rn` silently becomes',
        "  `--replace 'n'` and still exits 0); and case or naming variants",
        '  go in one multi_grep instead of several sequential calls.',
        '',
        '  A shelled search stays right where the MCP tools cannot serve it:',
        "  filtering another command's output (`cmd | rg pattern`), or a",
        '  `find` that operates rather than answers (`-delete`, `-exec`).',
        '  Both are already skipped, so this fired on a plain search.',
        '',
      ].join('\n'),
    )
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
