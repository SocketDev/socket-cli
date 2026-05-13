#!/usr/bin/env node
// Claude Code PreToolUse hook — no-meta-comments-guard.
//
// Blocks Edit/Write tool calls that introduce a comment which:
//
//   (a) References the current task / plan / user request rather
//       than the code's runtime semantics:
//         // Plan: use the cache here
//         // Task: rename foo to bar
//         // Per the task instructions, swap to async
//         // As requested, add retry
//         // TODO from the brief: handle Win32
//
//   (b) Describes code that was removed rather than code that
//       exists:
//         // removed: old behavior used a Map here
//         // previously called X; now Y
//         // used to be sync, made async in 6.0
//         // no longer using fetch — see commit abc1234
//
// Per CLAUDE.md "Code style → Comments": comments default to none;
// when written, audience is a junior dev — explain the CONSTRAINT
// or the hidden invariant, not the development context (commit
// messages and PR descriptions are where development context goes).
//
// On block, emits a stderr suggestion stripping the meta prefix so
// the agent can keep the explanation if it's actually useful and
// just drop the noise. Example transform:
//
//   // Plan: use the cache to avoid re-resolving  →  // Use the cache to avoid re-resolving
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit"|"Write",
//     "tool_input": { "file_path": "...", "content"|"new_string": "..." } }
//
// Exit codes:
//   0 — pass (not Edit/Write, no meta comments).
//   2 — block (at least one meta-comment pattern found).
//
// Fails open on malformed payloads (exit 0 + stderr log).

import process from 'node:process'

interface ToolInput {
  readonly tool_input?:
    | {
        readonly content?: string | undefined
        readonly file_path?: string | undefined
        readonly new_string?: string | undefined
      }
    | undefined
  readonly tool_name?: string | undefined
}

interface MetaCommentFinding {
  readonly kind: 'task' | 'removed-code'
  readonly line: number
  readonly snippet: string
  readonly suggestion: string
}

// Task / plan / user-request references.
//
// Patterns are anchored on `// `, `/* `, `# `, ` * `, ` - ` (markdown
// bullet inside comment) so we don't false-positive on identifiers
// or string literals containing the words.
//
// `Plan:` / `Task:` are case-insensitive leading labels. The free-
// form phrases (`per the task`, `as requested`) match anywhere in
// the comment body — those are the dead-give-away tells, not the
// rest of the sentence.
const TASK_PATTERNS: ReadonlyArray<{
  readonly re: RegExp
  readonly stripPrefix?: RegExp
}> = [
  // `// Plan: ...` / `// Task: ...` / `// Note from plan: ...`
  {
    re: /(^|\n)\s*(?:\/\/|\/\*|\*|#|-)\s*(?:plan|task|note from (?:plan|task|brief))\s*:/i,
    stripPrefix: /^(\s*(?:\/\/|\/\*|\*|#|-)\s*)(?:plan|task|note from (?:plan|task|brief))\s*:\s*/i,
  },
  // `// Per the task ...` / `// Per the plan ...` / `// As requested ...`
  {
    re: /(^|\n)\s*(?:\/\/|\/\*|\*|#|-)\s*(?:per the (?:task|plan|brief|spec|user|request)|as requested|per the user('s)? request)\b/i,
  },
  // `// TODO from the brief` / `// FIXME per plan`
  {
    re: /(^|\n)\s*(?:\/\/|\/\*|\*|#|-)\s*(?:TODO|FIXME|XXX)\s+(?:from|per)\s+(?:the\s+)?(?:plan|task|brief|spec|user|request)\b/i,
  },
]

// Removed-code references.
const REMOVED_CODE_PATTERNS: ReadonlyArray<RegExp> = [
  // `// removed X` / `// removed: X`
  /(^|\n)\s*(?:\/\/|\/\*|\*|#)\s*removed\b/i,
  // `// previously X` / `// previously called X`
  /(^|\n)\s*(?:\/\/|\/\*|\*|#)\s*previously\b/i,
  // `// used to X` / `// used to be X`
  /(^|\n)\s*(?:\/\/|\/\*|\*|#)\s*used\s+to\b/i,
  // `// no longer X` / `// no longer needed`
  /(^|\n)\s*(?:\/\/|\/\*|\*|#)\s*no\s+longer\b/i,
  // `// formerly X`
  /(^|\n)\s*(?:\/\/|\/\*|\*|#)\s*formerly\b/i,
]

/**
 * Uppercase the first alphabetic character that follows the comment
 * marker, so a stripped `// plan: use the cache` reads as
 * `// Use the cache`. Skips the comment marker tokens so they don't
 * count as "first letter".
 */
function uppercaseFirstLetterAfterMarker(line: string): string {
  const m = line.match(/^(\s*(?:\/\/|\/\*|\*|#|-)\s*)([a-zA-Z])/)
  if (!m) {
    return line
  }
  const prefix = m[1]!
  const firstChar = m[2]!
  return prefix + firstChar.toUpperCase() + line.slice(prefix.length + 1)
}

/**
 * Walk the text, find every meta-comment finding. Returns the line
 * number (1-indexed) so the error message can name the exact site.
 */
function findMetaComments(text: string): MetaCommentFinding[] {
  const findings: MetaCommentFinding[] = []
  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    for (const { re, stripPrefix } of TASK_PATTERNS) {
      if (!re.test(`\n${line}`)) {
        continue
      }
      // Build the suggestion. For task-style comments we strip the
      // meta prefix (`Plan:` / `Task:`) and uppercase the first
      // letter of the remainder so the rewritten comment reads as a
      // normal sentence. For free-form patterns without a stripPrefix
      // (e.g. `// Per the task ...`) we surface the bare body for the
      // operator to rewrite.
      const stripped = stripPrefix
        ? line.replace(stripPrefix, '$1').replace(/\s+/g, ' ').trim()
        : line.trim().replace(/^[\s/*#-]+/, '').trim()
      const suggestion = uppercaseFirstLetterAfterMarker(stripped)
      findings.push({
        kind: 'task',
        line: i + 1,
        snippet: line.trim(),
        suggestion: suggestion || '(remove the comment entirely — it has no runtime content)',
      })
      break
    }
    for (const re of REMOVED_CODE_PATTERNS) {
      if (!re.test(`\n${line}`)) {
        continue
      }
      findings.push({
        kind: 'removed-code',
        line: i + 1,
        snippet: line.trim(),
        suggestion: '(remove the comment — code that no longer exists is git-history territory, not source comments)',
      })
      break
    }
  }
  return findings
}

let payloadRaw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  payloadRaw += chunk
})
process.stdin.on('end', () => {
  try {
    let payload: ToolInput
    try {
      payload = JSON.parse(payloadRaw) as ToolInput
    } catch {
      process.exit(0)
    }
    if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
      process.exit(0)
    }
    const filePath = payload.tool_input?.file_path ?? ''
    // Only check source files. Markdown / json / yaml don't have
    // "code comments" in the relevant sense — those file types use
    // the same prefix tokens (`#`, `//`, `*`) as legitimate body
    // content, not as comment markers.
    if (!/\.(?:[cm]?[jt]sx?|cc|cpp|h|hpp|rs|go|py|sh)$/.test(filePath)) {
      process.exit(0)
    }
    const text = payload.tool_input?.new_string ?? payload.tool_input?.content ?? ''
    if (!text) {
      process.exit(0)
    }

    const findings = findMetaComments(text)
    if (findings.length === 0) {
      process.exit(0)
    }

    const lines: string[] = []
    lines.push('[no-meta-comments-guard] Blocked: meta-comment(s) in source.')
    lines.push(`  File: ${filePath}`)
    lines.push('')
    for (const f of findings) {
      lines.push(`  Line ${f.line} (${f.kind}):`)
      lines.push(`    Saw:     ${f.snippet}`)
      lines.push(`    Suggest: ${f.suggestion}`)
      lines.push('')
    }
    lines.push('  Per CLAUDE.md "Code style → Comments": comments describe the')
    lines.push('  CONSTRAINT or the hidden invariant. Development context')
    lines.push('  (the plan, the task, the user request, removed code) lives in')
    lines.push('  commit messages and PR descriptions, not source comments.')
    lines.push('')
    lines.push('  Rewrite or delete the comment, then retry the Edit/Write.')
    process.stderr.write(lines.join('\n') + '\n')
    process.exit(2)
  } catch (e) {
    process.stderr.write(`[no-meta-comments-guard] hook error (allowing): ${e}\n`)
    process.exit(0)
  }
})
