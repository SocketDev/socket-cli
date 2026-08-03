/*
 * @file Body extraction for `honeypot-echo-guard` — the text an outbound call
 *   would actually publish, recovered from the two surfaces that publish it.
 *
 *   On the `gh` surface, every invocation is resolved at COMMAND POSITION
 *   through the shared shell parser, so prose that merely quotes a `gh` command
 *   line is never read as a command. A body can arrive inline (`--body`), from
 *   a file (`--body-file`, `-F`, `--input`, `key=@path`), or inside a `gh api`
 *   field value, and a body this guard cannot statically read is reported as
 *   UNRESOLVED rather than as an empty (safe) body.
 *
 *   On the MCP surface, field names vary per server, so every string value in
 *   the tool input is collected — including one nested inside an object or
 *   array (Notion `rich_text`, Slack `blocks`) — under depth and byte caps.
 */

import path from 'node:path'

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  ghApiPositionals,
  ghPositionalArgs,
  hasGhSubcommand,
  isGhThreadEndpoint,
} from '../_shared/gh-invocation.mts'
import { collectNestedStrings } from '../_shared/nested-strings.mts'
import { commandsFor } from '../_shared/shell-command.mts'

import type { ToolCallPayload } from '../_shared/payload.mts'

// `gh <noun> <verb>` pairs that post prose to a thread.
const GH_COMMENT_VERBS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['issue', new Set(['comment'])],
  ['pr', new Set(['comment', 'review'])],
])

// Flags whose value is the outbound body.
const BODY_FLAGS: ReadonlySet<string> = new Set(['--body', '--body-text', '-b'])

// Flags whose value is a PATH to the file carrying the outbound body — only
// on a `pr`/`issue` comment or `pr review` invocation. `-F` means something
// else on `gh api` (see API_FIELD_FLAGS) — the two never overlap because
// each is only read for its own invocation shape. `-` names stdin, which
// this guard cannot read, so that value is UNRESOLVED rather than empty.
const BODY_FILE_FLAGS: ReadonlySet<string> = new Set(['--body-file', '-F'])

// The stdin marker `gh`'s own `--body-file`/`--input` flags accept in place
// of a path.
const STDIN_MARKER = '-'

// `gh api` field flags — the value is a `body=…` key/value string, and a
// `body=@path` value sources it from a file instead of the literal.
const API_FIELD_FLAGS: ReadonlySet<string> = new Set([
  '--field',
  '--raw-field',
  '-F',
  '-f',
])

// MCP tools that publish a comment or a chat message to an external thread.
const MCP_COMMENT_TOOLS: ReadonlySet<string> = new Set([
  'mcp__claude_ai_Linear__save_comment',
  'mcp__claude_ai_Linear__save_diff_comment',
  'mcp__linear__save_comment',
  'mcp__linear__save_diff_comment',
  'mcp__notion__notion-create-comment',
])

// Depth and byte caps on the nested-value walk in mcpOutboundBodies — a
// pathological or hostile tool_input payload must not wedge this hook.
const MCP_BODY_WALK_MAX_DEPTH = 6
const MCP_BODY_WALK_MAX_BYTES = 256 * 1024

/**
 * Every outbound body a `gh` command line would post, plus whether the scan
 * had to give up on resolving one. A body sourced from a file (`--body-file`,
 * `-F`, a `key=@path` field, or `gh api --input`) is read from disk; stdin
 * (`-`) or an unreadable file leaves the body UNKNOWABLE, and `unresolved`
 * tells the caller to fail closed rather than treat that as an empty (safe)
 * body.
 */
export interface OutboundBodyScan {
  readonly bodies: readonly string[]
  readonly unresolved: boolean
}

/**
 * True when this parsed `gh` invocation publishes to a thread.
 */
export function isThreadPostingGhInvocation(args: readonly string[]): boolean {
  const positional = ghPositionalArgs(args)
  if (hasGhSubcommand(positional, GH_COMMENT_VERBS)) {
    return true
  }
  const rest = ghApiPositionals(positional)
  if (rest === undefined) {
    return false
  }
  // `gh api graphql` carries an arbitrary mutation, including addComment, in
  // its field values rather than an endpoint path — no path to pattern-match,
  // so any graphql call is treated as thread-posting and its fields scanned.
  if (rest[0] === 'graphql') {
    return true
  }
  return rest.some(isGhThreadEndpoint)
}

/**
 * True when this parsed `gh` invocation is a `gh api graphql` call.
 */
function isGraphqlInvocation(positional: readonly string[]): boolean {
  return ghApiPositionals(positional)?.[0] === 'graphql'
}

/**
 * Read the body a `--body-file` / `-F` / `key=@path` / `--input` value names.
 * Returns undefined for the stdin marker or an unreadable path — both cases
 * this guard cannot statically resolve.
 */
function readOutboundBodyFile(
  cwd: string,
  rawPath: string,
): string | undefined {
  if (rawPath === STDIN_MARKER) {
    return undefined
  }
  const resolved = normalizePath(
    path.isAbsolute(rawPath) ? rawPath : path.join(cwd, rawPath),
  )
  return safeReadFileSync(resolved)
}

/**
 * Every outbound body a `gh` command line would post. Parsed at command
 * position through the shared shell parser, so quoting, `&&` chains, and
 * command substitution are handled and prose is never read as a command.
 */
export function ghOutboundBodies(
  command: string,
  cwd: string,
): OutboundBodyScan {
  const bodies: string[] = []
  let unresolved = false
  for (const cmd of commandsFor(command, 'gh')) {
    const { args } = cmd
    if (!isThreadPostingGhInvocation(args)) {
      continue
    }
    const positional = ghPositionalArgs(args)
    const isCommentInvocation = hasGhSubcommand(positional, GH_COMMENT_VERBS)
    const isGraphql = isGraphqlInvocation(positional)
    for (let i = 0, { length } = args; i < length; i += 1) {
      const arg = args[i]!
      if (BODY_FLAGS.has(arg)) {
        const value = args[i + 1]
        if (value === '') {
          // An empty-string value here almost always means the shell
          // collapsed an unresolved substitution (`--body "$T"` with `$T`
          // unset or opaque to the parser) rather than a genuinely empty
          // comment — unknowable, not safe, so fail closed.
          unresolved = true
        } else if (value !== undefined) {
          bodies.push(value)
        }
        continue
      }
      const eq = arg.indexOf('=')
      if (eq > 0 && BODY_FLAGS.has(arg.slice(0, eq))) {
        const value = arg.slice(eq + 1)
        if (value === '') {
          unresolved = true
        } else {
          bodies.push(value)
        }
        continue
      }
      if (isCommentInvocation && BODY_FILE_FLAGS.has(arg)) {
        const value = args[i + 1]
        if (value === undefined) {
          continue
        }
        const content = readOutboundBodyFile(cwd, value)
        if (content === undefined) {
          unresolved = true
        } else {
          bodies.push(content)
        }
        continue
      }
      if (arg === '--input') {
        const value = args[i + 1]
        if (value === undefined) {
          continue
        }
        const content = readOutboundBodyFile(cwd, value)
        if (content === undefined) {
          unresolved = true
        } else {
          bodies.push(content)
        }
        continue
      }
      if (!isCommentInvocation && API_FIELD_FLAGS.has(arg)) {
        const value = args[i + 1]
        if (value === undefined) {
          continue
        }
        // A graphql call carries its mutation, including addComment's body,
        // inside the FULL value of any field flag (`-f query='mutation {…}'`)
        // — not only a `body=` key — so scan the whole value rather than
        // requiring that one key name.
        const fieldValue = isGraphql
          ? value.slice(value.indexOf('=') + 1)
          : value.startsWith('body=')
            ? value.slice('body='.length)
            : undefined
        if (fieldValue === undefined) {
          continue
        }
        if (fieldValue.startsWith('@')) {
          const content = readOutboundBodyFile(cwd, fieldValue.slice(1))
          if (content === undefined) {
            unresolved = true
          } else {
            bodies.push(content)
          }
        } else {
          bodies.push(fieldValue)
        }
      }
    }
  }
  return { bodies, unresolved }
}

/**
 * True when an MCP tool name publishes a comment or a chat message.
 */
export function isThreadPostingMcpTool(toolName: string): boolean {
  if (MCP_COMMENT_TOOLS.has(toolName)) {
    return true
  }
  const lower = toolName.toLowerCase()
  return lower.includes('slack') && lower.includes('send_message')
}

/**
 * Every string field an MCP tool call carries, including one nested inside an
 * object or array value (Notion `rich_text`, Slack `blocks`). Field names vary
 * per server, so scan all string values rather than pinning a key.
 */
export function mcpOutboundBodies(payload: ToolCallPayload): string[] {
  const input = payload?.tool_input
  if (!input || typeof input !== 'object') {
    return []
  }
  return collectNestedStrings(input, {
    maxBytes: MCP_BODY_WALK_MAX_BYTES,
    maxDepth: MCP_BODY_WALK_MAX_DEPTH,
  })
}
