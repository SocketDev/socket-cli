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
//   - Lines marked `# socket-hook: allow uses-no-stamp` are exempt for
//     one-off legitimate cases.
//
// The hook fails OPEN on its own bugs (exit 0 + stderr log) so a bad
// hook deploy can't brick the session.

import process from 'node:process'

const ALLOW_MARKER = '# socket-hook: allow uses-no-stamp'

// Matches a YAML `uses:` line that pins a 40-char SHA, e.g.
//   `        uses: actions/checkout@de0fac2e... # v6.0.2 (2026-05-15)`
// Captures: (1) ref-name, (2) sha, (3) trailing-comment (may be empty).
const USES_RE =
  /^\s*-?\s*uses:\s+([^\s@]+)@([0-9a-f]{40})(\s*#[^\n]*)?\s*$/

// Local actions (`./.github/...`) and Docker images (`docker://...`)
// don't have SHAs and aren't matched by USES_RE — no special-casing
// needed.

// Comment must be exactly `# <label> (YYYY-MM-DD)` (label is any
// non-paren text, date is 4-2-2 digits). The leading `#` and a space
// are required; everything else after the date is rejected so we
// don't tolerate sloppy trailing junk.
const COMMENT_RE =
  /^#\s+\S[^()]*\s+\(\d{4}-\d{2}-\d{2}\)\s*$/

interface Hook {
  tool_name?: string
  tool_input?: {
    file_path?: string
    new_string?: string
    content?: string
  }
}

interface BadLine {
  line: string
  reason: string
}

function isWorkflowYamlPath(p: string): boolean {
  // Workflows: .github/workflows/*.{yml,yaml}
  // Local actions: .github/actions/<name>/action.{yml,yaml}
  if (!p.includes('/.github/')) return false
  if (!/\.(ya?ml)$/.test(p)) return false
  return (
    /\/\.github\/workflows\/[^/]+\.(ya?ml)$/.test(p) ||
    /\/\.github\/actions\/[^/]+\/action\.(ya?ml)$/.test(p)
  )
}

function findBadUsesLines(text: string): BadLine[] {
  const lines = text.split('\n')
  const bad: BadLine[] = []
  for (const line of lines) {
    if (!line) continue
    if (line.includes(ALLOW_MARKER)) continue
    const m = USES_RE.exec(line)
    if (!m) continue
    const comment = (m[3] ?? '').trim()
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

function main() {
  let stdin = ''
  process.stdin.on('data', chunk => {
    stdin += chunk
  })
  process.stdin.on('end', () => {
    try {
      let payload: Hook
      try {
        payload = JSON.parse(stdin) as Hook
      } catch {
        process.exit(0)
      }
      const tool = payload.tool_name
      if (tool !== 'Edit' && tool !== 'Write') {
        process.exit(0)
      }
      const filePath = payload.tool_input?.file_path
      if (!filePath || !isWorkflowYamlPath(filePath)) {
        process.exit(0)
      }
      const proposed =
        payload.tool_input?.content ?? payload.tool_input?.new_string ?? ''
      const bad = findBadUsesLines(proposed)
      if (bad.length === 0) {
        process.exit(0)
      }
      const today = new Date().toISOString().slice(0, 10)
      process.stderr.write(
        `[workflow-uses-comment-guard] refusing edit: ${bad.length} ` +
          `\`uses:\` line(s) lack the canonical ` +
          `\`# <tag-or-version-or-branch> (YYYY-MM-DD)\` comment:\n` +
          bad
            .map(b => `    ${b.line}\n      ↳ ${b.reason}`)
            .join('\n') +
          '\n\nFix: append a comment like `# v6.4.0 (' +
          today +
          ')` or `# main (' +
          today +
          ')` to every SHA-pinned `uses:` line.\n' +
          'The label is the upstream tag, branch, or short-SHA; the date is\n' +
          'when you pinned/refreshed (today is fine for new pins). The\n' +
          'date-stamp is the staleness signal — reviewers can see at-a-glance\n' +
          'when a SHA was last touched without running a drift audit.\n' +
          '\nOne-off override: append `# socket-hook: allow uses-no-stamp`\n' +
          'to the `uses:` line.\n',
      )
      process.exit(2)
    } catch (e) {
      process.stderr.write(
        `[workflow-uses-comment-guard] hook error (allowing): ${e}\n`,
      )
      process.exit(0)
    }
  })
  if (process.stdin.readable === false) {
    process.exit(0)
  }
}

main()
