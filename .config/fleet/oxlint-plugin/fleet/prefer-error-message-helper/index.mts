/*
 * @file Steer manual error-message extraction to the `errorMessage` helper from
 *   `@socketsecurity/lib/errors/message` (runtime source) /
 *   `@socketsecurity/lib-stable/errors/message` (scripts / tests / hooks). The
 *   helper centralizes cause-chain / aggregate handling and keeps every call
 *   site identical, so a future change (redacting tokens, walking `cause`, etc.)
 *   lands in one place instead of the dozen hand-rolled shapes this rule
 *   catches. Unlike the report-only `prefer-error-message` (which flags only the
 *   canonical `e instanceof Error ? e.message : String(e)` ternary), this rule
 *   is FIXABLE and covers the broader family of manual extractions:
 *
 *   1. `<id> instanceof Error ? <id>.message : String(<id>)` — and the `.stack`
 *      consequent variant `<id> instanceof Error ? <id>.stack : String(<id>)`.
 *   2. `<id>.stack ?? <id>.message` (either order) — the nullish "prefer stack,
 *      fall back to message" chain. Only flagged when BOTH sides are `.stack` /
 *      `.message` members of the SAME identifier; `<id>?.message ?? String(<id>)`
 *      (optional chain, different semantics) is deliberately left alone.
 *   3. `String(<id>)` used as the sole error text of a `logger.error(...)` call
 *      or a bare `throw String(<id>)`.
 *
 *   Autofix: replace the matched expression with `errorMessage(<id>)` and inject
 *   the `import { errorMessage } from …` line if the file doesn't already bind
 *   `errorMessage`. The import specifier is path-aware — scripts / tests / hooks
 *   want the `-stable` devDep alias, runtime source wants the catalog package.
 *   When a file already has a LOCAL `errorMessage` binding that is not that
 *   import (a colliding const / function), the rule reports WITHOUT a fix: the
 *   rewrite would resolve to the wrong binding (mirrors `prefer-exists-sync`).
 */

import {
  appendImportFixes,
  summarizeImportTarget,
} from '../../_shared/inject-import.mts'

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

const ERROR_PROPS = new Set(['message', 'stack'])

/**
 * Identifier name, or undefined for any other node.
 */
function identifierName(node: AstNode | undefined): string | undefined {
  if (!node || node.type !== 'Identifier') {
    return undefined
  }
  return node.name
}

/**
 * True when `node` is a non-computed `<name>.<prop>` where `prop` is one of the
 * error text properties (`message` / `stack`).
 */
function errorMemberProp(
  node: AstNode | undefined,
  name: string,
): string | undefined {
  if (!node || node.type !== 'MemberExpression' || node.computed) {
    return undefined
  }
  if (
    node.property?.type !== 'Identifier' ||
    !ERROR_PROPS.has(node.property.name)
  ) {
    return undefined
  }
  if (identifierName(node.object) !== name) {
    return undefined
  }
  return node.property.name
}

/**
 * The identifier name inside `String(<id>)`, or undefined when `node` is not a
 * single-argument `String(<Identifier>)` call.
 */
function stringCallArgName(node: AstNode | undefined): string | undefined {
  if (!node || node.type !== 'CallExpression') {
    return undefined
  }
  const { callee } = node
  if (!callee || callee.type !== 'Identifier' || callee.name !== 'String') {
    return undefined
  }
  const args = node.arguments ?? []
  if (args.length !== 1) {
    return undefined
  }
  return identifierName(args[0])
}

/**
 * True when `node` is `<name> instanceof Error`.
 */
function isInstanceOfError(node: AstNode | undefined, name: string): boolean {
  return (
    !!node &&
    node.type === 'BinaryExpression' &&
    node.operator === 'instanceof' &&
    identifierName(node.left) === name &&
    identifierName(node.right) === 'Error'
  )
}

/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer errorMessage(e) from @socketsecurity/lib/errors/message over hand-rolled error-message extraction (instanceof-Error ternary, stack ?? message chain, String(e) as sole logger.error / throw text).',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      preferErrorMessageHelper:
        'Manual error-message extraction — use `errorMessage({{name}})` from `@socketsecurity/lib/errors/message` (runtime source) / `@socketsecurity/lib-stable/errors/message` (scripts / tests / hooks). It centralizes cause-chain / aggregate handling and keeps every call site identical.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    const filename = context.filename ?? context.getFilename?.() ?? ''

    let summary: ReturnType<typeof summarizeImportTarget> | undefined

    function ensureSummary() {
      if (summary) {
        return summary
      }
      // localName === importName: a file that already binds `errorMessage`
      // (import, const, or function) is detected so the fix neither injects a
      // duplicate import nor rewrites into a colliding local binding.
      summary = summarizeImportTarget(
        sourceCode.ast,
        'errorMessage',
        'errorMessage',
      )
      return summary
    }

    function importLine(): string {
      const normalized = filename.replace(/\\/g, '/')
      // Scripts / tests / hooks / .config tooling depend on the `-stable`
      // devDep alias; runtime source uses the catalog package. Mirrors the
      // guidance in the sibling `prefer-error-message` rule's message.
      const stable =
        /(?:^|\/)scripts\//.test(normalized) ||
        /(?:^|\/)tests?\//.test(normalized) ||
        /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized) ||
        normalized.includes('/.claude/hooks/') ||
        normalized.includes('/.config/')
      const specifier = stable
        ? '@socketsecurity/lib-stable/errors/message'
        : '@socketsecurity/lib/errors/message'
      return `import { errorMessage } from '${specifier}'`
    }

    /**
     * Report `node` (the whole matched expression) and, when safe, autofix it
     * to `errorMessage(<name>)` plus the missing import.
     */
    function reportPreferHelper(node: AstNode, name: string): void {
      const s = ensureSummary()
      // A local `errorMessage` binding that is NOT the helper import (a const /
      // function / default-import shadow): rewriting to `errorMessage(...)`
      // would resolve to it. Report without a fix.
      if (s.hasLocal && !s.hasImport) {
        context.report({
          node,
          messageId: 'preferErrorMessageHelper',
          data: { name },
        })
        return
      }
      context.report({
        node,
        messageId: 'preferErrorMessageHelper',
        data: { name },
        fix(fixer: RuleFixer) {
          return [
            fixer.replaceText(node, `errorMessage(${name})`),
            // appendImportFixes self-guards on summary.hasImport, so an
            // already-imported file gets the rewrite with no duplicate import.
            ...appendImportFixes(s, fixer, importLine(), undefined),
          ]
        },
      })
    }

    return {
      // Pattern 1: `<id> instanceof Error ? <id>.message : String(<id>)`
      // (and the `.stack` consequent variant).
      ConditionalExpression(node: AstNode) {
        const name = identifierName(node.test?.left)
        if (!name || !isInstanceOfError(node.test, name)) {
          return
        }
        if (!errorMemberProp(node.consequent, name)) {
          return
        }
        if (stringCallArgName(node.alternate) !== name) {
          return
        }
        reportPreferHelper(node, name)
      },

      // Pattern 2: `<id>.stack ?? <id>.message` (either order) — both sides
      // `.stack` / `.message` members of the same identifier.
      LogicalExpression(node: AstNode) {
        if (node.operator !== '??') {
          return
        }
        const name = identifierName(node.left?.object)
        if (!name) {
          return
        }
        const leftProp = errorMemberProp(node.left, name)
        const rightProp = errorMemberProp(node.right, name)
        if (!leftProp || !rightProp || leftProp === rightProp) {
          return
        }
        reportPreferHelper(node, name)
      },

      // Pattern 3: `String(<id>)` as the sole text of `logger.error(...)` or a
      // bare `throw String(<id>)`.
      CallExpression(node: AstNode) {
        const name = stringCallArgName(node)
        if (!name) {
          return
        }
        const parent = node.parent
        if (!parent) {
          return
        }
        // `throw String(<id>)`
        if (parent.type === 'ThrowStatement' && parent.argument === node) {
          reportPreferHelper(node, name)
          return
        }
        // `<obj>.error(String(<id>))` — String(<id>) is the sole argument.
        if (
          parent.type === 'CallExpression' &&
          parent.callee?.type === 'MemberExpression' &&
          !parent.callee.computed &&
          parent.callee.property?.type === 'Identifier' &&
          parent.callee.property.name === 'error' &&
          (parent.arguments?.length ?? 0) === 1 &&
          parent.arguments[0] === node
        ) {
          reportPreferHelper(node, name)
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
