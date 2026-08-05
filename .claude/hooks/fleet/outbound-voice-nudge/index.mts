#!/usr/bin/env node
// Claude Code PreToolUse hook — outbound-voice-nudge.
//
// Scans prose on its way OUT of the session for off-voice phrasing: the owner's
// banned words ("pinned", "seam") and the AI tells that survive a slop pass
// ("in today's fast-paced", "it's important to note", "rest assured", "I hope
// this helps"). The catalog is `_shared/outbound-voice.mts` — one source, so a
// phrase flagged on GitHub is flagged in Linear too.
//
// Surfaces, and who else already watches them:
//   • GitHub via `gh` — PR/issue bodies + titles, comments, reviews, release
//     notes, `gh api` body/title fields, and `--body-file` payloads. The shared
//     slop set is ALREADY reported here by convo-prose-nudge, so this hook adds
//     only the voice catalog on this surface. Two hooks printing the same hit is
//     noise, and noise is how a nudge earns being ignored.
//   • Linear / Notion / Slack via MCP — issue descriptions, comments, page
//     content, chat messages. NOTHING watched these before this hook, so here it
//     runs the voice catalog AND the shared canonical slop set
//     (`findUncoveredProseSlop`).
//
// REMINDER (exit 0 + stderr), never a block: voice is a judgment call and a
// false positive must cost a glance, not a retry. `-nudge` per fleet convention.
//
// Wired at two tiers. Repo-level: `matcher: ['Bash', 'mcp__.*']` routes both
// tool families through the dispatcher (the settings.json feed gate is the `.*`
// catch-all, so MCP tool calls already arrive). Machine-level: `global: true`
// installs it into `~/.claude/settings.json` via
// `scripts/repo/setup/user-global-settings.mts`, so it fires from EVERY repo
// session, not just fleet-managed ones. `scope` is deliberately OMITTED — the
// owner's voice is not a fleet-repo convention that stands down elsewhere.
//
// A parse failure or an unreadable body exits 0 silently (fail-open — a nudge
// must never block on its own bug).

import type { ToolCallPayload } from '../_shared/payload.mts'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import { extractBodyArg } from '../convo-prose-nudge/index.mts'
import { extractProse } from '../no-github-ai-attribution-guard/index.mts'
import {
  findUncoveredProseSlop,
  findVoiceSlop,
} from '../_shared/outbound-voice.mts'
import type { VoiceSlopHit } from '../_shared/outbound-voice.mts'
import { readCommand } from '../_shared/payload.mts'
import { commandsFor } from '../_shared/shell-command.mts'

// Dispatcher pre-flight: a `gh` invocation carries the substring `gh`; every MCP
// tool call carries `mcp__` in its tool_name. A payload with neither cannot
// match, so the dispatcher skips this hook.
export const triggers: readonly string[] = ['gh', 'mcp__']

// The MCP tools that POST prose to a human. Matched on a substring of the tool
// name, not the whole name: the server segment varies by install
// (`mcp__claude_ai_Notion__…` vs `mcp__Notion__…`), so pinning the full name
// would silently stop matching on another machine. READ tools are deliberately
// excluded — a `list_issues(query: "pinned")` is a search term, not outbound
// prose, and flagging it would be pure noise.
const OUTBOUND_MCP_RES: readonly RegExp[] = [
  // Linear writes: save_comment, save_issue, save_document, save_project,
  // save_status_update, save_release_note, save_diff_comment, …
  /linear[^_]*__save_/i,
  // Notion writes: notion-create-comment, notion-create-pages,
  // notion-update-page, …
  /notion__notion-(?:create|update)-/i,
  // Slack writes: slack_create_canvas, slack_schedule_message,
  // slack_send_message, slack_send_message_draft, slack_update_canvas.
  /slack__slack_(?:create_canvas|schedule|send|update_canvas)/i,
]

// Object keys whose value is human-facing prose. The MCP input shape varies per
// server (Linear puts a body under `description`, Slack under `text`, Notion
// nests page content), so the walk selects by KEY NAME at any depth rather than
// pinning one server's schema.
const PROSE_KEYS: ReadonlySet<string> = new Set([
  'body',
  'comment',
  'content',
  'description',
  'markdown',
  'message',
  'summary',
  'text',
  'title',
])

// Depth cap for the input walk. Deep enough for Notion's `pages[].content`,
// shallow enough that a hostile or cyclic payload cannot spin the hook.
const MAX_WALK_DEPTH = 6

/**
 * True when an MCP tool name is one that posts prose to a human.
 */
export function isOutboundMcpTool(toolName: string): boolean {
  for (let i = 0, { length } = OUTBOUND_MCP_RES; i < length; i += 1) {
    if (OUTBOUND_MCP_RES[i]!.test(toolName)) {
      return true
    }
  }
  return false
}

/**
 * Where the walk currently is: how deep, and whether an ancestor key was a
 * prose key. An ancestor prose key is what makes a string at this position
 * count as prose.
 */
interface WalkPosition {
  readonly depth: number
  readonly underProseKey: boolean
}

/**
 * Collect every prose-keyed string in `value`, walking nested objects and
 * arrays to `MAX_WALK_DEPTH`. A string directly under a prose key counts; so
 * does one inside an array or object held by a prose key (Notion's
 * `pages: [{ content }]`).
 */
function collectProseStrings(
  value: unknown,
  out: string[],
  position: WalkPosition,
): void {
  const { depth, underProseKey } = position
  if (depth > MAX_WALK_DEPTH) {
    return
  }
  if (typeof value === 'string') {
    if (underProseKey) {
      out.push(value)
    }
    return
  }
  if (Array.isArray(value)) {
    for (let i = 0, { length } = value; i < length; i += 1) {
      collectProseStrings(value[i], out, { depth: depth + 1, underProseKey })
    }
    return
  }
  if (value === null || typeof value !== 'object') {
    return
  }
  const entryList = Object.entries(value as Record<string, unknown>)
  for (let i = 0, { length } = entryList; i < length; i += 1) {
    const entry = entryList[i]!
    collectProseStrings(entry[1], out, {
      depth: depth + 1,
      underProseKey: underProseKey || PROSE_KEYS.has(entry[0]),
    })
  }
}

/**
 * The prose an outbound MCP tool call would post. Returns '' for a read tool, a
 * non-object input, or an input carrying no prose-keyed string.
 */
export function extractMcpVoiceProse(payload: ToolCallPayload): string {
  const toolName = payload?.tool_name
  if (typeof toolName !== 'string' || !isOutboundMcpTool(toolName)) {
    return ''
  }
  const out: string[] = []
  collectProseStrings(payload.tool_input, out, {
    depth: 0,
    underProseKey: false,
  })
  return out.join('\n')
}

/**
 * The prose a `gh` command would post. `extractProse` (the AI-attribution
 * guard's, shared rather than restated) covers the inline body / title / notes
 * flags and `gh api` fields; `extractBodyArg` (convo-prose-nudge's) adds the
 * `--body-file` / `-F` file contents, which `extractProse` deliberately leaves
 * alone. A term appearing in both halves still reports once — the catalog
 * yields one hit per pattern, not per occurrence.
 */
export function extractGhVoiceProse(command: string): string {
  const parts: string[] = [extractProse(command)]
  const ghCmds = commandsFor(command, 'gh')
  for (let i = 0, { length } = ghCmds; i < length; i += 1) {
    const body = extractBodyArg(ghCmds[i]!)
    if (body) {
      parts.push(body)
    }
  }
  return parts.filter(Boolean).join('\n')
}

/**
 * Render the operator-facing reminder for a set of hits.
 */
export function renderVoiceNudge(
  surface: string,
  hits: readonly VoiceSlopHit[],
): string {
  const banned = hits.filter(h => h.kind === 'banned-word')
  const tells = hits.filter(h => h.kind === 'ai-tell')
  const lines = [
    '[outbound-voice-nudge]',
    `Off-voice prose headed for ${surface}:`,
    '',
  ]
  if (banned.length > 0) {
    lines.push('BANNED — a match here is a verdict, not a heuristic:')
    for (let i = 0, { length } = banned; i < length; i += 1) {
      const hit = banned[i]!
      lines.push(`  • ${hit.term} — ${hit.why}`)
    }
    lines.push('')
  }
  if (tells.length > 0) {
    lines.push('Reads machine-written:')
    for (let i = 0, { length } = tells; i < length; i += 1) {
      const hit = tells[i]!
      lines.push(`  • ${hit.term} — ${hit.why}`)
    }
    lines.push('')
  }
  lines.push(
    'Rewrite point-first and receipts-first: lead with the outcome, name the',
    'evidence, drop the hedge-labels. The prose skill is the correction path:',
    '  .claude/skills/fleet/prose/SKILL.md',
    '  .claude/skills/fleet/prose/references/conversational.md',
    '',
  )
  return lines.join('\n')
}

export const check = (
  payload: ToolCallPayload,
): ReturnType<typeof notify> | undefined => {
  const toolName = payload?.tool_name
  let prose = ''
  let surface = ''
  // The shared canonical slop set runs only where no other hook reports it.
  let alreadyCovered = true
  if (toolName === 'Bash') {
    const command = readCommand(payload)
    if (command) {
      prose = extractGhVoiceProse(command)
      surface =
        'a GitHub prose surface (PR/issue body or title, comment, review, ' +
        'release notes, or gist)'
    }
  } else if (typeof toolName === 'string' && toolName.startsWith('mcp__')) {
    prose = extractMcpVoiceProse(payload)
    surface = 'an external prose surface (Linear, Notion, or Slack)'
    alreadyCovered = false
  }
  if (!prose) {
    return undefined
  }
  const hits = alreadyCovered
    ? findVoiceSlop(prose)
    : [...findVoiceSlop(prose), ...findUncoveredProseSlop(prose)]
  if (hits.length === 0) {
    return undefined
  }
  return notify(renderVoiceNudge(surface, hits))
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  global: true,
  matcher: ['Bash', 'mcp__.*'],
  triggers,
  type: 'nudge',
})

void runHook(hook, import.meta.url)
