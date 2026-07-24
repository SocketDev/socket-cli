#!/usr/bin/env node
/*
 * @file Cross-CLI PreToolUse hook — blocks edits to fleet-canonical files in a
 *   downstream fleet repo, the non-Claude analog of the Claude
 *   no-fleet-fork-guard. Codex and Kimi Code share ONE hook contract, so this
 *   single entrypoint serves both:
 *
 *   - Codex: a generated `.codex/hooks.json` PreToolUse `command` entry
 *     (scripts/fleet/mcp-config.mts).
 *   - Kimi: a `[[hooks]]` PreToolUse block in the user `config.toml`
 *     (scripts/fleet/setup/setup-kimi-user-config.mts). Both send the
 *     PreToolUse payload as JSON on stdin (`{ hook_event_name, tool_name,
 *     tool_input, cwd, transcript_path, ... }`) and read a decision from
 *     stdout. To deny, both want `{ hookSpecificOutput: { hookEventName:
 *     "PreToolUse", permissionDecision: "deny", permissionDecisionReason } }`;
 *     anything else (or exit 0 with no output) allows. Detection + the block
 *     decision are shared with every CLI via fleet-fork-detect — this file is
 *     only the stdin/stdout shim. Fails OPEN on any surprise (empty/malformed
 *     stdin, wrong event) so a hook bug can never wedge a session; the Claude
 *     guard's cascade + git-hooks remain the backstop. Both CLIs also treat a
 *     nonzero-exit / timeout as allow, and Codex additionally gates project
 *     hooks behind a one-time trust prompt.
 */

import process from 'node:process'

import { readStdin } from '../../../.claude/hooks/fleet/_shared/transcript.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import {
  extractEditedTargets,
  findBlockedTarget,
} from './fleet-fork-detect.mts'

/**
 * Render the PreToolUse deny decision for a blocked edit (Codex + Kimi share
 * this wire format).
 */
export function renderPreToolUseDeny(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  })
}

/**
 * Read the PreToolUse payload from stdin and, when it would write a
 * fleet-canonical file, print the deny decision. A no-op (allow) otherwise.
 */
export async function runPreToolUseHook(): Promise<void> {
  let raw = ''
  try {
    raw = await readStdin()
  } catch {
    return
  }
  if (!raw) {
    return
  }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }
  if (payload['hook_event_name'] !== 'PreToolUse') {
    return
  }
  const cwd = payload['cwd']
  if (typeof cwd !== 'string') {
    // Fail open — without a real cwd from the payload we can't safely
    // resolve the tool's relative paths (the hook process's own cwd is
    // not a trustworthy stand-in for the invoking agent's directory).
    return
  }
  const targets = extractEditedTargets({
    cwd,
    toolInput: payload['tool_input'],
    toolName:
      typeof payload['tool_name'] === 'string'
        ? payload['tool_name']
        : undefined,
  })
  if (!targets.length) {
    return
  }
  const transcriptPath =
    typeof payload['transcript_path'] === 'string'
      ? payload['transcript_path']
      : undefined
  const blocked = await findBlockedTarget({ targets, transcriptPath })
  if (!blocked) {
    return
  }
  process.stdout.write(`${renderPreToolUseDeny(blocked.message)}\n`)
}

if (isMainModule(import.meta.url)) {
  void runPreToolUseHook()
}
