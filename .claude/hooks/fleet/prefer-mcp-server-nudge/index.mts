/*
 * @file Claude Code PreToolUse hook — prefer-mcp-server-nudge.
 *
 * Five MCP servers besides fff answer questions a session otherwise answers the
 * hard way: Linear, Notion, Playwright, refero, and janus. Each one is wired
 * already. Linear
 * and Notion arrive as a claude.ai connector or as an `.mcp.json` project
 * server; refero and janus arrive as project servers in the cascaded
 * `.mcp.json`. So their tools sit in every session's tool list, and being wired
 * is not the same as being reached for:
 * the sibling `prefer-mcp-search-nudge` exists because one session shelled out
 * to `rg` 603 times and called the fff tools zero times, and the same gap opens
 * on every other server.
 *
 * Reaching a server the hard way costs three things the structured tools do not:
 *   - The page behind the URL is rendered HTML behind a login, so a fetch gets
 *     a sign-in wall or a JS shell rather than the record.
 *   - Fields arrive as prose to re-parse instead of typed values, so an issue
 *     state or a screen's palette has to be read back out of markup.
 *   - Writes have no path at all. A fetch can read a page; only the tools can
 *     save a comment, move a status, or create a ticket.
 *
 * ONE table-driven hook, not four near-identical directories. Every row in
 * MCP_SERVERS names the server, the tool prefixes that reach it, and the signal
 * that means the hard way was taken. A fifth server is a row.
 *
 * Stderr reminder; never blocks. Both tool prefixes are listed per server
 * because a project `.mcp.json` entry SHADOWS the claude.ai connector when both
 * name the same service, so which prefix arrives depends on the checkout rather
 * than on anything this hook can see.
 *
 * Scope: Bash (a URL anywhere among the command's real arguments, plus the
 * `janus` binary at a command position) and WebFetch (its `url` input). Skipped:
 *   - a URL inside a `git commit -m` / `gh --body` prose value — a mention of a
 *     ticket, not a reach for it;
 *   - a bare host carrying neither a scheme nor a path (`linear.app` written in
 *     a sentence or handed to a search as a pattern);
 *   - a host that merely starts with a target host (`notionfake.com`).
 */

import { toUnixPath } from '@socketsecurity/lib-stable/paths/normalize'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import { readCommand } from '../_shared/payload.mts'
import { commandsFor, parseCommands } from '../_shared/shell-command.mts'

import type { GuardCheck, GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

/**
 * One MCP tool-name prefix and the surface that delivers it.
 */
export interface McpToolReach {
  readonly prefix: string
  readonly surface: string
}

/**
 * One server's row: how its tools are named, and what "reached the hard way"
 * looks like for it.
 */
export interface McpServerRow {
  /**
   * Binaries that reach this server from a shell. Matched at COMMAND POSITION,
   * so a quoted mention in a commit message is not a reach.
   */
  readonly binaries: readonly string[]
  /**
   * Hosts whose URLs the tools replace. A host matches itself and any
   * subdomain of it, never a longer host that merely starts with it.
   */
  readonly hosts: readonly string[]
  /**
   * The server's name as a human says it, shown in the nudge.
   */
  readonly label: string
  /**
   * Path fragments that mean the command is reading this server's own store.
   */
  readonly pathMarkers: readonly string[]
  /**
   * What the tools give that the hard way does not, one entry per printed line.
   */
  readonly payoff: readonly string[]
  /**
   * Tool prefixes to reach for instead.
   */
  readonly tools: readonly McpToolReach[]
}

// One row per wired server, sorted by label in ASCII byte order.
export const MCP_SERVERS: readonly McpServerRow[] = [
  {
    binaries: [],
    hosts: ['linear.app'],
    label: 'Linear',
    pathMarkers: [],
    payoff: [
      'Issues, comments, projects, cycles, and status transitions as typed',
      'records — and the write side (save_issue, save_comment) that a page',
      'fetch has no path to at all.',
    ],
    tools: [
      { prefix: 'mcp__claude_ai_Linear__', surface: 'claude.ai connector' },
      { prefix: 'mcp__linear__', surface: '.mcp.json project server' },
    ],
  },
  {
    binaries: [],
    hosts: ['notion.com', 'notion.so'],
    label: 'Notion',
    pathMarkers: [],
    payoff: [
      'Pages, databases, and comments as structured blocks, plus search across',
      'the workspace. A fetched Notion page is a JS shell behind a login, so',
      'the content is not in the response at all.',
    ],
    tools: [
      { prefix: 'mcp__claude_ai_Notion__', surface: 'claude.ai connector' },
      { prefix: 'mcp__notion__', surface: '.mcp.json project server' },
    ],
  },
  {
    binaries: ['playwright'],
    hosts: [],
    label: 'Playwright',
    pathMarkers: [],
    payoff: [
      'Typed browser actions (browser_navigate, browser_click, browser_snapshot)',
      'over a real headed browser, with the Socket agent banner injected on',
      'every page so a human can always tell the tab is agent-driven. A raw',
      'playwright script hand-rolls a launch the fleet already sanctions once.',
    ],
    tools: [
      { prefix: 'mcp__playwright__', surface: '.mcp.json project server' },
    ],
  },
  {
    binaries: ['janus'],
    hosts: [],
    label: 'janus',
    pathMarkers: ['.janus/'],
    payoff: [
      'Tickets, workspaces, and status changes as typed records. The layout',
      'under `.janus/` is an implementation detail the server owns, so reading',
      'it directly breaks the moment that layout moves.',
    ],
    tools: [
      { prefix: 'mcp__janus-multi__', surface: '.mcp.json project server' },
    ],
  },
  {
    binaries: [],
    hosts: ['refero.design'],
    label: 'refero',
    pathMarkers: [],
    payoff: [
      'Screens, flows, and styles with their design metadata and image URLs,',
      'plus similarity search. The site itself is a rendered gallery, so a',
      'fetch returns the shell rather than the reference.',
    ],
    tools: [{ prefix: 'mcp__refero__', surface: '.mcp.json project server' }],
  },
]

// Flags on `gh` / `git` whose value is prose a human wrote rather than a target
// the command reaches. A URL or a `.janus/` path inside one of these is a
// mention, so the value is dropped before the signal scan. Scoped to those two
// binaries on purpose: `-b` means `--cookie` to curl and `-t` means
// `--telnet-option`, so a blanket short-flag list would drop real arguments.
const PROSE_FLAGS: ReadonlySet<string> = new Set([
  '--body',
  '--body-text',
  '--message',
  '--title',
  '-b',
  '-m',
  '-t',
])

// The binaries whose flags PROSE_FLAGS describes.
const PROSE_FLAG_BINARIES: ReadonlySet<string> = new Set(['gh', 'git'])

/*
 * A URL-ish token, in three captured parts:
 *   1. `(https?:\/\/)?` — the optional scheme.
 *   2. `((?:[a-z0-9-]+\.)+[a-z]{2,})` — dot-separated host labels ending in a
 *      two-or-more-letter TLD, so `linear.app` and `docs.notion.so` both land
 *      in this group.
 *   3. `(\/[^\s'"`<>|)\]]*)?` — the optional path, stopped by whitespace or a
 *      quote/bracket the shell or a sentence would put after a URL.
 * `(?::\d+)?` between 2 and 3 absorbs a port without capturing it. A candidate
 * counts only when group 1 or group 3 is present, so a bare `linear.app` in a
 * sentence is a mention rather than a reach.
 */
const URL_CANDIDATE_RE =
  /(https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(\/[^\s'"`<>|)\]]*)?/gi

/**
 * A matched row plus how it was spotted, phrased for the nudge.
 */
export interface McpServerReach {
  readonly detail: string
  readonly server: McpServerRow
}

/**
 * True for the `--flag=value` spelling of a prose flag, whose value rides in
 * the same token.
 */
export function isProseFlagAssignment(arg: string): boolean {
  const eq = arg.indexOf('=')
  return eq > 0 && PROSE_FLAGS.has(arg.slice(0, eq))
}

/**
 * The tokens of `command` a reach signal may legitimately come from: every
 * parsed segment's binary and arguments, with `gh`/`git` prose-flag values
 * dropped.
 *
 * Parsed rather than scanned, so quoting and `&&` chains are handled, a heredoc
 * body (data, never a command) contributes nothing, and a commit message is a
 * single droppable token instead of loose words.
 */
export function reachSignalTokens(command: string): string[] {
  const tokens: string[] = []
  const commands = parseCommands(command)
  for (let i = 0, { length } = commands; i < length; i += 1) {
    const cmd = commands[i]!
    tokens.push(cmd.binary)
    const dropsProse = PROSE_FLAG_BINARIES.has(cmd.binary)
    const { args } = cmd
    for (let j = 0, jLen = args.length; j < jLen; j += 1) {
      const arg = args[j]!
      if (dropsProse && PROSE_FLAGS.has(arg)) {
        // Drop the flag AND the separate token holding its value.
        j += 1
        continue
      }
      if (dropsProse && isProseFlagAssignment(arg)) {
        continue
      }
      tokens.push(arg)
    }
  }
  return tokens
}

/**
 * True when `host` is `serverHost` itself or a subdomain of it. A longer host
 * that merely starts with the target (`notionfake.com` against `notion.com`)
 * is not a match, which is the whole point of comparing on the dot boundary.
 */
export function hostReachesServer(host: string, serverHost: string): boolean {
  const lower = host.toLowerCase()
  return lower === serverHost || lower.endsWith(`.${serverHost}`)
}

/**
 * Every server a stretch of text reaches by URL, deduplicated and in the order
 * first seen. Pass the joined signal tokens for a Bash command, or the `url`
 * input for a WebFetch — one code path, so the two surfaces cannot drift.
 */
export function urlReachedServers(text: string): McpServerReach[] {
  const reaches: McpServerReach[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(URL_CANDIDATE_RE)) {
    const scheme = match[1]
    const host = match[2]!
    const urlPath = match[3]
    if (!scheme && !urlPath) {
      continue
    }
    for (let i = 0, { length } = MCP_SERVERS; i < length; i += 1) {
      const server = MCP_SERVERS[i]!
      if (seen.has(server.label)) {
        continue
      }
      if (server.hosts.some(h => hostReachesServer(host, h))) {
        seen.add(server.label)
        reaches.push({
          detail: `reached by a \`${host.toLowerCase()}\` URL`,
          server,
        })
      }
    }
  }
  return reaches
}

/**
 * Every server a Bash command reaches the hard way: a URL among its real
 * arguments, one of its CLIs at a command position, or a path into its own
 * store. One entry per server, so a repeated reach reports once.
 */
export function commandReachedServers(command: string): McpServerReach[] {
  const tokens = reachSignalTokens(command)
  const reaches = urlReachedServers(tokens.join(' '))
  const seen = new Set(reaches.map(reach => reach.server.label))
  for (let i = 0, { length } = MCP_SERVERS; i < length; i += 1) {
    const server = MCP_SERVERS[i]!
    if (seen.has(server.label)) {
      continue
    }
    const binary = server.binaries.find(b => commandsFor(command, b).length > 0)
    if (binary) {
      reaches.push({
        detail: `reached by the \`${binary}\` binary at a command position`,
        server,
      })
      continue
    }
    const marker = server.pathMarkers.find(m =>
      tokens.some(token => toUnixPath(token).includes(m)),
    )
    if (marker) {
      reaches.push({
        detail: `reached by a path into \`${marker}\``,
        server,
      })
    }
  }
  return reaches
}

/**
 * The stderr reminder for one or more reached servers.
 */
export function formatServerNudge(reaches: readonly McpServerReach[]): string {
  const labels = reaches.map(reach => reach.server.label)
  const lines = [
    `[prefer-mcp-server-nudge] \`${labels.join('`, `')}\` reached the hard way — the wired MCP tools answer this.`,
    '',
  ]
  for (let i = 0, { length } = reaches; i < length; i += 1) {
    const { detail, server } = reaches[i]!
    const width = Math.max(...server.tools.map(tool => tool.prefix.length))
    lines.push(`  ${server.label} — ${detail}. Already available:`, '')
    for (let j = 0, jLen = server.tools.length; j < jLen; j += 1) {
      const tool = server.tools[j]!
      lines.push(`    ${`${tool.prefix}…`.padEnd(width + 1)}   ${tool.surface}`)
    }
    lines.push('')
    for (let j = 0, jLen = server.payoff.length; j < jLen; j += 1) {
      lines.push(`    ${server.payoff[j]!}`)
    }
    lines.push('')
  }
  if (reaches.some(reach => reach.server.tools.length > 1)) {
    lines.push(
      '  Two prefixes are listed because one service reaches a session two',
      '  ways: as a claude.ai connector, or as a project server declared in',
      '  `.mcp.json`. A project entry SHADOWS the connector when both name the',
      '  same service, so which prefix your session has depends on that file.',
      '  Check your tool list and use whichever one is there.',
      '',
    )
  }
  lines.push(
    '  A shelled fetch stays right where no tool serves it, and the mentions',
    '  are already skipped: a URL inside a `git commit -m` or `gh --body`',
    '  value, a bare host with neither scheme nor path, and a host that only',
    '  starts with one of these (`notionfake.com`). So this fired on a real',
    '  reach.',
    '',
  )
  return lines.join('\n')
}

export const check: GuardCheck = (payload: ToolCallPayload): GuardResult => {
  const tool = payload?.tool_name
  if (tool === 'Bash') {
    const command = readCommand(payload)
    if (!command) {
      return undefined
    }
    const reaches = commandReachedServers(command)
    return reaches.length === 0 ? undefined : notify(formatServerNudge(reaches))
  }
  if (tool === 'WebFetch') {
    const url = payload?.tool_input?.url
    if (typeof url !== 'string' || url === '') {
      return undefined
    }
    const reaches = urlReachedServers(url)
    return reaches.length === 0 ? undefined : notify(formatServerNudge(reaches))
  }
  return undefined
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash', 'WebFetch'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
