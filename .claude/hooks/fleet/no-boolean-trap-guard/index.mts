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

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withEditGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow boolean-trap bypass'

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
  /\b([A-Za-z_$][A-Za-z0-9_$]*)\??:\s*boolean(?:\s*\|\s*(?:undefined|null))?\b/g

// Detect that a line is a function/method header with params.
const FUNC_HEADER_RE =
  /\b(?:async\s+)?(?:function\s*\*?\s*[A-Za-z_$][A-Za-z0-9_$]*|(?:export\s+(?:default\s+)?|private\s+|protected\s+|public\s+|static\s+|abstract\s+|override\s+)*(?:async\s+)?function|(?:export\s+(?:default\s+)?)?(?:async\s+)?\b[A-Za-z_$][A-Za-z0-9_$]*)\s*[<(]/

export function findBooleanTrapParams(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    // Only flag lines that look like a function/method parameter list.
    if (!FUNC_HEADER_RE.test(line) && !line.trim().startsWith('(')) {
      continue
    }
    // Count commas to know whether there are multiple params. A boolean
    // as the ONLY param is a predicate pattern — leave it alone.
    const commaCount = (line.match(/,/g) ?? []).length
    if (commaCount === 0) {
      continue
    }
    BOOL_PARAM_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = BOOL_PARAM_RE.exec(line)) !== null) {
      const param = m[1]!
      findings.push({ line: i + 1, text: line.trim(), param })
    }
  }
  return findings
}

export function isExemptPath(filePath: string): boolean {
  return (
    filePath.includes('/dist/') ||
    filePath.includes('/build/') ||
    filePath.includes('/node_modules/') ||
    filePath.includes('/.claude/hooks/fleet/no-boolean-trap-guard/')
  )
}

if (process.argv[1]?.endsWith('index.mts')) {
  await withEditGuard((filePath, content, payload) => {
    if (isExemptPath(filePath)) {
      return
    }
    if (!/\.(?:c|m)?tsx?$/.test(filePath)) {
      return
    }
    const text = content ?? ''
    if (!text) {
      return
    }
    const findings = findBooleanTrapParams(text)
    if (findings.length === 0) {
      return
    }
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      logger.error(
        `no-boolean-trap-guard: ${findings.length} boolean-trap param(s) — bypassed via "${BYPASS_PHRASE}"\n`,
      )
      return
    }
    const lines = findings
      .map(f => `  ${filePath}:${f.line}  param \`${f.param}\`\n    ${f.text}`)
      .join('\n')
    logger.error(
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
        `See docs/agents.md/fleet/options-object.md for the full recipe.\n` +
        `Bypass: type "${BYPASS_PHRASE}" in a recent message.\n`,
    )
    process.exitCode = 2
  }, { fleetOnly: true })
}
