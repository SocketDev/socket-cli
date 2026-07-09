#!/usr/bin/env node
// Claude Code PreToolUse hook — prefer-fn-decl-guard.
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
// Verdict:
//   block  — at least one banned const-fn-expression found.
//   notify — found but bypassed via the phrase.
//   allow  — no banned shape (silent).
//
// Fails open on malformed payloads via runGuard.

import {
  block,
  defineHook,
  editGuard,
  notify,
  runHook,
} from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

interface Finding {
  readonly line: number
  readonly name: string
  readonly text: string
}

// Module-scope `const`/`let`/`var` binding to an arrow or function
// expression. The leading anchor `^` plus the `(?:export\s+)?` prefix
// ensures we only match top-level declarations — anything indented is
// inside a function/block scope and outside the rule's autofix scope.
// Capture 1 holds the optional `export ` keyword (matched, not used, so a
// future autofix can preserve it); capture 2 holds the identifier reported
// in the finding. The trailing alternation scans past the `=` for the `=>`
// arrow or the `function` token that proves this is a function expression.
const ARROW_DECL_RE =
  /^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/gm
// Same structure as ARROW_DECL_RE but ends with the `function` keyword
// followed by an optional generator `*` and a parameter list, matching
// `const foo = function() {}` and `const foo = async function* () {}`.
const FUNCEXPR_DECL_RE =
  /^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?function\s*\*?\s*(?:\([^)]*\))/gm

const BYPASS_PHRASE = 'Allow function-declaration bypass'

// Files where the rule legitimately appears in fixtures: this hook's own
// tests + the oxlint rule's tests. Plus any `_internal/` dir, generated
// output (dist/build/node_modules), and the rule's own implementation
// files (which discuss the banned shapes in comments + matchers).
export function isExemptPath(filePath: string): boolean {
  return (
    normalizePath(filePath).includes('/_internal/') ||
    normalizePath(filePath).includes('/dist/') ||
    normalizePath(filePath).includes('/build/') ||
    normalizePath(filePath).includes('/node_modules/') ||
    normalizePath(filePath).includes(
      '/.claude/hooks/fleet/prefer-fn-decl-guard/',
    ) ||
    // The rule lives at .config/fleet/oxlint-plugin/fleet/prefer-function-declaration/
    // (index.mts + test/), embedding the const-arrow shape it bans as rule data;
    // the per-rule dir prefix exempts both files.
    normalizePath(filePath).includes(
      '/.config/fleet/oxlint-plugin/fleet/prefer-function-declaration/',
    )
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
  /* c8 ignore start - both regexes require `=` so eqIdx is never -1 in practice */
  if (eqIdx === -1) {
    return false
  }
  /* c8 ignore stop */
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

// editGuard handles the tool_name gate, file_path narrow, content
// extraction (new_string / content), and the fleet-managed-path narrow.
export const check = editGuard(
  (filePath, content, payload) => {
    if (isExemptPath(filePath)) {
      return undefined
    }

    // Only police TS/JS source. Allow .cts/.mts/.cjs/.mjs/.ts/.tsx/.js/.jsx.
    if (!/\.(?:c|m)?[jt]sx?$/.test(filePath)) {
      return undefined
    }

    const text = content ?? ''
    if (!text) {
      return undefined
    }

    const findings = findConstFnExpressions(text)
    if (findings.length === 0) {
      return undefined
    }

    if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      return notify(
        `prefer-fn-decl-guard: ${findings.length} const-fn-expression(s) — bypassed via "${BYPASS_PHRASE}"\n`,
      )
    }

    const lines = findings
      .map(f => `  ${filePath}:${f.line}  ${f.name}\n    ${f.text}`)
      .join('\n')
    return block(
      `prefer-fn-decl-guard: refusing to introduce module-scope const-bound function expression(s).\n` +
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
