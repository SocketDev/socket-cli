#!/usr/bin/env node
// Claude Code PreToolUse hook — workflow-uses-comment-guard.
//
// Blocks Edit/Write tool calls that introduce a `uses: <action>@<sha>`
// line in a GitHub Actions YAML file (`.github/workflows/*.yml`,
// `.github/actions/*/action.yml`) without the canonical trailing
// `# <tag-or-version-or-branch> (YYYY-MM-DD)` staleness comment.
//
// Without that comment a reviewer can't tell at-a-glance whether the
// pin is fresh or six months stale, and the date-stamp is the cheapest
// staleness signal we have outside of running a full drift audit.
//
// Accepted comment shapes (the part inside the parens MUST be ISO date):
//   # v6.4.0 (2026-05-15)
//   # main (2026-05-15)
//   # codeql-bundle-v2.25.4 (2026-05-15)
//   # 27d5ce7f (2026-05-15)         <- short-SHA also fine
//
// Rejected:
//   # v6.4.0                        <- no date stamp
//   # main                          <- no date stamp
//   # (2026-05-15)                  <- no version label
//
// Scope:
//   - Fires on Edit and Write tool calls.
//   - Only inspects `.github/workflows/*.{yml,yaml}` and
//     `.github/actions/**/*.{yml,yaml}`.
//   - Local-action references (`./.github/actions/foo`) are exempt —
//     they don't carry SHAs.
//   - Reusable-workflow refs (`uses: org/repo/.github/workflows/x.yml@sha`)
//     are checked.
//   - Lines marked `# socket-lint: allow uses-no-stamp` are exempt for
//     one-off legitimate cases.
//
// The hook fails OPEN on its own bugs (exit 0 + stderr log) so a bad
// hook deploy can't brick the session.

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

const ALLOW_MARKER = '# socket-lint: allow uses-no-stamp'

// Matches a YAML `uses:` line that pins a 40-char SHA, e.g.
//   `        uses: actions/checkout@de0fac2e... # v6.0.2 (2026-05-15)`
// Captures: (1) ref-name, (2) sha, (3) trailing-comment (may be empty).
const USES_RE =
  /^\s*-?\s*uses:\s+(?:[^\s@]+)@(?:[0-9a-f]{40})(?<comment>\s*#[^\n]*)?\s*$/

// Local actions (`./.github/...`) and Docker images (`docker://...`)
// don't have SHAs and aren't matched by USES_RE — no special-casing
// needed.

// Comment must be exactly `# <label> (YYYY-MM-DD)` (label is any
// non-paren text, date is 4-2-2 digits). The leading `#` and a space
// are required; everything else after the date is rejected so we
// don't tolerate sloppy trailing junk.
const COMMENT_RE = /^#\s+\S[^()]*\s+\(\d{4}-\d{2}-\d{2}\)\s*$/

export function findBadUsesLines(text: string): BadLine[] {
  const lines = text.split('\n')
  const bad: BadLine[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!line) {
      continue
    }
    if (line.includes(ALLOW_MARKER)) {
      continue
    }
    const m = USES_RE.exec(line)
    if (!m) {
      continue
    }
    const comment = (m.groups?.comment ?? '').trim()
    if (!comment) {
      bad.push({ line: line.trim(), reason: 'no comment on uses:' })
      continue
    }
    if (!COMMENT_RE.test(comment)) {
      bad.push({
        line: line.trim(),
        reason: `comment does not match \`# <label> (YYYY-MM-DD)\` (got: ${comment})`,
      })
    }
  }
  return bad
}

interface BadLine {
  line: string
  reason: string
}

export function isWorkflowYamlPath(rawPath: string): boolean {
  // Workflows: .github/workflows/*.{yml,yaml}
  // Local actions: .github/actions/<name>/action.{yml,yaml}
  // Normalize Windows `\` separators to `/` first; the forward-slash-only
  // checks below would never match a backslash path and would silently bypass
  // the guard on Windows.
  const p = normalizePath(rawPath)
  if (!p.includes('/.github/')) {
    return false
  }
  if (!/\.(ya?ml)$/.test(p)) {
    return false
  }
  // gh-aw compiles a `<name>.md` agentic workflow to a generated
  // `<name>.lock.yml`. That artifact is tool-owned (never hand-edited) and
  // SHA-pins every action with a `# <version>` comment plus a full manifest
  // header, so the hand-authored `(YYYY-MM-DD)` convention doesn't apply.
  if (/\.lock\.ya?ml$/.test(p)) {
    return false
  }
  return (
    /\/\.github\/workflows\/[^/]+\.(ya?ml)$/.test(p) ||
    /\/\.github\/actions\/[^/]+\/action\.(ya?ml)$/.test(p)
  )
}

export const check = editGuard((filePath, content) => {
  if (!isWorkflowYamlPath(filePath)) {
    return undefined
  }
  const proposed = content ?? ''
  const bad = findBadUsesLines(proposed)
  if (bad.length === 0) {
    return undefined
  }
  const today = new Date().toISOString().slice(0, 10)
  return block(
    `[workflow-uses-comment-guard] refusing edit: ${bad.length} ` +
      `\`uses:\` line(s) lack the canonical ` +
      `\`# <tag-or-version-or-branch> (YYYY-MM-DD)\` comment:\n` +
      bad.map(b => `    ${b.line}\n      ↳ ${b.reason}`).join('\n') +
      '\n\nFix: append a comment like `# v6.4.0 (' +
      today +
      ')` or `# main (' +
      today +
      ')` to every SHA-pinned `uses:` line.\n' +
      'The label is the upstream tag, branch, or short-SHA; the date is\n' +
      'when you pinned/refreshed (today is fine for new pins). The\n' +
      'date-stamp is the staleness signal — reviewers can see at-a-glance\n' +
      'when a SHA was last touched without running a drift audit.\n' +
      '\nOne-off override: append `# socket-lint: allow uses-no-stamp`\n' +
      'to the `uses:` line.',
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
