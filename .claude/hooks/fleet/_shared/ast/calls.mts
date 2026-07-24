/**
 * @file AST call-site detectors: `findBareCallsTo` (a bare `Identifier(...)`
 *   call) + `findMemberCalls` (`<object>.<property>(...)`). Hooks use these to
 *   flag a specific global or dotted API without false-positives on strings,
 *   comments, or same-named member methods. Import from the specific
 *   `../ast/*.mts` module.
 */

import type { AcornNode, CallSite, ParseOptions } from './core.mts'
import { offsetToLineCol, splitLines, walkSimple } from './core.mts'

/**
 * Find every BARE call to the named identifier in `source`. "Bare" means the
 * callee is an `Identifier` node (not a `MemberExpression`) — so
 * `structuredClone(x)` matches but `obj.structuredClone(x)` does not. Hook
 * callers use this to flag a specific global-function call without
 * false-positives on member-call methods that happen to share the name.
 *
 * Skips calls whose immediately-preceding line contains `//
 * oxlint-disable-next-line <ruleName>` (matching the lint rule's per-line
 * opt-out shape). The marker comes through as plain text in the source, so we
 * re-scan around each match for it.
 *
 * Returns an empty array on parse failure (fragment tolerance).
 */
export function findBareCallsTo(
  source: string,
  identifierName: string,
  options?:
    | (ParseOptions & {
        /**
         * Optional lint-rule name. When provided, calls whose preceding line
         * contains `oxlint-disable-next-line <ruleName>` are filtered out.
         */
        oxlintRuleName?: string | undefined
      })
    | undefined,
): CallSite[] {
  const opts = { __proto__: null, ...options } as typeof options
  const matches: CallSite[] = []
  const lines = splitLines(source)
  const disableMarker = opts?.oxlintRuleName
    ? `oxlint-disable-next-line ${opts.oxlintRuleName}`
    : undefined

  walkSimple(
    source,
    {
      CallExpression(node) {
        const callee = node['callee'] as AcornNode | undefined
        if (!callee || callee.type !== 'Identifier') {
          return
        }
        if ((callee['name'] as string) !== identifierName) {
          return
        }
        const start = node['start'] as number | undefined
        if (typeof start !== 'number') {
          return
        }
        const { line, column } = offsetToLineCol(source, start)
        if (disableMarker && line >= 2) {
          const prev = lines[line - 2] ?? ''
          if (prev.includes(disableMarker)) {
            return
          }
        }
        matches.push({
          line,
          column,
          text: (lines[line - 1] ?? '').trim(),
        })
      },
    },
    options,
  )
  return matches
}

export interface MemberCallSite extends CallSite {
  /**
   * First-argument source text if a string literal, else undefined.
   */
  firstStringArg: string | undefined
  /**
   * Leading STATIC text of the first argument — the string value when it is a
   * string literal, or the cooked text of the FIRST quasi when it is a template
   * literal (`\`  ✗ ${x}\`` → `'  ✗ '`). Undefined for any other first-arg
   * shape. Lets callers inspect a prefix (status glyph, indent) regardless of
   * whether the author wrote a plain string or a template.
   */
  firstArgLeadingText: string | undefined
  /**
   * Number of arguments (positional + spreads).
   */
  argCount: number
  /**
   * True when every argument is a string Literal (callers use this for
   * "all-literal call site" detection like path.join('a', 'b', 'c')).
   */
  allStringLiteralArgs: boolean
}

/**
 * Find every `<object>.<property>(...)` member-call in `source`. Used by hooks
 * that want to flag specific known APIs (`console.log`, `path.join`,
 * `process.stdout.write`, etc.) without false-positives on string literals or
 * comments that happen to mention the same dotted name.
 *
 * `object` and `property` are matched exactly. To match `process.stdout.write`
 * (a 3-segment member expression), pass `object: 'process.stdout'` — the helper
 * accepts dotted object paths and walks the nested `MemberExpression`s to
 * confirm the chain.
 */
export function findMemberCalls(
  source: string,
  object: string,
  property: string,
  options?: ParseOptions | undefined,
): MemberCallSite[] {
  const matches: MemberCallSite[] = []
  const lines = splitLines(source)
  const objectChain = object.split('.')

  function calleeMatches(callee: AcornNode | undefined): boolean {
    if (!callee || callee.type !== 'MemberExpression') {
      return false
    }
    const prop = callee['property'] as AcornNode | undefined
    if (
      !prop ||
      prop.type !== 'Identifier' ||
      (prop['name'] as string) !== property
    ) {
      return false
    }
    let head: AcornNode | undefined = callee['object'] as AcornNode | undefined
    // Walk the dotted chain right-to-left. For object='process.stdout',
    // we expect head to be MemberExpression{object: process, property: stdout}.
    for (let i = objectChain.length - 1; i >= 0; i -= 1) {
      const segment = objectChain[i]!
      if (i === 0) {
        // Leftmost segment must be an Identifier.
        if (!head || head.type !== 'Identifier') {
          return false
        }
        return (head['name'] as string) === segment
      }
      // Inner segments are MemberExpression{property: segment}.
      if (!head || head.type !== 'MemberExpression') {
        return false
      }
      const innerProp = head['property'] as AcornNode | undefined
      if (
        !innerProp ||
        innerProp.type !== 'Identifier' ||
        (innerProp['name'] as string) !== segment
      ) {
        return false
      }
      head = head['object'] as AcornNode | undefined
    }
    return true
  }

  walkSimple(
    source,
    {
      CallExpression(node) {
        if (!calleeMatches(node['callee'] as AcornNode | undefined)) {
          return
        }
        const start = node['start'] as number | undefined
        if (typeof start !== 'number') {
          return
        }
        const args = (node['arguments'] as AcornNode[] | undefined) ?? []
        let firstStringArg: string | undefined
        let firstArgLeadingText: string | undefined
        let allStringLiteralArgs = args.length > 0
        for (let i = 0; i < args.length; i += 1) {
          const arg = args[i]!
          const isStringLit =
            arg.type === 'Literal' && typeof arg['value'] === 'string'
          if (!isStringLit) {
            allStringLiteralArgs = false
          }
          if (i === 0) {
            if (isStringLit) {
              firstStringArg = arg['value'] as string
              firstArgLeadingText = firstStringArg
            } else if (arg.type === 'TemplateLiteral') {
              const quasis = arg['quasis'] as AcornNode[] | undefined
              const cooked = (
                quasis?.[0]?.['value'] as
                  | { cooked?: string | undefined }
                  | undefined
              )?.cooked
              if (typeof cooked === 'string') {
                firstArgLeadingText = cooked
              }
            }
          }
        }
        const { line, column } = offsetToLineCol(source, start)
        matches.push({
          line,
          column,
          text: (lines[line - 1] ?? '').trim(),
          firstStringArg,
          firstArgLeadingText,
          argCount: args.length,
          allStringLiteralArgs,
        })
      },
    },
    options,
  )
  return matches
}
