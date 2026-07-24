/**
 * @file AST literal detectors: `findRegexLiterals`, `findTemplateLiterals`, and
 *   `findThrowNew`. Hooks use these to inspect regex patterns, backtick-string
 *   segments, and thrown-error messages. Import from the specific
 *   `../ast/*.mts` module.
 */

import type { AcornNode, CallSite, ParseOptions } from './core.mts'
import { offsetToLineCol, splitLines, walkSimple } from './core.mts'

export interface RegexLiteralSite extends CallSite {
  /**
   * The regex pattern source (without surrounding `/`).
   */
  pattern: string
  /**
   * The flags string (`g`, `i`, `m`, etc.).
   */
  flags: string
}

/**
 * Find every regex literal (`/pattern/flags`) in `source`. Used by the
 * path-regex-normalize-nudge rule to flag patterns that try to match both
 * path separators inline (`[/\\]`, `[\\\\/]`). Pure regex literals only;
 * doesn't reach into `new RegExp('…')` constructor calls.
 *
 * AST shape: `Literal { regex: { pattern, flags }, value: RegExp }`.
 */
export function findRegexLiterals(
  source: string,
  options?: ParseOptions | undefined,
): RegexLiteralSite[] {
  const matches: RegexLiteralSite[] = []
  const lines = splitLines(source)

  walkSimple(
    source,
    {
      Literal(node) {
        const regex = node['regex'] as
          | { pattern: string; flags: string }
          | undefined
        if (!regex || typeof regex.pattern !== 'string') {
          return
        }
        const start = node['start'] as number | undefined
        if (typeof start !== 'number') {
          return
        }
        const { line, column } = offsetToLineCol(source, start)
        matches.push({
          line,
          column,
          text: (lines[line - 1] ?? '').trim(),
          pattern: regex.pattern,
          flags: regex.flags ?? '',
        })
      },
    },
    options,
  )
  return matches
}

export interface TemplateLiteralSite extends CallSite {
  /**
   * The concatenated quasi (static text) segments of the template, with `${…}`
   * expression slots replaced by a single `\0` NUL byte sentinel. Callers split
   * this on `/`, `.`, etc. to inspect path segments without mistaking
   * interpolated content for a segment.
   *
   * Example: a backtick template with two expression slots and three static
   * parts yields a string with two `\0` sentinels separating those parts.
   */
  segments: string
  /**
   * Number of `${…}` expressions in the template.
   */
  expressionCount: number
}

/**
 * Find every template literal in `source`. Used by hooks that detect
 * multi-segment patterns encoded in backtick strings. Returns the concatenated
 * quasi text with expression slots marked by `\0` so callers can split on path
 * separators without false-positives on interpolated content.
 *
 * Tagged templates (`html`-tagged etc.) are skipped — the tag fundamentally
 * changes the meaning; only bare template literals participate.
 */
export function findTemplateLiterals(
  source: string,
  options?: ParseOptions | undefined,
): TemplateLiteralSite[] {
  const matches: TemplateLiteralSite[] = []
  const lines = splitLines(source)

  walkSimple(
    source,
    {
      TemplateLiteral(node) {
        const start = node['start'] as number | undefined
        if (typeof start !== 'number') {
          return
        }
        // Look backward through whitespace for a tag prefix
        // (Identifier / `)` / `]`). If found, this is a tagged
        // template; the tag changes semantics so we skip.
        let i = start - 1
        // socket-lint: allow uncommented-regex -- whitespace scan, described above.
        while (i >= 0 && /\s/.test(source[i]!)) {
          i -= 1
        }
        // socket-lint: allow uncommented-regex -- tag-prefix char, described above.
        if (i >= 0 && /[\w$)\]]/.test(source[i]!)) {
          return
        }
        const quasis = (node['quasis'] as AcornNode[] | undefined) ?? []
        const parts: string[] = []
        for (let qi = 0; qi < quasis.length; qi += 1) {
          const q = quasis[qi]!
          const value = q['value'] as
            | { raw?: string | undefined; cooked?: string | undefined }
            | undefined
          const cooked = value?.cooked ?? value?.raw ?? ''
          parts.push(cooked)
          if (qi < quasis.length - 1) {
            parts.push('\0')
          }
        }
        const { line, column } = offsetToLineCol(source, start)
        matches.push({
          line,
          column,
          text: (lines[line - 1] ?? '').trim(),
          segments: parts.join(''),
          expressionCount: Math.max(0, quasis.length - 1),
        })
      },
    },
    options,
  )
  return matches
}

export interface ThrowSite extends CallSite {
  /**
   * The constructor name used in `throw new <ctor>(…)`.
   */
  ctorName: string
  /**
   * First-argument source text if a string literal, else undefined.
   */
  message: string | undefined
}

/**
 * Find every `throw new <ctor>(…)` expression in `source`. Used by the
 * error-message-quality rule to inspect the message string of thrown errors.
 * `ctor` semantics:
 *
 * - `undefined` — match every constructor (custom error classes too).
 * - `string` — exact-match `NewExpression.callee.name`.
 * - `RegExp` — match the callee name against the regex. Use this to catch
 *   class-name patterns like `/Error$/` (every *Error class).
 */
export function findThrowNew(
  source: string,
  ctor: string | RegExp | undefined,
  options?: ParseOptions | undefined,
): ThrowSite[] {
  const matches: ThrowSite[] = []
  const lines = splitLines(source)

  walkSimple(
    source,
    {
      ThrowStatement(node) {
        const arg = node['argument'] as AcornNode | undefined
        if (!arg || arg.type !== 'NewExpression') {
          return
        }
        const callee = arg['callee'] as AcornNode | undefined
        if (!callee || callee.type !== 'Identifier') {
          return
        }
        const calleeName = callee['name'] as string
        if (ctor !== undefined) {
          if (typeof ctor === 'string') {
            if (calleeName !== ctor) {
              return
            }
          } else if (!ctor.test(calleeName)) {
            return
          }
        }
        const args = (arg['arguments'] as AcornNode[] | undefined) ?? []
        let message: string | undefined
        const first = args[0]
        if (
          first &&
          first.type === 'Literal' &&
          typeof first['value'] === 'string'
        ) {
          message = first['value'] as string
        }
        const start = node['start'] as number | undefined
        if (typeof start !== 'number') {
          return
        }
        const { line, column } = offsetToLineCol(source, start)
        matches.push({
          line,
          column,
          text: (lines[line - 1] ?? '').trim(),
          ctorName: calleeName,
          message,
        })
      },
    },
    options,
  )
  return matches
}
