#!/usr/bin/env node
// Claude Code PreToolUse hook — workflow-multiline-body-guard.
//
// Blocks Edit/Write to `.github/workflows/*.y*ml` files that introduce a
// `gh ... --body "..."` call with multi-line markdown inside the `--body`
// string. Multi-line markdown breaks YAML parsing — heading characters
// (`#`), backticks, triple-dash horizontal rules, and unbalanced quotes
// all terminate or confuse the workflow's YAML scalar. The failure mode
// is silent: GitHub shows "0 jobs" on push triggers, no error in the UI
// unless you `gh run list` and notice nothing fires.
//
// Detection: regex over the after-edit text of the workflow file. Look
// for `gh (pr|issue|release) (create|edit|comment) ... --body "..."` where
// the `--body` argument spans multiple lines or contains characters that
// would break YAML parsing (`#` at start of line, ``` backtick-fenced
// blocks, `---` standalone line).
//
// Fix: replace with `--body-file <path>` or `--body "$VAR"` where the
// content is built via heredoc into a tempfile / shell var.
//
// Bypass: `Allow workflow-yaml-multiline-body bypass` typed verbatim in a
// recent user turn.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withEditGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow workflow-yaml-multiline-body bypass'

// Detect a multi-line `--body "..."` argument to gh. The match is
// conservative: we look for the literal `--body "` opener, then scan to
// the matching closing `"` (respecting backslash escapes), and check
// whether the captured body contains a newline or a YAML-hazardous
// character at a position that would break the surrounding YAML scalar.
export function findUnsafeBody(text: string): string | undefined {
  // Iterate through every `--body "` occurrence.
  const opener = /--body\s+"/g
  let m: RegExpExecArray | null
  while ((m = opener.exec(text)) !== null) {
    const start = m.index + m[0].length
    // Find the matching close quote. Allow backslash-escaped quotes.
    let i = start
    let escaped = false
    while (i < text.length) {
      const c = text[i]
      if (escaped) {
        escaped = false
        i += 1
        continue
      }
      if (c === '\\') {
        escaped = true
        i += 1
        continue
      }
      if (c === '"') {
        break
      }
      i += 1
    }
    if (i >= text.length) {
      // Unterminated; YAML would have already complained. Skip.
      continue
    }
    const body = text.slice(start, i)
    // Skip empty / single-line / variable-only bodies.
    if (!body.includes('\n')) {
      continue
    }
    // Skip when the body is a single variable expansion like "$VAR" or
    // "${VAR}" — these don't carry markdown into the YAML literal.
    if (/^\s*\$\{?\w+\}?\s*$/.test(body)) {
      continue
    }
    return body
  }
  return undefined
}

export function isWorkflowYaml(filePath: string): boolean {
  // .github/workflows/*.yml or .github/workflows/*.yaml.
  return /[\\/]\.github[\\/]workflows[\\/][^\\/]+\.ya?ml$/.test(filePath)
}

export function readFileSafe(p: string): string {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

// withEditGuard handles the stdin drain, tool_name gate, file_path narrow,
// content extraction (new_string / content), and fail-open on any throw.
await withEditGuard((filePath, content, payload) => {
  if (!isWorkflowYaml(filePath)) {
    return
  }

  // Determine the after-text.
  let afterText: string
  if (payload.tool_name === 'Write') {
    afterText = content ?? ''
  } else {
    const currentText = readFileSafe(filePath)
    const oldStr = (payload.tool_input?.old_string as string | undefined) ?? ''
    const newStr = content ?? ''
    if (!oldStr || !currentText.includes(oldStr)) {
      return
    }
    afterText = currentText.replace(oldStr, newStr)
  }

  const unsafe = findUnsafeBody(afterText)
  if (!unsafe) {
    return
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return
  }

  const preview = unsafe.split('\n').slice(0, 3).join('\\n')
  logger.error(
    [
      '[workflow-multiline-body-guard] Blocked: multi-line --body in workflow YAML',
      '',
      `  File:    ${path.basename(filePath)}`,
      `  Preview: "${preview.slice(0, 80)}..."`,
      '',
      '  Multi-line markdown in `gh ... --body "..."` inside a workflow',
      "  `run:` block breaks YAML parsing. Symptom: GitHub shows '0 jobs'",
      '  on push triggers with no error in the UI (silent CI breakage).',
      '',
      '  Fix — use one of:',
      '',
      '    1. --body-file with heredoc:',
      '         run: |',
      "           cat > /tmp/body.md <<'EOF'",
      '           ## Multi-line markdown OK here',
      '           - bullets, `code`, etc.',
      '           EOF',
      '           gh pr create --body-file /tmp/body.md',
      '',
      '    2. Shell variable from heredoc:',
      '         run: |',
      "           BODY=$(cat <<'EOF'",
      '           ## Content',
      '           EOF',
      '           )',
      '           gh pr create --body "$BODY"',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
      '',
    ].join('\n'),
  )
  process.exitCode = 2
})
