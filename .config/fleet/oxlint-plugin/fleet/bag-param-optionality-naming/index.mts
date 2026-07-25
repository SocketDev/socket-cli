/*
 * @file The fleet names an object-bag parameter by its OPTIONALITY: a bag the
 *   caller may omit is `options` (optional — `options?: T` or `options: T = {}`),
 *   and a bag the caller must pass is `config` (required — `config: T`). The
 *   normalized null-proto local mirrors the param: `opts` for `options`, `cfg`
 *   for `config` (`const cfg = { __proto__: null, ...config }`). This rule flags
 *   the two reserved param names when their optionality contradicts the name:
 *
 *   - a REQUIRED param named `options` → should be `config`
 *   - an OPTIONAL param named `config` → should be `options`
 *
 *   Only those two names are in scope (the established convention words), so an
 *   arbitrary object param (`spawnResult: {…}`, a domain object) is never
 *   touched — this enforces ONE convention, not a synonym hunt. Report-only (no
 *   auto-fix): renaming a param + its in-body reads without a whole-function
 *   binding-resolution pass risks a collision, so the author does the rename
 *   (matching `options-param-naming`'s report-only stance). Skips `.d.ts`
 *   (mirrors external signatures) and test files (throwaway helpers). Bypass: a
 *   `socket-lint: allow bag-param-optionality-naming` comment.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const BYPASS_RE = /socket-lint:\s*allow\s+bag-param-optionality-naming/

interface ParamName {
  readonly node: AstNode
  readonly name: string
  readonly optional: boolean
}

// Resolve a param node to its binding name + whether the caller may omit it.
// `options?: T` → an Identifier with `.optional`; `options: T = {}` → an
// AssignmentPattern whose `.left` is the Identifier (a default makes it
// omittable); `config: T` → a required Identifier. Non-identifier binding
// patterns (ObjectPattern rest, etc.) have no single name and return undefined.
function paramName(param: AstNode | undefined): ParamName | undefined {
  if (!param || typeof param !== 'object') {
    return undefined
  }
  if (param.type === 'AssignmentPattern') {
    const left = param.left as AstNode | undefined
    if (left?.type === 'Identifier' && typeof left.name === 'string') {
      return { node: left, name: left.name, optional: true }
    }
    return undefined
  }
  if (param.type === 'Identifier' && typeof param.name === 'string') {
    return { node: param, name: param.name, optional: param.optional === true }
  }
  return undefined
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Name an object-bag param by optionality: optional → `options`, required → `config`.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    schema: [],
    messages: {
      requiredShouldBeConfig:
        'a REQUIRED options-bag param must be named `config` (normalized local `cfg`), not `options` — `options` is reserved for an OPTIONAL bag. Bypass: add a `socket-lint: allow bag-param-optionality-naming` comment.',
      optionalShouldBeOptions:
        'an OPTIONAL options-bag param must be named `options` (normalized local `opts`), not `config` — `config` is reserved for a REQUIRED bag. Bypass: add a `socket-lint: allow bag-param-optionality-naming` comment.',
    },
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(context, BYPASS_RE)
    // Normalize once, then every check runs on the same `/`-separated path;
    // the directory test is a plain segment check, not a separator regex.
    const filename = normalizePath(
      context.filename ?? context.getFilename?.() ?? '',
    )
    if (
      /\.d\.[cm]?ts$/.test(filename) ||
      /\.test\.[cm]?[jt]sx?$/.test(filename) ||
      filename.includes('/test/') ||
      filename.startsWith('test/')
    ) {
      return {}
    }

    function check(node: AstNode): void {
      const params = node.params
      if (!Array.isArray(params)) {
        return
      }
      for (let i = 0, { length } = params; i < length; i += 1) {
        const info = paramName(params[i])
        if (!info) {
          continue
        }
        if (info.name === 'options' && !info.optional) {
          if (!hasBypassComment(node)) {
            context.report({
              node: info.node,
              messageId: 'requiredShouldBeConfig',
            })
          }
        } else if (info.name === 'config' && info.optional) {
          if (!hasBypassComment(node)) {
            context.report({
              node: info.node,
              messageId: 'optionalShouldBeOptions',
            })
          }
        }
      }
    }

    return {
      ArrowFunctionExpression: check,
      FunctionDeclaration: check,
      FunctionExpression: check,
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
