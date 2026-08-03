/*
 * @file Sibling of `no-boolean-trap-param` for the other positional
 *   anti-pattern: a TAIL OF OPTIONAL POSITIONALS. A signature like
 *   `download(url, dest, integrity?, sha256?, createWriteStream?, headers?)`
 *   forces a caller who wants only the last one to write
 *   `download(url, dest, undefined, undefined, undefined, headers)` — three
 *   meaningless placeholders whose correctness depends on counting commas.
 *   Adding a parameter later is a silent breaking change for anyone who
 *   passed positionally, and reordering is impossible. Pass an options object:
 *   `download(url, dest, { headers })`.
 *
 *   Flags a function (declaration / expression / arrow / method) whose
 *   parameter list ENDS in `threshold` or more optional positionals — optional
 *   meaning `x?: T`, `x: T | undefined`, or a default (`x = v`). Default
 *   threshold is 3, so the common `(value, options?)` and `(a, b?, c?)` shapes
 *   stay legal and only a genuine pile-up is reported. Configure with
 *   `["error", { "threshold": 2 }]`.
 *
 *   Reporting only — collapsing the tail into an options object rewrites every
 *   call site, so it can't be auto-applied. Skipped:
 *
 *   - A rest param (`...args`) — variadic by design, not a placeholder trap.
 *   - A tail already made of destructured object patterns — that IS the fix.
 *   - Overload signatures (no function body — type-only contracts).
 *   - Bypass: a `socket-lint: allow optional-positional-trap` comment.
 */

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// socket-lint: allow optional-positional-trap -- opt-out for a signature whose
// optional tail is fixed by an external contract we do not own.
const BYPASS_RE = /socket-lint:\s*allow\s+optional-positional-trap/

const DEFAULT_THRESHOLD = 3

// A param is optional when it is written `x?: T`, annotated with a union that
// includes `undefined`, or carries a default value. All three let a caller omit
// it, which is what creates the placeholder tail.
function isOptionalParam(param: AstNode): boolean {
  if (!param) {
    return false
  }
  if (param.type === 'AssignmentPattern') {
    return true
  }
  if (param.optional === true) {
    return true
  }
  const ann = param?.typeAnnotation?.typeAnnotation
  if (ann?.type === 'TSUnionType' && Array.isArray(ann.types)) {
    return ann.types.some((t: AstNode) => t?.type === 'TSUndefinedKeyword')
  }
  return false
}

// An object pattern (`{ headers }`) or a param annotated with a type literal is
// already the options-bag shape this rule asks for.
function isOptionsBag(param: AstNode): boolean {
  if (!param) {
    return false
  }
  const target = param.type === 'AssignmentPattern' ? param.left : param
  if (target?.type === 'ObjectPattern') {
    return true
  }
  const ann = target?.typeAnnotation?.typeAnnotation
  if (!ann) {
    return false
  }
  if (ann.type === 'TSTypeLiteral') {
    return true
  }
  if (ann.type === 'TSUnionType' && Array.isArray(ann.types)) {
    return ann.types.some((t: AstNode) => t?.type === 'TSTypeLiteral')
  }
  return false
}

/**
 * How many parameters at the END of `params` are optional positionals. Stops at
 * the first required param, a rest element, or an options bag — anything that
 * breaks the placeholder chain.
 */
export function countOptionalTail(params: readonly AstNode[]): number {
  let count = 0
  for (let i = params.length - 1; i >= 0; i -= 1) {
    const p = params[i]!
    if (p.type === 'RestElement' || isOptionsBag(p) || !isOptionalParam(p)) {
      break
    }
    count += 1
  }
  return count
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'No pile-up of trailing optional positional params — collapse the tail into an options object. Sibling of socket/no-boolean-trap-param.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      banned:
        '{{count}} trailing optional positional params ({{names}}) — a caller who wants only the last one must pass `undefined` placeholders for the rest, and adding a param later silently breaks positional callers. Collapse them into one options object: `fn(…, { {{names}} })`. Bypass: add a `socket-lint: allow optional-positional-trap` comment.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          threshold: { type: 'integer', minimum: 2 },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(context, BYPASS_RE)
    const configured = context.options?.[0]?.threshold
    const threshold =
      typeof configured === 'number' && configured >= 2
        ? configured
        : DEFAULT_THRESHOLD

    function check(node: AstNode): void {
      // Overload / type-only signatures have no body — skip.
      if (node.body == null) {
        return
      }
      const params = node.params
      if (!Array.isArray(params) || params.length < threshold) {
        return
      }
      const count = countOptionalTail(params)
      if (count < threshold) {
        return
      }
      if (hasBypassComment(node)) {
        return
      }
      const tail = params.slice(params.length - count)
      const names = tail
        .map((p: AstNode) => {
          const target = p.type === 'AssignmentPattern' ? p.left : p
          return target?.type === 'Identifier' ? target.name : 'arg'
        })
        .join(', ')
      context.report({
        node: tail[0]!,
        messageId: 'banned',
        data: { count: String(count), names },
      })
    }

    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
