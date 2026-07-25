/*
 * @file An option the caller MUST pass is not an option. Options bags are
 *   all-optional: a required member belongs positionally before the bag
 *   (`fn(required, options?)`) or in a required `config` bag. This rule flags
 *   a required property/method member in:
 *
 *   - an interface or object type alias named `*Options`, and
 *   - an inline object type on a param named `options`/`opts`.
 *
 *   Born from `createBackoff({ initialMs, factor?, maxMs? })` — the required
 *   `initialMs` hid inside the bag until review hoisted it to
 *   `createBackoff(ms, options?)`. Report-only (never auto-fixed): hoisting a
 *   member reshapes the API and every call site, so the author does it.
 *   Skips `.d.ts` (mirrors external signatures) and test files (throwaway
 *   helpers). Bypass: a `socket-lint: allow no-required-in-options-bag`
 *   comment.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const BYPASS_RE = /socket-lint:\s*allow\s+no-required-in-options-bag/

const OPTIONS_PARAM_NAMES = new Set(['options', 'opts'])

// Members that can carry a `?` marker; anything else (index signatures,
// call signatures) has no per-member optionality to police.
function isOptionalityMember(member: AstNode): boolean {
  return (
    member.type === 'TSMethodSignature' || member.type === 'TSPropertySignature'
  )
}

// The members of an object type node, or undefined when the node is not an
// object literal type (a union, a mapped type, an imported reference).
function typeLiteralMembers(node: AstNode | undefined): AstNode[] | undefined {
  if (node?.type === 'TSTypeLiteral' && Array.isArray(node.members)) {
    return node.members as AstNode[]
  }
  return undefined
}

// Resolve a param to its Identifier (unwrapping a default-value pattern), or
// undefined for binding patterns with no single name.
function paramIdentifier(param: AstNode | undefined): AstNode | undefined {
  if (!param || typeof param !== 'object') {
    return undefined
  }
  if (param.type === 'AssignmentPattern') {
    const left = param.left as AstNode | undefined
    return left?.type === 'Identifier' ? left : undefined
  }
  return param.type === 'Identifier' ? param : undefined
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Options bags are all-optional — a required member is positional or lives in a `config` bag.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    schema: [],
    messages: {
      requiredInOptionsBag:
        'a required member in an options bag — an option the caller MUST pass is not an option; hoist it to a positional parameter (`fn(required, options?)`) or move the bag to a required `config`. Bypass: add a `socket-lint: allow no-required-in-options-bag` comment.',
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

    function reportRequiredMembers(owner: AstNode, members: AstNode[]): void {
      for (let i = 0, { length } = members; i < length; i += 1) {
        const member = members[i]!
        if (isOptionalityMember(member) && member.optional !== true) {
          if (!hasBypassComment(owner)) {
            context.report({
              node: member,
              messageId: 'requiredInOptionsBag',
            })
          }
        }
      }
    }

    function checkFunction(node: AstNode): void {
      const params = node.params
      if (!Array.isArray(params)) {
        return
      }
      for (let i = 0, { length } = params; i < length; i += 1) {
        const ident = paramIdentifier(params[i])
        if (
          !ident ||
          typeof ident.name !== 'string' ||
          !OPTIONS_PARAM_NAMES.has(ident.name)
        ) {
          continue
        }
        const annotation = ident.typeAnnotation as AstNode | undefined
        const members = typeLiteralMembers(
          annotation?.typeAnnotation as AstNode | undefined,
        )
        if (members) {
          reportRequiredMembers(node, members)
        }
      }
    }

    return {
      ArrowFunctionExpression: checkFunction,
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      TSInterfaceDeclaration(node: AstNode) {
        const id = node.id as AstNode | undefined
        const body = node.body as AstNode | undefined
        if (
          typeof id?.name === 'string' &&
          id.name.endsWith('Options') &&
          Array.isArray(body?.body)
        ) {
          reportRequiredMembers(node, body.body as AstNode[])
        }
      },
      TSTypeAliasDeclaration(node: AstNode) {
        const id = node.id as AstNode | undefined
        const members = typeLiteralMembers(
          node.typeAnnotation as AstNode | undefined,
        )
        if (
          typeof id?.name === 'string' &&
          id.name.endsWith('Options') &&
          members
        ) {
          reportRequiredMembers(node, members)
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
