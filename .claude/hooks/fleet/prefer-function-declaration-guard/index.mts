#!/usr/bin/env node
// Claude Code PreToolUse hook — prefer-function-declaration-guard.
//
// Edit-time partner of the `socket/prefer-function-declaration` oxlint
// rule. Blocks Write/Edit ops that introduce a module-scope `const`-bound
// function expression — `export const foo = () => {}`,
// `const foo = function () {}`, etc. The oxlint rule autofixes at commit
// time, but by then the agent has burned a turn writing the wrong shape
// (and may push the file to a downstream consumer that re-reads it).
// Catching at edit time keeps the agent from learning the wrong pattern.
//
// Banned shapes (module scope only — leading whitespace == top level):
//   export const foo = (...) => { ... }
//   export const foo = async (...) => expr
//   export const foo = function (...) { ... }
//   const foo = (...) => { ... }                  (no leading whitespace)
//   const foo = async () => { ... }
//   const foo = function () { ... }
//
// Allowed (passes through):
//   - Indented `const foo = () => ...` — that's an inner-function
//     expression, not module-scope; arrows correctly inherit `this`.
//   - `const foo: SomeType = () => ...` — TS type annotation locks the
//     contract; refactor requires human judgment.
//   - `const foo = (... rest of complex destructuring ...) = ...` —
//     non-Identifier declarators; let the human untangle.
//   - `_internal/` files, `dist/`, `build/`, `node_modules/`.
//   - Bypass phrase `Allow function-declaration bypass` in a recent turn.
//
// Reads PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit"|"Write",
//     "tool_input": { "file_path": "...", "content"|"new_string": "..." } }
//
// Exit codes:
//   0 — pass.
//   2 — block (at least one banned const-fn-expression found).
//
// Fails open on malformed payloads (exit 0 + stderr log).

import process from 'node:process'

import { bypassPhrasePresent } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_input?:
    | {
        readonly content?: string | undefined
        readonly file_path?: string | undefined
        readonly new_string?: string | undefined
        readonly old_string?: string | undefined
      }
    | undefined
  readonly tool_name?: string | undefined
  readonly transcript_path?: string | undefined
}

interface Finding {
  readonly line: number
  readonly name: string
  readonly text: string
}

// Module-scope `const`/`let`/`var` binding to an arrow or function
// expression. The leading anchor `^` plus the `(?:export\s+)?` prefix
// ensures we only match top-level declarations — anything indented is
// inside a function/block scope and outside the rule's autofix scope.
// Group 1: 'export ' or '' — preserved so a future autofix could keep
// the export keyword (not used here, only matched).
// Group 2: identifier.
// Group 3: '=' tail, used to scan for the `=>` arrow or `function` token
// further on.
const ARROW_DECL_RE =
  /^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/gm
const FUNCEXPR_DECL_RE =
  /^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?function\s*\*?\s*(?:\([^)]*\))/gm

const BYPASS_PHRASE = 'Allow function-declaration bypass'

// Files where the rule legitimately appears in fixtures: this hook's own
// tests + the oxlint rule's tests. Plus any `_internal/` dir, generated
// output (dist/build/node_modules), and the rule's own implementation
// files (which discuss the banned shapes in comments + matchers).
export function isExemptPath(filePath: string): boolean {
  return (
    filePath.includes('/_internal/') ||
    filePath.includes('/dist/') ||
    filePath.includes('/build/') ||
    filePath.includes('/node_modules/') ||
    filePath.includes(
      '/.claude/hooks/fleet/prefer-function-declaration-guard/',
    ) ||
    filePath.includes(
      '/.config/oxlint-plugin/rules/prefer-function-declaration.',
    ) ||
    filePath.includes('/.config/oxlint-plugin/test/prefer-function-declaration')
  )
}

// `const foo: SomeType = () => ...` — the type annotation makes the
// arrow form the contract. Refactor would need to drop the annotation
// or migrate it to `satisfies`. The oxlint rule skips this shape too.
function hasTypeAnnotation(line: string): boolean {
  // Cheap detection: a `:` between the identifier and the `=`. False
  // positives on object-destructuring patterns are gated above by the
  // identifier-only declarator match — patterns like `const { a }: T =`
  // never reach this check.
  const eqIdx = line.indexOf('=')
  if (eqIdx === -1) {
    return false
  }
  const lhs = line.slice(0, eqIdx)
  return lhs.includes(':')
}

export function findConstFnExpressions(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    // Reset stateful flags before each scan.
    ARROW_DECL_RE.lastIndex = 0
    FUNCEXPR_DECL_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = ARROW_DECL_RE.exec(line)) !== null) {
      if (hasTypeAnnotation(line)) {
        continue
      }
      findings.push({ line: i + 1, name: m[2]!, text: line.trimEnd() })
    }
    while ((m = FUNCEXPR_DECL_RE.exec(line)) !== null) {
      if (hasTypeAnnotation(line)) {
        continue
      }
      findings.push({ line: i + 1, name: m[2]!, text: line.trimEnd() })
    }
  }
  return findings
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main(): Promise<void> {
  let payload: ToolInput
  try {
    const raw = await readStdin()
    payload = JSON.parse(raw) as ToolInput
  } catch (err) {
    process.stderr.write(
      `prefer-function-declaration-guard: payload parse failed (${(err as Error).message})\n`,
    )
    process.exit(0)
  }

  const toolName = payload.tool_name
  if (toolName !== 'Edit' && toolName !== 'Write') {
    process.exit(0)
  }

  const filePath = payload.tool_input?.file_path ?? ''
  if (!filePath || isExemptPath(filePath)) {
    process.exit(0)
  }

  // Only police TS/JS source. Allow .cts/.mts/.cjs/.mjs/.ts/.tsx/.js/.jsx.
  if (!/\.(?:c|m)?[jt]sx?$/.test(filePath)) {
    process.exit(0)
  }

  const text =
    payload.tool_input?.content ?? payload.tool_input?.new_string ?? ''
  if (!text) {
    process.exit(0)
  }

  const findings = findConstFnExpressions(text)
  if (findings.length === 0) {
    process.exit(0)
  }

  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    process.stderr.write(
      `prefer-function-declaration-guard: ${findings.length} const-fn-expression(s) — bypassed via "${BYPASS_PHRASE}"\n`,
    )
    process.exit(0)
  }

  const lines = findings
    .map(f => `  ${filePath}:${f.line}  ${f.name}\n    ${f.text}`)
    .join('\n')
  process.stderr.write(
    `prefer-function-declaration-guard: refusing to introduce module-scope const-bound function expression(s).\n` +
      `\n` +
      `${lines}\n` +
      `\n` +
      `Use a function declaration instead:\n` +
      `  export function foo() { ... }    (not  export const foo = () => ...)\n` +
      `  function foo() { ... }            (not  const foo = function () ...)\n` +
      `\n` +
      `Function declarations hoist, have a stable .name in stack traces, and\n` +
      `sort cleanly under socket/sort-source-methods. The companion oxlint\n` +
      `rule \`socket/prefer-function-declaration\` autofixes at commit time,\n` +
      `but at the cost of a wasted turn writing the wrong shape.\n` +
      `\n` +
      `Bypass: type "${BYPASS_PHRASE}" in a recent message.\n`,
  )
  process.exit(2)
}

main().catch(err => {
  process.stderr.write(
    `prefer-function-declaration-guard: ${(err as Error).message}\n`,
  )
  process.exit(0)
})
