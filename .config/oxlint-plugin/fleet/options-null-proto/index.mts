/**
 * @file Per the fleet options convention: a function that reads an `options` /
 *   `opts` parameter must first normalize it with `{ __proto__: null,
 *   ...options }` before destructuring or property-access. The null prototype
 *   defends against a caller passing an object with a polluted prototype (a
 *   `__proto__` / inherited property masquerading as an option); reading the
 *   raw param lets that pollution flow into the function's logic. socket-lib
 *   does this in ~125 modules (`const { cwd } = { __proto__: null, ...options }
 *   as Opts`); this rule holds the rest of the fleet to it. Flags a function
 *   with a param named `options` / `opts` whose body reads it (a `const { … } =
 *   options` destructure, or an `options.x` / `options?.x` member access)
 *   without a `{ __proto__: null, ...options }` spread present in the body.
 *   Autofixed both ways with an `as typeof <name>` cast (a closed options type
 *   rejects the `__proto__` excess property without it): the destructure form
 *   rewrites `const { … } = options` to `const { … } = { __proto__: null,
 *   ...options } as typeof options`; a member-access reader gets a normalizing
 *   reassignment `options = { __proto__: null, ...options } as typeof options`
 *   prepended to the body. A function that passes `options` straight through
 *   untouched (never reads a property) is not flagged. Test files (`*.test.*`,
 *   `/test/`) are skipped — they mock options-shaped literals, not production
 *   readers. Bypass: a `socket-lint: allow options-null-proto` comment.
 */

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const BYPASS_RE = /socket-lint:\s*allow\s+options-null-proto/

const OPTIONS_NAMES = new Set(['options', 'opts'])

// A param whose name is `options` / `opts` (plain Identifier or optional
// `options?:`). Returns the name, or undefined.
function optionsParamName(params: AstNode[]): string | undefined {
  for (let i = 0, { length } = params; i < length; i += 1) {
    const p = params[i]
    if (p?.type === 'Identifier' && OPTIONS_NAMES.has(p.name)) {
      return p.name
    }
  }
  return undefined
}

// Does `body` source already contain a `{ __proto__: null, ...<name> }`
// normalization? A cheap source-substring check on the function body keeps the
// rule simple and avoids deep AST matching of the spread.
function hasNullProtoNormalization(bodyText: string, name: string): boolean {
  return bodyText.includes('__proto__: null') && bodyText.includes(`...${name}`)
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A function reading an `options`/`opts` param must normalize it via `{ __proto__: null, ...options }` first (prototype-pollution defense).',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      banned:
        'reads `{{name}}` without normalizing it — a caller could pass a polluted prototype. Use `{ __proto__: null, ...{{name}} }` before destructuring/accessing. Bypass: add a `socket-lint: allow options-null-proto` comment.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(context, BYPASS_RE)
    const source = context.sourceCode ?? context.getSourceCode?.()

    // Test files mock options-shaped objects freely (a `function(opts)` test
    // helper isn't a production options reader, and a mock's closed literal type
    // rejects the `__proto__` spread). The prototype-pollution defense is for
    // shipped src; skip `*.test.*` and `/test/` trees.
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (/\.test\.[cm]?[jt]sx?$/.test(filename) || /[/\\]test[/\\]/.test(filename)) {
      return {}
    }

    function check(node: AstNode): void {
      if (node.body == null) {
        return
      }
      const params = node.params
      if (!Array.isArray(params)) {
        return
      }
      const name = optionsParamName(params)
      if (!name) {
        return
      }
      if (hasBypassComment(node)) {
        return
      }
      const bodyText = source?.getText?.(node.body) ?? ''
      if (hasNullProtoNormalization(bodyText, name)) {
        return
      }

      // Find the first read of the param: a `const { … } = options`
      // destructure (fixable) or any `options.<x>` / `options?.<x>` member
      // access (report only). Walk the body's statements shallowly.
      let firstDestructure: AstNode | undefined
      let readsMember = false

      const visit = (n: AstNode | undefined): void => {
        if (!n || typeof n !== 'object') {
          return
        }
        if (
          n.type === 'VariableDeclarator' &&
          n.id?.type === 'ObjectPattern' &&
          n.init?.type === 'Identifier' &&
          n.init.name === name &&
          !firstDestructure
        ) {
          firstDestructure = n
        }
        if (
          n.type === 'MemberExpression' &&
          n.object?.type === 'Identifier' &&
          n.object.name === name
        ) {
          readsMember = true
        }
        for (const key of Object.keys(n)) {
          if (key === 'parent') {
            continue
          }
          const child = (n as Record<string, unknown>)[key]
          if (Array.isArray(child)) {
            for (let i = 0, { length } = child; i < length; i += 1) {
              visit(child[i] as AstNode)
            }
          } else if (child && typeof child === 'object') {
            visit(child as AstNode)
          }
        }
      }
      visit(node.body)

      if (!firstDestructure && !readsMember) {
        // Param is passed through untouched — nothing to normalize.
        return
      }

      // Fix strategy:
      //   - a `const { … } = options` destructure → rewrite its init to the
      //     normalized spread (precise, no extra statement).
      //   - otherwise (member-access readers) → insert a normalizing
      //     reassignment as the first statement of the function body, so every
      //     later `options.x` read sees the null-proto object. Only possible
      //     when the body is a block `{ … }` (an expression-bodied arrow has no
      //     statement list to prepend to — reported without a fix).
      const body = node.body
      const canInsert =
        body?.type === 'BlockStatement' && Array.isArray(body.body)
      const indent = '  '

      context.report({
        node: firstDestructure ?? node,
        messageId: 'banned',
        data: { name },
        fix(fixer: {
          replaceText: (n: AstNode, text: string) => unknown
          insertTextBefore: (n: AstNode, text: string) => unknown
        }) {
          // Both forms append `as typeof <name>`: a closed options type (one
          // with no index signature) rejects the `__proto__` excess property
          // (TS2353) on the bare spread, and the param's own type erases it.
          // This matches the canonical fleet form `{ __proto__: null, ...opts }
          // as Opts` (here `typeof opts`, since the rule can't name the type).
          if (firstDestructure?.init) {
            return fixer.replaceText(
              firstDestructure.init,
              `{ __proto__: null, ...${name} } as typeof ${name}`,
            )
          }
          const first = canInsert ? body.body[0] : undefined
          if (first) {
            return fixer.insertTextBefore(
              first,
              `${name} = { __proto__: null, ...${name} } as typeof ${name}\n${indent}`,
            )
          }
          return undefined
        },
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
