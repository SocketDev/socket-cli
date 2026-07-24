#!/usr/bin/env node
// Claude Code PreToolUse hook — no-boolean-trap-guard.
//
// Blocks Write/Edit ops that introduce a boolean positional parameter
// in a TypeScript function signature — the "boolean trap" antipattern
// (https://ariya.io/2011/08/hall-of-api-shame-boolean-trap).
//
// A boolean positional forces callers to write `foo(x, true)` where the
// `true` is meaningless at the call site. The fix: take an options
// object instead. Fleet pattern:
//
//   options?: TypedOptions | undefined        // param declaration
//   TypedOptions = { foo?: bar | undefined }  // interface definition
//   const opts = { __proto__: null, ...options } as TypedOptions  // body
//
// Banned shapes:
//   function f(x: string, flag: boolean) { … }
//   function f(a: T, b: boolean, c: boolean) { … }
//   async function f(x: T, dry?: boolean) { … }
//   export function f(x: T, verbose: boolean | undefined) { … }
//
// Allowed (passes through):
//   - A single boolean param with NO other params — pure predicate
//     (`function isValid(value: boolean): boolean`).
//   - Overload signatures (no body — these are type-only contracts and
//     are resolved by the implementation).
//   - Generated / vendor files (dist/, build/, node_modules/).
//   - This guard's own source + tests.
//   - Bypass: `Allow boolean-trap bypass` in a recent turn.
//
// Exit codes: 0 pass, 2 block. Fails open on malformed payloads.

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { isRepoTestHome } from '../_shared/repo-test-home.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

interface Finding {
  readonly line: number
  readonly text: string
  readonly param: string
}

// Match a function signature line that has AT LEAST TWO params and at
// least one of them is typed boolean/boolean|undefined/boolean?.
// Pattern: `function name(` or `)(` continuation — we scan per line for
// the inline single-line case; multi-line signatures are flagged when
// a line contains a boolean param AND the enclosing paren context has
// other params on the same line (simple heuristic).
//
// We detect: a parameter name followed by `?:` or `:` and then
// `boolean` (optionally `| undefined` or `| null`), when the line
// also contains a comma (other params present) or is a multi-param
// function header.
const BOOL_PARAM_RE =
  /\b([A-Za-z_$][A-Za-z0-9_$]*)\??:\s*boolean(?:\s*\|\s*(?:null|undefined))?\b/g

// Detect that a line is a function/method header with params.
const FUNC_HEADER_RE =
  /\b(?:async\s+)?(?:function\s*\*?\s*[A-Za-z_$][A-Za-z0-9_$]*|(?:abstract\s+|export\s+(?:default\s+)?|override\s+|private\s+|protected\s+|public\s+|static\s+)*(?:async\s+)?function|(?:export\s+(?:default\s+)?)?(?:async\s+)?\b[A-Za-z_$][A-Za-z0-9_$]*)\s*[<(]/

/**
 * The substring inside the first balanced `(...)` on a line — the parameter
 * list, excluding the return-type annotation that follows `)`. Returns
 * undefined when the line has no `(` or the parens don't close on this line
 * (a multi-line signature). Balances `()[]{}` so a nested object-type param
 * or default value doesn't end the list early. This is what stops a
 * return-type field (`): { ok: boolean }`) from being read as a param.
 */
export function paramListSpan(line: string): string | undefined {
  const open = line.indexOf('(')
  if (open === -1) {
    return undefined
  }
  let depth = 0
  for (let i = open, { length } = line; i < length; i += 1) {
    const ch = line[i]!
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1
      if (depth === 0) {
        return line.slice(open + 1, i)
      }
    }
  }
  return undefined
}

/**
 * Blank out every character nested inside a `{...}`, `[...]`, or `(...)` group
 * within a parameter-list span, preserving length and the top-level structure.
 * A boolean that is a PROPERTY of an object-type literal
 * (`props: { active?: boolean }`), an ELEMENT of a tuple type
 * (`pair: [boolean, string]`), or a PARAMETER of a callback-type
 * (`cb: (x: boolean) => void`) is not a top-level positional boolean trap of
 * the function being declared — only a bare `name: boolean` at the param
 * list's top level is. Blanking nested groups also drops their inner commas so
 * the multi-param check counts only real param separators.
 */
export function stripNestedTypeGroups(paramList: string): string {
  let depth = 0
  let out = ''
  for (let i = 0, { length } = paramList; i < length; i += 1) {
    const ch = paramList[i]!
    if (ch === '(' || ch === '[' || ch === '{') {
      out += depth === 0 ? ch : ' '
      depth += 1
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1)
      out += depth === 0 ? ch : ' '
    } else {
      out += depth === 0 ? ch : ' '
    }
  }
  return out
}

export function findBooleanTrapParams(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    // Only flag lines that look like a function/method parameter list.
    if (!FUNC_HEADER_RE.test(line) && !line.trim().startsWith('(')) {
      continue
    }
    // Scan ONLY the parameter list, never the return-type annotation after
    // `)` — a `{ ok: boolean }` return type is not a boolean-trap param.
    // Then blank nested type groups so a boolean PROPERTY/element/callback-param
    // inside a param's type (`opts: { active?: boolean }`) is never read as a
    // top-level positional boolean.
    const scanText = stripNestedTypeGroups(paramListSpan(line) ?? line)
    // Count commas to know whether there are multiple params. A boolean
    // as the ONLY param is a predicate pattern — leave it alone.
    const commaCount = (scanText.match(/,/g) ?? []).length
    if (commaCount === 0) {
      continue
    }
    BOOL_PARAM_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = BOOL_PARAM_RE.exec(scanText)) !== null) {
      const param = m[1]!
      findings.push({ line: i + 1, text: line.trim(), param })
    }
  }
  return findings
}

export function isExemptPath(filePath: string): boolean {
  return (
    normalizePath(filePath).includes('/dist/') ||
    normalizePath(filePath).includes('/build/') ||
    normalizePath(filePath).includes('/node_modules/') ||
    normalizePath(filePath).includes(
      '/.claude/hooks/fleet/no-boolean-trap-guard/',
    ) ||
    isRepoTestHome(filePath)
  )
}

export const check = editGuard(
  (filePath, content) => {
    if (isExemptPath(filePath)) {
      return undefined
    }
    // Match TypeScript file extensions: .ts, .mts, .cts, .tsx, .mtsx, .ctsx.
    if (!/\.(?:c|m)?tsx?$/.test(filePath)) {
      return undefined
    }
    const text = content ?? ''
    if (!text) {
      return undefined
    }
    const findings = findBooleanTrapParams(text)
    if (findings.length === 0) {
      return undefined
    }
    const lines = findings
      .map(f => `  ${filePath}:${f.line}  param \`${f.param}\`\n    ${f.text}`)
      .join('\n')
    return block(
      `no-boolean-trap-guard: refusing to introduce a boolean positional parameter.\n` +
        `\n` +
        `${lines}\n` +
        `\n` +
        `A boolean positional forces callers to write foo(x, true) where\n` +
        `the \`true\` is meaningless at the call site. Use an options object:\n` +
        `\n` +
        `  // instead of:  function foo(x: T, dry: boolean)\n` +
        `  export interface FooOptions { dry?: boolean | undefined }\n` +
        `  export function foo(x: T, options?: FooOptions | undefined): void {\n` +
        `    const opts = { __proto__: null, ...options } as FooOptions\n` +
        `    const dry = opts.dry === true\n` +
        `    …\n` +
        `  }\n` +
        `\n` +
        `See docs/agents.md/fleet/options-object.md for the full recipe.\n`,
    )
  },
  { fleetOnly: true },
)

export const hook = defineHook({
  bypass: ['boolean-trap'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
