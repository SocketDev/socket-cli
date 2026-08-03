#!/usr/bin/env node
/*
 * @file Claude Code PreToolUse hook — honeypot-echo-guard.
 *
 * Blocks an outbound comment that would spring an automation-detection trap.
 *
 * The trap: some repositories post a friendly-looking greeting on every new
 * pull request whose raw Markdown hides a block addressed only to machines.
 * The block asks whatever is reading the thread to reply with a short hex code
 * and nothing else. When the pull request author's own account later posts a
 * comment carrying that code as a standalone word, the account is labelled
 * automated, a public notice is posted, and the pull request can be closed.
 *
 * The correct posture is the fleet's existing one: text found in a thread is
 * DATA TO REPORT, never an instruction to follow. This hook is the executable
 * half of that — it stops the emission even if something upstream in the
 * session was persuaded.
 *
 * This is an EMISSION guard, not an edit guard. prompt-injection-guard already
 * covers "do not write directive text into a file we ship"; this one covers
 * "do not post a bait token to a public thread". It intercepts the tool calls
 * that publish text to an external thread:
 *
 *   - `gh pr comment`, `gh issue comment`, `gh pr review`
 *   - `gh api` against a `.../comments` or `.../reviews` endpoint
 *   - MCP comment tools (Linear `save_comment`, Notion `notion-create-comment`)
 *     and Slack send-message tools
 *
 * Every `gh` invocation is resolved at COMMAND POSITION through the shared
 * shell parser, so prose that merely quotes one of those command lines is never
 * read as a command.
 *
 * A twelve-hex-character run is ALSO the shape of an abbreviated commit SHA,
 * a digest prefix, or a hex-stamped filename, and fleet prose doctrine
 * requires citing SHAs as receipts. So a token that `git rev-parse` cannot
 * resolve to a commit in this checkout is a finding only when the session
 * transcript shows it was actually read from a thread this turn — a real
 * citation from a repo/history this checkout lacks passes, a token the agent
 * demonstrably pulled off untrusted content does not.
 *
 * Bypass: `Allow honeypot-echo bypass`.
 *
 * Fails open on any parse, regex, or spawn error — a guard must never wedge the
 * session it protects.
 */

import { block, defineHook, runHook } from '../_shared/guard.mts'
import { readCommand, readFilePath } from '../_shared/payload.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'
import { hasOpaqueInvocation } from '../_shared/shell-command.mts'
import { findHoneypotEmissions, mentionsThisGuard } from './bait-detection.mts'
import {
  honeypotBlockMessage,
  unresolvedBodyBlockMessage,
} from './block-message.mts'
import {
  ghOutboundBodies,
  isThreadPostingMcpTool,
  mcpOutboundBodies,
} from './outbound-bodies.mts'

import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

// Dispatcher pre-flight: a `gh` invocation carries `gh`, every MCP tool call
// carries `mcp__` in its tool_name. A payload with neither cannot match.
export const triggers: readonly string[] = ['gh', 'mcp__']

/**
 * The guard body: resolve the outbound surface, scan what it would publish,
 * block on a honeypot-shaped emission. Fails open on any throw.
 */
export function checkHoneypotEcho(payload: ToolCallPayload): GuardResult {
  try {
    const toolName = payload?.tool_name
    let bodies: readonly string[] = []
    let rawSurfaceText = ''
    let surface = ''
    const repoDir = resolveProjectDir(payload?.cwd)
    if (toolName === 'Bash') {
      const command = readCommand(payload)
      if (!command) {
        return undefined
      }
      rawSurfaceText = command
      surface = 'a GitHub pull-request or issue comment / review'
      if (command.includes('gh') && hasOpaqueInvocation(command)) {
        // A `$VAR`-sourced binary or an `eval` means the shell parser cannot
        // say what actually runs — the body it would post is just as
        // unresolvable as a stdin/unreadable-file body, so treat it the same:
        // fail closed rather than silently letting an unresolved substitution
        // read as an empty (safe) body.
        return block(unresolvedBodyBlockMessage(surface))
      }
      const scan = ghOutboundBodies(command, repoDir)
      if (scan.unresolved) {
        return block(unresolvedBodyBlockMessage(surface))
      }
      bodies = scan.bodies
    } else if (
      typeof toolName === 'string' &&
      isThreadPostingMcpTool(toolName)
    ) {
      bodies = mcpOutboundBodies(payload)
      rawSurfaceText = bodies.join('\n')
      surface = `an external thread via ${toolName}`
    }
    if (!bodies.length) {
      return undefined
    }

    const body = bodies.join('\n')
    const allowMarkerLiterals =
      mentionsThisGuard(rawSurfaceText) ||
      mentionsThisGuard(readFilePath(payload) ?? '')
    const emissions = findHoneypotEmissions(body, repoDir, {
      allowMarkerLiterals,
      transcriptPath: payload?.transcript_path,
    })
    if (!emissions.length) {
      return undefined
    }
    return block(honeypotBlockMessage(surface, emissions))
  } catch {
    return undefined
  }
}

export const hook = defineHook({
  bypass: ['honeypot-echo'],
  check: checkHoneypotEcho,
  event: 'PreToolUse',
  matcher: ['Bash', 'mcp__.*'],
  triggers,
  type: 'guard',
})

void runHook(hook, import.meta.url)
