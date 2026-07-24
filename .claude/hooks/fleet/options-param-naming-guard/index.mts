#!/usr/bin/env node
// Claude Code PreToolUse hook — options-param-naming-guard.
//
// Blocks Edit/Write tool calls that introduce a function whose options-bag
// param is named `opts` into a `.ts` / `.mts` / `.cts` / `.js` / `.mjs` /
// `.cjs` file. The fleet options convention names the PARAM `options` and the
// normalized local it produces `opts` (`const opts = { __proto__: null,
// ...options }`). A param named `opts` makes the raw input wear the "safe"
// name, conflating it with its null-proto-safe form.
//
// This is the edit-time half of the defense-in-depth pair; the lint half is
// `socket/options-param-naming` (which also autofixes the rename). The guard
// catches the anti-pattern at write time, before lint runs.
//
// What's enforced:
//   - A function (declaration / expression / arrow) with a param that is a
//     plain Identifier named `opts`. Detected by AST, parsed via the vendored
//     acorn-wasm in `_shared/ast/` — which fully parses TypeScript, so a
//     typed `opts?: { … }` param is matched on its Identifier name, never on
//     a regex over the type-annotation text.
//   - Destructured params (`{ opts }`), rest params, and a `.opts` PROPERTY or
//     `{ opts: number }` type member are NOT flagged — they are not a param
//     binding named `opts`.
//   - `.d.ts` mirrors (external-package signatures) and test files are exempt.
//   - A line carrying `// socket-lint: allow options-param-naming` (same line
//     as the param or the line before the function) is exempt for one-offs.
//
// Bypass phrase: `Allow options-param-naming bypass` (whole session).
//
// Fragment tolerance: Edit's `new_string` is a snippet that may not parse
// standalone. `tryParse` returns undefined on parse failure and the hook stays
// fail-open. The hook fails OPEN on its own bugs (exit 0 + stderr log) so a
// bad deploy can't brick the session.

import { offsetToLineCol, tryParse } from '../_shared/ast/core.mts'
import type { AcornNode } from '../_shared/ast/core.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

const ALLOW_MARKER = '// socket-lint: allow options-param-naming'
const BANNED_PARAM_NAME = 'opts'

// File extensions where the convention applies. `.d.ts` is handled separately
// (it mirrors external signatures and is always exempt).
const APPLICABLE_EXTS = new Set(['.cjs', '.cts', '.js', '.mjs', '.mts', '.ts'])

const FUNCTION_NODE_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
])

export interface Offense {
  line: number
}

export function isApplicable(filePath: string): boolean {
  if (filePath.endsWith('.d.ts') || filePath.endsWith('.d.mts')) {
    return false
  }
  if (
    /\.test\.[cm]?[jt]sx?$/.test(filePath) ||
    /[/\\]test[/\\]/.test(filePath)
  ) {
    return false
  }
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) {
    return false
  }
  return APPLICABLE_EXTS.has(filePath.slice(dot))
}

// Walk the AST and collect the source offset of every function param that is a
// plain Identifier named `opts`. Destructured / rest params and any `opts`
// that is a property or type member are not param Identifiers, so they never
// appear here. Pure AST — no regex over source structure.
export function findOptsParams(source: string): number[] {
  // No options: the `_shared/ast/core.mts` defaults already enable TypeScript and the
  // fleet's ES2026 floor, which is exactly what a hook parsing `.ts`/`.mts`
  // source wants.
  const ast = tryParse(source)
  if (!ast) {
    return []
  }
  const offsets: number[] = []
  const visit = (node: AcornNode | undefined): void => {
    if (!node || typeof node !== 'object') {
      return
    }
    const type = (node as { type?: string | undefined }).type
    if (typeof type === 'string' && FUNCTION_NODE_TYPES.has(type)) {
      const params = (node as { params?: AcornNode[] | undefined }).params
      /* c8 ignore next - acorn always emits params as an array on function nodes; defensive type-guard */
      if (Array.isArray(params)) {
        for (let i = 0, { length } = params; i < length; i += 1) {
          const p = params[i] as
            | {
                type?: string | undefined
                name?: string | undefined
                start?: number | undefined
              }
            | undefined
          if (p?.type === 'Identifier' && p.name === BANNED_PARAM_NAME) {
            /* c8 ignore next - acorn always sets start on Identifier nodes; defensive fallback */
            offsets.push(p.start ?? 0)
          }
        }
      }
    }
    const keyList = Object.keys(node)
    for (let j = 0, { length: jlen } = keyList; j < jlen; j += 1) {
      const key = keyList[j]!
      /* c8 ignore start - acorn never emits a parent back-reference; defensive guard for enriched ASTs */
      if (key === 'parent') {
        continue
      }
      /* c8 ignore stop */
      const child = (node as Record<string, unknown>)[key]
      if (Array.isArray(child)) {
        for (let i = 0, { length } = child; i < length; i += 1) {
          visit(child[i] as AcornNode)
        }
      } else if (child && typeof child === 'object') {
        visit(child as AcornNode)
      }
    }
  }
  visit(ast)
  return offsets
}

// Drop offenses whose param line, or the line immediately above the enclosing
// function, carries the per-line allow marker.
export function applyAllowMarkerFilter(
  source: string,
  offsets: number[],
): Offense[] {
  const lines = source.split('\n')
  const out: Offense[] = []
  for (let i = 0, { length } = offsets; i < length; i += 1) {
    const { line } = offsetToLineCol(source, offsets[i]!)
    /* c8 ignore next - offsetToLineCol always maps to an existing line; defensive fallback */
    const onLine = lines[line - 1] ?? ''
    /* c8 ignore next - lines[line-2] is always present when line>=2 for valid source; defensive fallback */
    const prev = line >= 2 ? (lines[line - 2] ?? '') : ''
    if (onLine.includes(ALLOW_MARKER) || prev.includes(ALLOW_MARKER)) {
      continue
    }
    out.push({ line })
  }
  return out
}

export const check = editGuard((filePath, content, payload) => {
  if (!isApplicable(filePath)) {
    return undefined
  }
  const proposed = content ?? ''
  const offenses = applyAllowMarkerFilter(proposed, findOptsParams(proposed))
  if (offenses.length === 0) {
    return undefined
  }
  const where = offenses
    .map(o => `    line ${o.line}: a param named \`opts\``)
    .join('\n')
  return block(
    `[options-param-naming-guard] refusing edit: ` +
      `${offenses.length} function param${offenses.length === 1 ? '' : 's'} ` +
      `named \`opts\`:\n` +
      where +
      '\n\n' +
      'The options-bag param is named `options`; `opts` is reserved for the\n' +
      'normalized local it produces:\n' +
      '\n' +
      '  function f(options?: Opts) {\n' +
      '    const opts = { __proto__: null, ...options } as Opts\n' +
      '    return opts.cwd\n' +
      '  }\n' +
      '\n' +
      'A param named `opts` conflates the raw input with its null-proto-safe\n' +
      'form. Rename the param to `options` (the `socket/options-param-naming`\n' +
      'lint rule autofixes this).\n' +
      '\n' +
      `One-off override: add \`${ALLOW_MARKER}\` on the param line or the\n` +
      'line above the function.\n',
  )
})

export const hook = defineHook({
  bypass: ['options-param-naming'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
