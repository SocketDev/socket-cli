// Claude Code PreToolUse hook — catch-message-guard.
//
// Blocks Edit/Write operations that introduce `${<binding>.message}`
// inside a `catch (<binding>)` block. The bare `.message` access
// silently prints `"undefined"` when the thrown value isn't an
// `Error` — use `errorMessage(<binding>)` instead.
//
// The hook walks the *added* lines (computed from the edit's
// new_string / content), tracks open `catch (<binding>)` regions
// by brace-counting, and flags `${<binding>.message}` reads inside
// those regions. Pre-existing violations in the surrounding file
// are not flagged (the hook is for new regressions).
//
// Bypass: `Allow catch-message bypass` typed verbatim in a recent
// user turn. Per-call-site bypass: `// ok: catch-message <reason>`
// on the offending line.
//
// Skips:
//   - Files outside `*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}`
//   - Test trees (`**/test/**`, `**/tests/**`, `**/__tests__/**`)
//
// Fails open on regex / parse errors.

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { resolveEditedText } from '../_shared/payload.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow catch-message bypass'
const BINDING_BYPASS_PHRASE = 'Allow catch-binding-name bypass'
const PER_LINE_MARKER = /\/\/\s*ok:\s*catch-(?:binding|message)\b/

const JS_TS_EXT_RE = /\.(?:ts|mts|cts|tsx|js|mjs|cjs|jsx)$/i
const TEST_TREE_RE = /(?:^|\/)(?:test|tests|__tests__)\//

// Fleet convention: catch bindings are named `e`. `err` / `error` /
// other names are nudged toward `e` so the convention stays uniform
// (the catch-message rule references `${e.message}` everywhere, so
// keeping the binding name consistent makes the message helper
// suggestions copy-paste cleanly).
const CATCH_WRONG_BINDING_RE =
  /\bcatch\s*\(\s*(?!_|e\s*[):])(?<bind>[A-Za-z_$][\w$]*)\s*(?::[^)]+)?\)\s*\{/g

// Match the opening of a catch block. The binding is captured.
// JS-syntax-only `catch {}` (no binding) is skipped.
const CATCH_OPEN_RE =
  /\bcatch\s*\(\s*(?<binding>[A-Za-z_$][\w$]*)\s*(?::[^)]+)?\)\s*\{/g

interface Finding {
  readonly binding: string
  readonly line: number
  readonly source: string
}

interface BindingFinding {
  readonly line: number
  readonly binding: string
  readonly source: string
}

// Find every `catch (<not-e>)` opening on lines that don't carry the
// per-line marker. Pre-existing violations in the before-text are
// filtered out by the caller.
export function findWrongBindings(after: string): BindingFinding[] {
  const lines = after.split('\n')
  const out: BindingFinding[] = []
  for (let i = 0; i < lines.length; i += 1) {
    /* c8 ignore next - split() always yields strings, never undefined */
    const raw = lines[i] ?? ''
    if (PER_LINE_MARKER.test(raw)) {
      continue
    }
    const code = stripLineComment(raw)
    CATCH_WRONG_BINDING_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = CATCH_WRONG_BINDING_RE.exec(code)) !== null) {
      out.push({
        line: i + 1,
        binding: m.groups!['bind']!,
        source: raw.trim(),
      })
    }
  }
  return out
}

export function isJsOrTs(filePath: string): boolean {
  return JS_TS_EXT_RE.test(filePath)
}

export function isTestTree(filePath: string): boolean {
  return TEST_TREE_RE.test(normalizePath(filePath))
}

// Walk the after-text and find every `${<binding>.message}` inside an
// open `catch (<binding>)` region. Brace counting tracks region depth;
// not a real parser, but precise enough — the false-positive surface
// is "nested function declared inside catch reads its own arg named
// the same as the catch binding," which is rare and the per-line
// marker handles it.
//
// Lines containing the per-line marker are skipped.
export function findCatchMessageViolations(after: string): Finding[] {
  const lines = after.split('\n')
  const findings: Finding[] = []
  const stack: Array<{ binding: string; depth: number }> = []
  let braceDepth = 0
  for (let i = 0; i < lines.length; i += 1) {
    /* c8 ignore next - split() always yields strings, never undefined */
    const raw = lines[i] ?? ''
    if (PER_LINE_MARKER.test(raw)) {
      braceDepth = adjustDepth(raw, braceDepth, stack)
      continue
    }
    // Strip line comments to avoid matching `// catch (x) { ${x.message} }`.
    const code = stripLineComment(raw)
    // Compute pending catch openings on this line. The catch block's
    // `{` IS one of the braces on the line; counting it via
    // adjustDepth would close the previous `try {` first and reopen
    // at the same depth. Defer frame pushes until adjustDepth has
    // processed all braces, then push at the resulting depth.
    let m: RegExpExecArray | null
    CATCH_OPEN_RE.lastIndex = 0
    const pending: string[] = []
    while ((m = CATCH_OPEN_RE.exec(code)) !== null) {
      pending.push(m.groups!.binding!)
    }
    // Look for ${<binding>.message} for any currently-open binding
    // BEFORE updating depth, so the line that closes the catch
    // doesn't lose its frame mid-line.
    if (stack.length > 0) {
      for (let j = 0, { length: len } = stack; j < len; j += 1) {
        const frame = stack[j]!
        const bind = frame.binding
        const bindMessageRe = new RegExp(
          `\\$\\{\\s*${escapeRegex(bind)}\\.message\\b`,
        )
        if (bindMessageRe.test(code)) {
          findings.push({
            binding: bind,
            line: j + 1,
            source: raw.trim(),
          })
        }
      }
    }
    braceDepth = adjustDepth(code, braceDepth, stack)
    for (let j = 0, { length: len } = pending; j < len; j += 1) {
      const binding = pending[j]!
      stack.push({ binding, depth: braceDepth })
    }
  }
  return findings
}

function adjustDepth(
  code: string,
  startDepth: number,
  stack: Array<{ binding: string; depth: number }>,
): number {
  let depth = startDepth
  let inString = false
  let stringChar = ''
  let inTemplate = false
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i]!
    const next = code[i + 1]
    if (inString) {
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === stringChar) {
        inString = false
      }
      continue
    }
    if (inTemplate) {
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === '`') {
        inTemplate = false
      }
      // Skip template expressions for brace counting — `${` inside
      // a template literal opens a sub-expression whose `}` is
      // matched by the template machinery, not by ordinary braces.
      // For our purposes, template-literal contents are opaque.
      if (ch === '$' && next === '{') {
        // Eat until matching `}`.
        let depth2 = 1
        i += 2
        while (i < code.length && depth2 > 0) {
          const c2 = code[i]!
          if (c2 === '{') {
            depth2 += 1
          } else if (c2 === '}') {
            depth2 -= 1
          }
          i += 1
        }
        i -= 1
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      inString = true
      stringChar = ch
      continue
    }
    if (ch === '`') {
      inTemplate = true
      continue
    }
    if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      // Pop any catch-frames whose depth is now > current depth.
      while (stack.length > 0 && stack[stack.length - 1]!.depth > depth) {
        stack.pop()
      }
    }
  }
  return depth
}

function stripLineComment(line: string): string {
  let inString = false
  let stringChar = ''
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    const next = line[i + 1]
    if (inString) {
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === stringChar) {
        inString = false
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true
      stringChar = ch
      continue
    }
    if (ch === '/' && next === '/') {
      return line.slice(0, i)
    }
  }
  return line
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const check = editGuard((filePath, content, payload) => {
  if (!isJsOrTs(filePath) || isTestTree(filePath)) {
    return undefined
  }

  const currentText = safeReadFileSync(filePath) ?? ''
  const afterText = resolveEditedText(payload)
  if (afterText === undefined) {
    return undefined
  }

  // Message-quality check — only NEW violations.
  const beforeMessageFindings = findCatchMessageViolations(currentText).map(
    f => `${f.binding}:${f.source}`,
  )
  const beforeMessageSet = new Set(beforeMessageFindings)
  const afterMessageFindings = findCatchMessageViolations(afterText)
  const newMessageFindings = afterMessageFindings.filter(
    f => !beforeMessageSet.has(`${f.binding}:${f.source}`),
  )

  // Binding-name check — only NEW wrong bindings.
  const beforeBindingFindings = findWrongBindings(currentText).map(
    f => `${f.binding}:${f.source}`,
  )
  const beforeBindingSet = new Set(beforeBindingFindings)
  const afterBindingFindings = findWrongBindings(afterText)
  const newBindingFindings = afterBindingFindings.filter(
    f => !beforeBindingSet.has(`${f.binding}:${f.source}`),
  )

  const hasMessage = newMessageFindings.length > 0
  const hasBinding = newBindingFindings.length > 0
  if (!hasMessage && !hasBinding) {
    return undefined
  }

  const transcript = payload.transcript_path
  const messageBypassed =
    !hasMessage ||
    (transcript ? bypassPhrasePresent(transcript, BYPASS_PHRASE) : false)
  const bindingBypassed =
    !hasBinding ||
    (transcript
      ? bypassPhrasePresent(transcript, BINDING_BYPASS_PHRASE)
      : false)
  if (messageBypassed && bindingBypassed) {
    return undefined
  }

  const lines: string[] = []
  if (hasMessage && !messageBypassed) {
    lines.push(
      '[catch-message-guard] Blocked: bare `${e.message}` in catch block',
      '',
      `  File: ${filePath}`,
      '',
    )
    for (let i = 0, { length } = newMessageFindings; i < length; i += 1) {
      const f = newMessageFindings[i]!
      lines.push(`  • line ${f.line}: ${f.source}`)
    }
    lines.push(
      '',
      '  Bare `${e.message}` prints "undefined" when the caught value',
      '  isn\'t an Error (e.g. `throw "string"`, `throw 42`, non-Error rejections).',
      '',
      '  Fix in workspace packages:',
      '    import { errorMessage } from "@socketsecurity/lib/errors/message"',
      '    ...',
      '    } catch (e) {',
      '      logger.error(`Something failed: ${errorMessage(e)}`)',
      '    }',
      '',
      '  Fix in root scripts/*.mts and CJS *.js (no workspace imports):',
      '    } catch (e) {',
      '      const msg = e instanceof Error ? e.message : String(e)',
      '      logger.error(`Something failed: ${msg}`)',
      '    }',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
      '  Per-line bypass: append "// ok: catch-message <reason>" on the line.',
      '',
    )
  }
  if (hasBinding && !bindingBypassed) {
    if (lines.length > 0) {
      lines.push('')
    }
    lines.push(
      '[catch-message-guard] Blocked: catch binding should be `e`',
      '',
      `  File: ${filePath}`,
      '',
    )
    for (let i = 0, { length } = newBindingFindings; i < length; i += 1) {
      const f = newBindingFindings[i]!
      lines.push(
        `  • line ${f.line}: \`catch (${f.binding})\` — use \`e\` instead`,
      )
    }
    lines.push(
      '',
      '  Fleet convention: catch bindings are named `e`. Other names',
      '  (`err`, `error`, `error_`) drift over time and break the',
      '  copy-paste recipe in `Allow catch-message bypass` reports.',
      '',
      '  Fix: rename the binding to `e`:',
      '',
      '    } catch (e) {',
      '      logger.error(`got: ${errorMessage(e)}`)',
      '    }',
      '',
      `  Bypass: type "${BINDING_BYPASS_PHRASE}" in a new message.`,
      '  Per-line bypass: append "// ok: catch-binding <reason>" on the line.',
      '',
    )
  }
  return block(lines.join('\n'))
})

export const hook = defineHook({
  bypass: ['catch-message', 'catch-binding-name'],
  bypassMode: 'manual',
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
