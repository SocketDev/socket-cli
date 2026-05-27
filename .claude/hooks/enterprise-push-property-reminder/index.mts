#!/usr/bin/env node
// Claude Code PostToolUse hook — enterprise-push-property-reminder.
//
// After a Bash `git push` fails with the enterprise-ruleset error
// pattern, surface the canonical bypass: the repo's
// `temporarily-doesnt-touch-customers` custom property.
//
// Fleet context: some SocketDev repos sit under a Socket-enterprise
// ruleset on refs/heads/main that requires PRs + a specific Audit
// workflow. The escape hatch (per cascade convention in
// `socket-wheelhouse/scripts/_shared/repo-properties.mts`) is the
// per-repo custom property `temporarily-doesnt-touch-customers ===
// 'true'`. When set, `canSkipReviewGate()` returns true and direct
// push is allowed.
//
// This hook detects:
//   1. Bash tool calls
//   2. Containing `git push` (or `git push --no-verify`, etc.)
//   3. Whose output contains the enterprise ruleset rejection pattern
//
// On match, it writes a stderr reminder to Claude with:
//   - The property name + required value (`"true"` literal string)
//   - The current value of that property (via `gh api`)
//   - A link to docs/claude.md/fleet/push-policy.md
//
// The hook does NOT modify the property or retry the push — the
// operator decides whether the bypass is appropriate.
//
// PostToolUse, not PreToolUse: we react to the rejection, we don't
// try to predict it. Server-side rulesets are the ground truth.
//
// Fail-open on hook bugs: exit 0 + silent log so a bad deploy
// can't suppress legitimate push errors.

import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { findInvocation } from '../_shared/shell-command.mts'

interface Payload {
  readonly hook_event_name?: string | undefined
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly command?: string | undefined } | undefined
  readonly tool_response?: unknown | undefined
}

// Patterns that identify the enterprise-ruleset rejection. Both must
// be present in the push output to fire — we don't want false
// positives from generic push failures (auth, conflict, etc.).
const RULESET_ERROR_PATTERNS: readonly RegExp[] = [
  /Repository rule violations found/,
  /Changes must be made through a pull request/,
]

// Detects `git push` invocations via the shell parser (sees through
// chains / `$(…)`; ignores a quoted "git push" in a message). The hook
// scopes to push commands only — pulls/fetches/commits don't trip the
// enterprise ruleset.
function isGitPush(command: string): boolean {
  return findInvocation(command, { binary: 'git', subcommand: 'push' })
}

// Read the tool_response into a string for pattern matching. Bash's
// tool_response shape is typically `{ stdout: string, stderr: string,
// interrupted: boolean, isImage: boolean }` but harness variants may
// pass it as a bare string. Walk both shapes.
export function extractOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const parts: string[] = []
    for (const key of ['stdout', 'stderr', 'output', 'content']) {
      const v = obj[key]
      if (typeof v === 'string') {
        parts.push(v)
      }
    }
    return parts.join('\n')
  }
  return ''
}

export function isEnterpriseRulesetFailure(output: string): boolean {
  for (let i = 0, { length } = RULESET_ERROR_PATTERNS; i < length; i += 1) {
    if (!RULESET_ERROR_PATTERNS[i]!.test(output)) {
      return false
    }
  }
  return true
}

// Read `owner/repo` from the current `git remote get-url origin`
// output. Returns undefined if the URL isn't a recognized
// SSH/HTTPS GitHub shape — the hook just won't surface the
// per-repo property state in that case.
export function getCurrentRepoSlug(): string | undefined {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], {
    encoding: 'utf8',
    timeout: 2_000,
  })
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return undefined
  }
  const url = r.stdout.trim()
  // SSH form: git@github.com:owner/repo.git
  // HTTPS form: https://github.com/owner/repo(.git)?
  const sshMatch = /git@github\.com:([^/]+)\/([^/.]+)/.exec(url)
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`
  }
  const httpsMatch = /github\.com\/([^/]+)\/([^/.]+)/.exec(url)
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`
  }
  return undefined
}

// Query the current state of the `temporarily-doesnt-touch-customers`
// property via `gh api`. Returns the value string or undefined on
// any failure (no auth, API blocked by firewall, property not set,
// etc.). The reminder treats undefined as "unknown, instruct the
// operator to set it explicitly".
export function getPropertyValue(
  slug: string,
  propertyName: string,
): string | undefined {
  const r = spawnSync(
    'gh',
    [
      'api',
      `repos/${slug}/properties/values`,
      '--jq',
      `.[] | select(.property_name == "${propertyName}") | .value`,
    ],
    {
      encoding: 'utf8',
      timeout: 5_000,
    },
  )
  if (r.status !== 0) {
    return undefined
  }
  const value = String(r.stdout ?? '').trim()
  return value.length > 0 ? value : undefined
}

export function formatReminder(
  slug: string | undefined,
  currentValue: string | undefined,
): string {
  const lines: string[] = []
  lines.push('')
  lines.push('🚨 enterprise-push-property-reminder')
  lines.push('')
  lines.push('The `git push` was rejected by the Socket enterprise ruleset on')
  lines.push('refs/heads/main:')
  lines.push('')
  lines.push('  - Required workflow ... is not satisfied')
  lines.push('  - Changes must be made through a pull request')
  lines.push('')
  lines.push('Canonical bypass for routine cascade work: set the repo')
  lines.push(
    '`temporarily-doesnt-touch-customers` custom property to the LITERAL',
  )
  lines.push('string `"true"` (not `true`, not `True`).')
  if (slug) {
    lines.push('')
    lines.push(`Repo: ${slug}`)
    if (currentValue === undefined) {
      lines.push('  current value: <unset or unreadable via gh api>')
    } else {
      lines.push(`  current value: "${currentValue}"`)
    }
    lines.push(`  GitHub UI: https://github.com/${slug}/settings/properties`)
  }
  lines.push('')
  lines.push('After flipping the property:')
  lines.push('  git push origin main')
  lines.push('')
  lines.push(
    'After the in-flight remediation window closes, flip it back to "false"',
  )
  lines.push('(re-engages the ruleset).')
  lines.push('')
  lines.push(
    'Full rationale: docs/claude.md/fleet/push-policy.md (Enterprise-ruleset',
  )
  lines.push('escape hatch section).')
  lines.push('')
  return lines.join('\n')
}

async function readStdin(): Promise<string> {
  let raw = ''
  for await (const chunk of process.stdin) {
    raw += chunk
  }
  return raw
}

async function main(): Promise<void> {
  let raw: string
  try {
    raw = await readStdin()
  } catch {
    process.exit(0)
  }
  if (!raw) {
    process.exit(0)
  }
  let payload: Payload
  try {
    payload = JSON.parse(raw) as Payload
  } catch {
    process.exit(0)
  }
  if (payload.hook_event_name !== 'PostToolUse') {
    process.exit(0)
  }
  if (payload.tool_name !== 'Bash') {
    process.exit(0)
  }
  const command = payload.tool_input?.command
  if (typeof command !== 'string' || !isGitPush(command)) {
    process.exit(0)
  }
  const output = extractOutput(payload.tool_response)
  if (!isEnterpriseRulesetFailure(output)) {
    process.exit(0)
  }
  const slug = getCurrentRepoSlug()
  const currentValue = slug
    ? getPropertyValue(slug, 'temporarily-doesnt-touch-customers')
    : undefined
  process.stderr.write(formatReminder(slug, currentValue))
  // Exit 0 — informational only. The push already failed; we're
  // just adding context for the next assistant turn.
  process.exit(0)
}

main().catch(() => {
  // Fail-open.
  process.exit(0)
})
