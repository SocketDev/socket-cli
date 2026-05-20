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

import { splitLines, walkComments } from '../_shared/acorn/index.mts'

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
  readonly stripPrefix?: RegExp | undefined
}> = [
  // `// Plan: ...` / `// Task: ...` / `// Note from plan: ...`
  {
    re: /(^|\n)\s*(?:\/\/|\/\*|\*|#|-)\s*(?:plan|task|note from (?:brief|plan|task))\s*:/i,
    stripPrefix:
      /^(\s*(?:\/\/|\/\*|\*|#|-)\s*)(?:plan|task|note from (?:brief|plan|task))\s*:\s*/i,
  },
  // `// Per the task ...` / `// Per the plan ...` / `// As requested ...`
  {
    re: /(^|\n)\s*(?:\/\/|\/\*|\*|#|-)\s*(?:per the (?:brief|plan|request|spec|task|user)|as requested|per the user('s)? request)\b/i,
  },
  // `// TODO from the brief` / `// FIXME per plan`
  {
    re: /(^|\n)\s*(?:\/\/|\/\*|\*|#|-)\s*(?:FIXME|TODO|XXX)\s+(?:from|per)\s+(?:the\s+)?(?:brief|plan|request|spec|task|user)\b/i,
  },
  // Phase / tier / step markers — `// Tier 1 ...`, `// Phase 10a:
  // ...`, `// Step 3 - ...`. These leak the roadmap shape into source
  // and rot when the roadmap shifts. Catch as bare labels (followed
  // by whitespace + number) OR as `Phase NNN:` / `Step NNN -` colon /
  // dash labels.
  {
    re: /(^|\n)\s*(?:\/\/|\/\*|\*|#|-)\s*(?:iteration|milestone|phase|sprint|step|tier)\s+(?:[0-9]+[a-z]*|i{1,3}|iv|v|vi{0,3}|ix|x)\b/i,
    stripPrefix:
      /^(\s*(?:\/\/|\/\*|\*|#|-)\s*)(?:iteration|milestone|phase|sprint|step|tier)\s+(?:[0-9]+[a-z]*|i{1,3}|iv|v|vi{0,3}|ix|x)\s*[:.-]?\s*/i,
  },
]

// Removed-code references.
const REMOVED_CODE_PATTERNS: readonly RegExp[] = [
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
 * Uppercase the first alphabetic character that follows the comment marker, so
 * a stripped `// plan: use the cache` reads as `// Use the cache`. Skips the
 * comment marker tokens so they don't count as "first letter".
 */
export function uppercaseFirstLetterAfterMarker(line: string): string {
  const m = line.match(/^(\s*(?:\/\/|\/\*|\*|#|-)\s*)([a-zA-Z])/)
  if (!m) {
    return line
  }
  const prefix = m[1]!
  const firstChar = m[2]!
  return prefix + firstChar.toUpperCase() + line.slice(prefix.length + 1)
}

// Body-only versions of the patterns (no comment-marker prefix —
// the AST walker already gives us the body text). The same TASK_PATTERNS
// and REMOVED_CODE_PATTERNS above retain the marker-prefixed form so the
// non-JS lexical path below can still use them.
const TASK_BODY_PATTERNS: ReadonlyArray<{
  readonly re: RegExp
  readonly stripBody?: RegExp | undefined
}> = [
  {
    re: /^\s*(?:plan|task|note from (?:brief|plan|task))\s*:/i,
    stripBody: /^\s*(?:plan|task|note from (?:brief|plan|task))\s*:\s*/i,
  },
  {
    re: /^\s*(?:per the (?:brief|plan|request|spec|task|user)|as requested|per the user('s)? request)\b/i,
  },
  {
    re: /^\s*(?:FIXME|TODO|XXX)\s+(?:from|per)\s+(?:the\s+)?(?:brief|plan|request|spec|task|user)\b/i,
  },
  {
    re: /^\s*(?:iteration|milestone|phase|sprint|step|tier)\s+(?:[0-9]+[a-z]*|i{1,3}|iv|v|vi{0,3}|ix|x)\b/i,
    stripBody:
      /^\s*(?:iteration|milestone|phase|sprint|step|tier)\s+(?:[0-9]+[a-z]*|i{1,3}|iv|v|vi{0,3}|ix|x)\s*[:.-]?\s*/i,
  },
]

const REMOVED_CODE_BODY_PATTERNS: readonly RegExp[] = [
  /^\s*removed\b/i,
  /^\s*previously\b/i,
  /^\s*used\s+to\b/i,
  /^\s*no\s+longer\b/i,
  /^\s*formerly\b/i,
]

/**
 * AST-based detector for JS/TS/JSX/TSX source. Uses `walkComments` from the
 * shared acorn helper to walk just the comment tokens — string-literal mentions
 * of `Plan:` / `Task:` etc. don't trigger.
 */
export function findMetaCommentsAst(text: string): MetaCommentFinding[] {
  const findings: MetaCommentFinding[] = []
  const lines = splitLines(text)
  for (const c of walkComments(text, { comments: true })) {
    // Block comments may have multiple meaningful lines; check each
    // line of the body individually so the suggestion can name the
    // exact offending line.
    const bodyLines = splitLines(c.value)
    for (let li = 0; li < bodyLines.length; li += 1) {
      const body = bodyLines[li]!
      // Strip leading ` *` / `*` decorators that JSDoc-style blocks use.
      const cleaned = body.replace(/^\s*\*\s?/, '')
      const lineNum = c.line + li
      const sourceLine = (lines[lineNum - 1] ?? '').trim()
      let matched = false
      for (const { re, stripBody } of TASK_BODY_PATTERNS) {
        if (!re.test(cleaned)) {
          continue
        }
        const stripped = stripBody
          ? cleaned.replace(stripBody, '').trim()
          : cleaned.trim()
        const suggestion = uppercaseFirstLetterAfterMarker(
          c.kind === 'Line' ? `// ${stripped}` : `* ${stripped}`,
        )
        findings.push({
          kind: 'task',
          line: lineNum,
          snippet: sourceLine,
          suggestion:
            suggestion ||
            '(remove the comment entirely — it has no runtime content)',
        })
        matched = true
        break
      }
      if (matched) {
        continue
      }
      for (
        let i = 0, { length } = REMOVED_CODE_BODY_PATTERNS;
        i < length;
        i += 1
      ) {
        const re = REMOVED_CODE_BODY_PATTERNS[i]!
        if (!re.test(cleaned)) {
          continue
        }
        findings.push({
          kind: 'removed-code',
          line: lineNum,
          snippet: sourceLine,
          suggestion:
            '(remove the comment — code that no longer exists is git-history territory, not source comments)',
        })
        break
      }
    }
  }
  return findings
}

/**
 * Lexical-regex fallback for non-JS sources (C++, Rust, Go, Python, shell). The
 * acorn-wasm parser only understands JS/TS, so for those languages we keep the
 * marker-anchored regex scan. False-positives on string-literal mentions of `//
 * Plan:` etc. are possible but rare in practice for those language
 * conventions.
 */
export function findMetaCommentsLexical(text: string): MetaCommentFinding[] {
  const findings: MetaCommentFinding[] = []
  const lines = splitLines(text)

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    for (const { re, stripPrefix } of TASK_PATTERNS) {
      if (!re.test(`\n${line}`)) {
        continue
      }
      const stripped = stripPrefix
        ? line.replace(stripPrefix, '$1').replace(/\s+/g, ' ').trim()
        : line
            .trim()
            .replace(/^[\s/*#-]+/, '')
            .trim()
      const suggestion = uppercaseFirstLetterAfterMarker(stripped)
      findings.push({
        kind: 'task',
        line: i + 1,
        snippet: line.trim(),
        suggestion:
          suggestion ||
          '(remove the comment entirely — it has no runtime content)',
      })
      break
    }
    for (let i = 0, { length } = REMOVED_CODE_PATTERNS; i < length; i += 1) {
      const re = REMOVED_CODE_PATTERNS[i]!
      if (!re.test(`\n${line}`)) {
        continue
      }
      findings.push({
        kind: 'removed-code',
        line: i + 1,
        snippet: line.trim(),
        suggestion:
          '(remove the comment — code that no longer exists is git-history territory, not source comments)',
      })
      break
    }
  }
  return findings
}

const JS_TS_FILE_RE = /\.(?:[cm]?[jt]sx?)$/

export function findMetaComments(
  text: string,
  filePath: string,
): MetaCommentFinding[] {
  return JS_TS_FILE_RE.test(filePath)
    ? findMetaCommentsAst(text)
    : findMetaCommentsLexical(text)
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
    const text =
      payload.tool_input?.new_string ?? payload.tool_input?.content ?? ''
    if (!text) {
      process.exit(0)
    }

    const findings = findMetaComments(text, filePath)
    if (findings.length === 0) {
      process.exit(0)
    }

    const lines: string[] = []
    lines.push('[no-meta-comments-guard] Blocked: meta-comment(s) in source.')
    lines.push(`  File: ${filePath}`)
    lines.push('')
    for (let i = 0, { length } = findings; i < length; i += 1) {
      const f = findings[i]!
      lines.push(`  Line ${f.line} (${f.kind}):`)
      lines.push(`    Saw:     ${f.snippet}`)
      lines.push(`    Suggest: ${f.suggestion}`)
      lines.push('')
    }
    lines.push('  Per CLAUDE.md "Code style → Comments": comments describe the')
    lines.push('  CONSTRAINT or the hidden invariant. Development context')
    lines.push(
      '  (the plan, the task, the user request, removed code) lives in',
    )
    lines.push('  commit messages and PR descriptions, not source comments.')
    lines.push('')
    lines.push('  Rewrite or delete the comment, then retry the Edit/Write.')
    process.stderr.write(lines.join('\n') + '\n')
    process.exit(2)
  } catch (e) {
    process.stderr.write(
      `[no-meta-comments-guard] hook error (allowing): ${e}\n`,
    )
    process.exit(0)
  }
})
