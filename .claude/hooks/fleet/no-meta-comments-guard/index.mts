#!/usr/bin/env node
// Claude Code PreToolUse hook — no-meta-comments-guard.
//
// Blocks Edit/Write tool calls that introduce a comment which:
//
//   (a) References the current task / user request rather
//       than the code's runtime semantics.
//
//   (b) Describes code that was removed rather than code that
//       exists.
//
// Per CLAUDE.md "Code style → Comments": comments default to none;
// when written, audience is a junior dev — explain the CONSTRAINT
// or the hidden invariant, not the development context (commit
// messages and PR descriptions are where development context goes).
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

import { walkComments } from '../_shared/ast/comments.mts'
import { splitLines } from '../_shared/ast/core.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

interface MetaCommentFinding {
  readonly kind: 'task' | 'removed-code'
  readonly line: number
  readonly snippet: string
  readonly suggestion: string
}

// Task / user-request references.
//
// Patterns are anchored on `// `, `/* `, `# `, ` * `, ` - ` (markdown
// bullet inside comment) so we don't false-positive on identifiers
// or string literals containing the words.
//
// Leading labels (`Task:`) are case-insensitive. The free-form phrases
// (`per the task`, `as requested`) match anywhere in the comment body.
const TASK_PATTERNS: ReadonlyArray<{
  readonly re: RegExp
  readonly stripPrefix?: RegExp | undefined
}> = [
  {
    // Newline or line-start, comment marker, then a task/plan label keyword + colon.
    re: /(^|\n)\s*(?:#|-|\*|\/\*|\/\/)\s*(?:note from (?:brief|plan|task)|plan|task)\s*:/i,
    stripPrefix:
      /^(\s*(?:#|-|\*|\/\*|\/\/)\s*)(?:note from (?:brief|plan|task)|plan|task)\s*:\s*/i, // socket-lint: allow uncommented-regex
  },
  {
    // Newline or line-start, comment marker, then "per the X" or "as requested" phrase.
    re: /(^|\n)\s*(?:#|-|\*|\/\*|\/\/)\s*(?:as requested|per the (?:brief|plan|request|spec|task|user)|per the user('s)? request)\b/i,
  },
  {
    // Newline or line-start, comment marker, then a FIXME/TODO/XXX + "from/per X" phrase.
    re: /(^|\n)\s*(?:#|-|\*|\/\*|\/\/)\s*(?:FIXME|TODO|XXX)\s+(?:from|per)\s+(?:the\s+)?(?:brief|plan|request|spec|task|user)\b/i,
  },
  {
    // Newline or line-start, comment marker, then a roadmap keyword + numeric/roman marker.
    re: /(^|\n)\s*(?:#|-|\*|\/\*|\/\/)\s*(?:iteration|milestone|phase|sprint|step|tier)\s+(?:[0-9]+[a-z]*|i{1,3}|iv|v|vi{0,3}|ix|x)\b/i,
    stripPrefix:
      /^(\s*(?:#|-|\*|\/\*|\/\/)\s*)(?:iteration|milestone|phase|sprint|step|tier)\s+(?:[0-9]+[a-z]*|i{1,3}|iv|v|vi{0,3}|ix|x)\s*[:.-]?\s*/i, // socket-lint: allow uncommented-regex
  },
]

// Patterns that flag code-deletion phrases inside source comments.
const REMOVED_CODE_PATTERNS: readonly RegExp[] = [
  // Newline or line-start, comment marker, then the word 'removed' as a whole word.
  /(^|\n)\s*(?:#|\*|\/\*|\/\/)\s*removed\b/i,
  // Newline or line-start, comment marker, then the word 'previously' as a whole word.
  /(^|\n)\s*(?:#|\*|\/\*|\/\/)\s*previously\b/i,
  // Newline or line-start, comment marker, then the two-word phrase 'used to'.
  /(^|\n)\s*(?:#|\*|\/\*|\/\/)\s*used\s+to\b/i,
  // Newline or line-start, comment marker, then the two-word phrase 'no longer'.
  /(^|\n)\s*(?:#|\*|\/\*|\/\/)\s*no\s+longer\b/i,
  // Newline or line-start, comment marker, then the word 'formerly' as a whole word.
  /(^|\n)\s*(?:#|\*|\/\*|\/\/)\s*formerly\b/i,
]

/**
 * Uppercase the first alphabetic character that follows the comment marker, so
 * a stripped label reads naturally. Skips the comment marker tokens so they
 * don't count as "first letter".
 */
export function uppercaseFirstLetterAfterMarker(line: string): string {
  const m = line.match(
    /^(?<prefix>\s*(?:#|-|\*|\/\*|\/\/)\s*)(?<firstChar>[a-zA-Z])/,
  )
  if (!m) {
    return line
  }
  const prefix = m.groups!.prefix!
  const firstChar = m.groups!.firstChar!
  return prefix + firstChar.toUpperCase() + line.slice(prefix.length + 1)
}

// Body-only versions of the patterns (no comment-marker prefix —
// the AST walker already gives us the body text).
const TASK_BODY_PATTERNS: ReadonlyArray<{
  readonly re: RegExp
  readonly stripBody?: RegExp | undefined
}> = [
  {
    // Body starts with "plan:", "task:", or "note from (brief|plan|task):" label.
    re: /^\s*(?:note from (?:brief|plan|task)|plan|task)\s*:/i,
    // Strips the leading label keyword + colon, leaving only the label's value text.
    stripBody: /^\s*(?:note from (?:brief|plan|task)|plan|task)\s*:\s*/i,
  },
  {
    // Body starts with "per the X" or "as requested" or "per the user('s) request".
    re: /^\s*(?:as requested|per the (?:brief|plan|request|spec|task|user)|per the user('s)? request)\b/i,
  },
  {
    // Body starts with a FIXME/TODO/XXX marker followed by "from/per (the) X".
    re: /^\s*(?:FIXME|TODO|XXX)\s+(?:from|per)\s+(?:the\s+)?(?:brief|plan|request|spec|task|user)\b/i,
  },
  {
    // Body starts with a roadmap keyword followed by a numeric or roman-numeral marker.
    re: /^\s*(?:iteration|milestone|phase|sprint|step|tier)\s+(?:[0-9]+[a-z]*|i{1,3}|iv|v|vi{0,3}|ix|x)\b/i,
    stripBody:
      /^\s*(?:iteration|milestone|phase|sprint|step|tier)\s+(?:[0-9]+[a-z]*|i{1,3}|iv|v|vi{0,3}|ix|x)\s*[:.-]?\s*/i, // socket-lint: allow uncommented-regex
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
 * don't trigger.
 */
export function findMetaCommentsAst(text: string): MetaCommentFinding[] {
  const findings: MetaCommentFinding[] = []
  const lines = splitLines(text)
  for (const c of walkComments(text, { comments: true })) {
    const bodyLines = splitLines(c.value)
    for (let li = 0; li < bodyLines.length; li += 1) {
      const body = bodyLines[li]!
      const cleaned = body.replace(/^\s*\*\s?/, '')
      const lineNum = c.line + li
      /* c8 ignore next - defensive fallback; comment lines are always within source bounds after a successful parse */
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
          /* c8 ignore next - suggestion is always a non-empty string; the || arm is unreachable */
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
 * marker-anchored regex scan.
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
        /* c8 ignore next - suggestion is always a non-empty string; the || arm is unreachable */
        suggestion:
          suggestion ||
          '(remove the comment entirely — it has no runtime content)',
      })
      break
    }
    for (let j = 0, { length: len } = REMOVED_CODE_PATTERNS; j < len; j += 1) {
      const re = REMOVED_CODE_PATTERNS[j]!
      if (!re.test(`\n${line}`)) {
        continue
      }
      findings.push({
        kind: 'removed-code',
        line: j + 1,
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

export const check = editGuard(
  (filePath, content) => {
    // Only check source files. Markdown / json / yaml don't have
    // "code comments" in the relevant sense.
    if (!/\.(?:[cm]?[jt]sx?|cc|cpp|h|hpp|rs|go|py|sh)$/.test(filePath)) {
      return undefined
    }
    const text = content ?? ''
    if (!text) {
      return undefined
    }

    const findings = findMetaComments(text, filePath)
    if (findings.length === 0) {
      return undefined
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
    return block(lines.join('\n') + '\n')
  },
  { fleetOnly: true },
)

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
