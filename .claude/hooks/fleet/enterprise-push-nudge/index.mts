#!/usr/bin/env node
// Claude Code PostToolUse hook — enterprise-push-nudge.
//
// After a Bash `git push` fails with an enterprise-ruleset rejection,
// surface the canonical bypass for EACH violated rule. The ruleset on
// refs/heads/main enforces two rules a direct push can trip, and each
// has its OWN custom-property escape hatch:
//
//   - "Changes must be made through a pull request"
//       → `temporarily-doesnt-touch-customers` = "true" (per cascade
//         convention in `scripts/_shared/repo-properties.mts`;
//         `canSkipReviewGate()` reads it).
//   - "Required workflow ... is not satisfied" (the zizmor Audit GHA
//     Workflows check)
//       → `disable-github-actions-security` = "true".
//
// A push can trip EITHER or BOTH — setting only the touch-customers
// property leaves a workflow-rule rejection unfixed (this is exactly
// what left a direct push blocked until the second property was set).
//
// This hook detects:
//   1. Bash tool calls
//   2. Containing `git push` (or `git push --no-verify`, etc.)
//   3. Whose output is an enterprise ruleset rejection (header line +
//      at least one of the two specific rules)
//
// On match, it writes a stderr reminder to Claude with, per violated rule:
//   - The property name + required value (`"true"` literal string)
//   - The current value of that property (via `gh api`)
//   - A link to docs/agents.md/fleet/push-policy.md
//
// The hook does NOT modify the property or retry the push — the
// operator decides whether the bypass is appropriate.
//
// PostToolUse, not PreToolUse: we react to the rejection, we don't
// try to predict it. Server-side rulesets are the ground truth.
//
// Fail-open on hook bugs: notify (never blocks) so a bad deploy
// can't suppress legitimate push errors.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { findInvocation } from '../_shared/shell-command.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'

// The enterprise-ruleset rejection = the header line PLUS at least one of the
// two specific rules. Requiring the header avoids false positives from generic
// push failures (auth, conflict, etc.); allowing EITHER specific rule means a
// workflow-only rejection fires too (a bare header never does).
const RULESET_HEADER = /Repository rule violations found/
const PR_RULE = /Changes must be made through a pull request/
const WORKFLOW_RULE = /Required workflow .* is not satisfied/

// The escape properties, one per rule the push may trip.
export const PR_ESCAPE_PROPERTY = 'temporarily-doesnt-touch-customers'
export const WORKFLOW_ESCAPE_PROPERTY = 'disable-github-actions-security'

// Which enterprise-ruleset rules a push output tripped.
export interface RulesetRejection {
  readonly pr: boolean
  readonly workflow: boolean
}

// One violated rule + the custom property that clears it.
export interface EscapeProperty {
  readonly name: string
  readonly rule: string
  readonly value: string | undefined
}

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

// Which rules the push tripped, or undefined when the output isn't an
// enterprise-ruleset rejection (no header, or header with no specific rule).
export function rulesetRejection(output: string): RulesetRejection | undefined {
  if (!RULESET_HEADER.test(output)) {
    return undefined
  }
  const pr = PR_RULE.test(output)
  const workflow = WORKFLOW_RULE.test(output)
  if (!pr && !workflow) {
    return undefined
  }
  return { pr, workflow }
}

export function isEnterpriseRulesetFailure(output: string): boolean {
  return rulesetRejection(output) !== undefined
}

// Parse `owner/repo` from a GitHub remote URL string.
// SSH form: git@github.com:owner/repo.git
// HTTPS form: https://github.com/owner/repo(.git)?
// Returns undefined when the URL isn't a recognised GitHub shape.
export function parseGitHubSlug(url: string): string | undefined {
  const sshMatch = /git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/.]+)/.exec(url)
  if (sshMatch) {
    return `${sshMatch.groups!.owner}/${sshMatch.groups!.repo}`
  }
  const httpsMatch = /github\.com\/(?<owner>[^/]+)\/(?<repo>[^/.]+)/.exec(url)
  if (httpsMatch) {
    return `${httpsMatch.groups!.owner}/${httpsMatch.groups!.repo}`
  }
  return undefined
}

// Read `owner/repo` from the current `git remote get-url origin`
// output. Returns undefined if the URL isn't a recognized
// SSH/HTTPS GitHub shape — the hook just won't surface the
// per-repo property state in that case.
export function getCurrentRepoSlug(): string | undefined {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], {
    encoding: 'utf8',
    timeout: spawnTimeoutMs(2000),
  })
  /* c8 ignore start - git failure requires a broken environment */
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return undefined
  }
  /* c8 ignore stop */
  return parseGitHubSlug(r.stdout.trim())
}

// Query the current value of a named custom property via `gh api`. Returns
// the value string or undefined on any failure (no auth, API blocked by
// firewall, property not set, etc.). The reminder treats undefined as
// "unknown, instruct the operator to set it explicitly".
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
      // win-timeout: network — bounded `gh api` call; keep it fixed, don't scale by platform.
      timeout: 5000,
    },
  )
  /* c8 ignore start - gh auth failure in test env always exits non-zero */
  if (r.status !== 0) {
    return undefined
  }
  const value = String(r.stdout ?? '').trim()
  return value.length > 0 ? value : undefined
  /* c8 ignore stop */
}

export function formatReminder(
  slug: string | undefined,
  escapes: readonly EscapeProperty[],
): string {
  const lines: string[] = []
  lines.push('')
  lines.push('🚨 enterprise-push-nudge')
  lines.push('')
  lines.push('The `git push` was rejected by the Socket enterprise ruleset on')
  lines.push('refs/heads/main. Each violated rule has its own custom-property')
  lines.push('escape hatch — set the value to the LITERAL string `"true"`')
  lines.push('(not `true`, not `True`):')
  for (let i = 0, { length } = escapes; i < length; i += 1) {
    const e = escapes[i]!
    lines.push('')
    lines.push(`  - ${e.rule}`)
    lines.push(`      → set \`${e.name}\` = "true"`)
    if (slug) {
      lines.push(
        `      current value: ${e.value === undefined ? '<unset or unreadable via gh api>' : `"${e.value}"`}`,
      )
    }
  }
  if (slug) {
    lines.push('')
    lines.push(`Repo: ${slug}`)
    lines.push(`  GitHub UI: https://github.com/${slug}/settings/properties`)
  }
  lines.push('')
  lines.push('After flipping the propert(ies):')
  lines.push('  git push origin main')
  lines.push('')
  lines.push(
    'Flip a `temporarily-*` property back to "false" once the remediation',
  )
  lines.push('window closes (re-engages the ruleset).')
  lines.push('')
  lines.push(
    'Full rationale: docs/agents.md/fleet/push-policy.md (Enterprise-ruleset',
  )
  lines.push('escape hatch section).')
  lines.push('')
  return lines.join('\n')
}

export const check = bashGuard((command, payload) => {
  // PostToolUse-only: we react to a push's enterprise-ruleset rejection carried
  // in tool_response. A non-PostToolUse event (defensive) passes silently.
  if (
    (payload as { hook_event_name?: unknown | undefined }).hook_event_name !==
    'PostToolUse'
  ) {
    return undefined
  }
  if (!isGitPush(command)) {
    return undefined
  }
  const toolResponse = (payload as { tool_response?: unknown | undefined })
    .tool_response
  const output = extractOutput(toolResponse)
  const rejection = rulesetRejection(output)
  if (!rejection) {
    return undefined
  }
  const slug = getCurrentRepoSlug()
  const escapes: EscapeProperty[] = []
  if (rejection.pr) {
    escapes.push({
      name: PR_ESCAPE_PROPERTY,
      rule: 'Changes must be made through a pull request',
      /* c8 ignore next - slug is undefined only when git remote is misconfigured; unreachable in a valid checkout */
      value: slug ? getPropertyValue(slug, PR_ESCAPE_PROPERTY) : undefined,
    })
  }
  if (rejection.workflow) {
    escapes.push({
      name: WORKFLOW_ESCAPE_PROPERTY,
      rule: 'Required workflow ... is not satisfied (the zizmor Audit GHA check)',
      /* c8 ignore next - slug is undefined only when git remote is misconfigured; unreachable in a valid checkout */
      value: slug
        ? getPropertyValue(slug, WORKFLOW_ESCAPE_PROPERTY)
        : undefined,
    })
  }
  return notify(formatReminder(slug, escapes))
})

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Bash'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
