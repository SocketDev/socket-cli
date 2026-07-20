#!/usr/bin/env node
// Claude Code PreToolUse hook — claude-code-action-lockdown-guard.
//
// Blocks an Edit/Write to a `.github/workflows/*.yml` file that wires
// `uses: anthropics/claude-code-action` on an UNTRUSTED trigger without the
// lockdown that keeps a prompt-injected issue/PR from steering the agent into
// secret exfiltration.
//
// Why: the Microsoft Security writeup (2026-06-05) on `claude-code-action`
// showed the dangerous shape — a workflow that (a) fires on attacker-controlled
// content (issue body, PR comment), (b) holds repo secrets in the runner
// (ANTHROPIC_API_KEY / GITHUB_TOKEN), and (c) gives the agent tools that reach
// the network. That is the "Agents Rule of Two" violated three ways at once. A
// prompt-injected issue then becomes a credential-exfiltration primitive.
//
// This hook enforces two mitigations on the at-risk workflow:
//
//   1. An explicit minimal `permissions:` block. Without one the job inherits
//      the broad default GITHUB_TOKEN scope. zizmor's `excessive-permissions`
//      catches this at CI time; this surfaces it at edit time.
//   2. The agent-surface lockdown `with:` inputs — `allowed_tools` +
//      `disallowed_tools` + a non-default permission mode — the same four-flag
//      discipline `locking-down-claude` requires for headless `claude`.
//
// Untrusted triggers: issues, issue_comment, pull_request_target, pull_request.
// A workflow gated only on push / workflow_dispatch / schedule processes no
// attacker input, so it is not blocked (it can still hold secrets — the Rule of
// Two needs only one leg gated, and "no untrusted input" is that leg).
//
// Bypass: `Allow claude-action-lockdown bypass` in a recent user turn.
//
// Exit codes: 0 — pass. 2 — block. Fails open on malformed payload.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow claude-action-lockdown bypass'

export function isWorkflowPath(filePath: string): boolean {
  return /\/\.github\/workflows\/[^/]+\.ya?ml$/.test(normalizePath(filePath))
}

// The action wiring. Matches `uses: anthropics/claude-code-action@<ref>` (any
// ref / version suffix).
const USES_ACTION_RE = /\buses\s*:\s*[^\n]*\banthropics\/claude-code-action\b/

// Untrusted trigger in the `on:` block (any of the four). Same three on-shapes
// pull-request-target-guard handles (scalar, array, mapping).
const UNTRUSTED_TRIGGER_RE =
  /^\s*on\s*:[\s\S]*?\b(?:issues|issue_comment|pull_request_target|pull_request)\b/m

// An explicit `permissions:` block anywhere (top-level or job-level).
const PERMISSIONS_RE = /^\s*permissions\s*:/m

// The lockdown `with:` inputs that pin the agent's surface. All three required:
// the allow/deny tool lists plus a permission mode that is not the default.
const ALLOWED_TOOLS_RE = /^\s*allowed_tools\s*:/m
const DISALLOWED_TOOLS_RE = /^\s*disallowed_tools\s*:/m
// `permission_mode` / `permission-mode` set to anything other than `default`.
const PERMISSION_MODE_RE =
  /^\s*permission[_-]mode\s*:\s*['"]?(?!default\b)[^\s'"]+/m

export interface LockdownGap {
  // Human-readable list of what the at-risk workflow is missing.
  missing: string[]
}

// Returns the lockdown gaps for a workflow body, or undefined when the hook
// does not apply (not a claude-code-action workflow, or no untrusted trigger).
export function findLockdownGaps(content: string): LockdownGap | undefined {
  if (!USES_ACTION_RE.test(content)) {
    return undefined
  }
  if (!UNTRUSTED_TRIGGER_RE.test(content)) {
    return undefined
  }
  const missing: string[] = []
  if (!PERMISSIONS_RE.test(content)) {
    missing.push('an explicit minimal `permissions:` block')
  }
  if (!ALLOWED_TOOLS_RE.test(content)) {
    missing.push('`allowed_tools:`')
  }
  if (!DISALLOWED_TOOLS_RE.test(content)) {
    missing.push('`disallowed_tools:`')
  }
  if (!PERMISSION_MODE_RE.test(content)) {
    missing.push('a non-default `permission_mode:`')
  }
  return missing.length ? { missing } : undefined
}

export const check = editGuard((filePath, content, payload) => {
  if (!isWorkflowPath(filePath) || !content) {
    return undefined
  }
  const gap = findLockdownGaps(content)
  if (!gap) {
    return undefined
  }
  const transcript = payload.transcript_path
  if (transcript && bypassPhrasePresent(transcript, [BYPASS_PHRASE], 3)) {
    return undefined
  }
  return block(
    [
      `[claude-code-action-lockdown-guard] Blocked: ${filePath}`,
      '',
      '  This workflow wires `anthropics/claude-code-action` on an untrusted',
      '  trigger (issues / issue_comment / pull_request / pull_request_target)',
      '  but is missing:',
      ...gap.missing.map(m => `    - ${m}`),
      '',
      '  A prompt-injected issue/PR can steer the agent into exfiltrating the',
      "  runner's secrets (the claude-code-action env-exfil incident, MSFT",
      '  2026-06-05). Pin the agent surface + scope the token, or gate the',
      '  trigger off untrusted input (push / workflow_dispatch / schedule).',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" in a recent message, then retry.`,
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['claude-action-lockdown'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
