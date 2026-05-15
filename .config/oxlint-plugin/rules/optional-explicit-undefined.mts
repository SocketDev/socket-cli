/**
 * @fileoverview Enforce `foo?: T | undefined` over `foo?: T` on
 * interface / type-literal properties. Pairs with
 * `exactOptionalPropertyTypes: true` (set in tsconfig.base.json) so the
 * value `undefined` is a separately-modeled state from "property
 * omitted." With both, you can write either form at the call site; in
 * mixed-codebase code, both happen, so we require both to be allowed.
 *
 * Applies to `.ts`, `.cts`, `.mts` files. JS (`.js`, `.cjs`, `.mjs`)
 * has no type annotations to enforce.
 *
 * Triggers on:
 *   - Interface members:   `interface X { foo?: string }`
 *   - Type-literal members: `type X = { foo?: string }`
 *   - Class fields with `?` and no initializer:
 *     `class X { foo?: string }`
 *
 * Skips:
 *   - Properties that are already `?: T | undefined` (or any union
 *     containing `undefined`).
 *   - Function parameters with `?` — convention there is different
 *     (`?` already implies optional + undefined at the call site).
 *   - Mapped types (`{ [K in keyof T]?: T[K] }`) — the `?` is a
 *     transform operator, not a property declaration.
 *
 * Autofix appends ` | undefined` to the type annotation.
 *
 * Why this matters: with `exactOptionalPropertyTypes: true`, a call
 * site that writes `{ foo: undefined }` is rejected when the type says
 * only `foo?: T`. Mixed-codebase code does both (build options
 * objects, JSON-derived parsed config, REST API responses) and the
 * `| undefined` makes the contract honest.
 */

/** @type {import('eslint').Rule.RuleModule} */

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require `?: T | undefined` (not bare `?: T`) on type-literal and interface properties to pair with `exactOptionalPropertyTypes`.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      missingUndefined:
        'Optional property `{{name}}` should be typed as `{{name}}?: {{type}} | undefined` to pair with `exactOptionalPropertyTypes`.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    // Plugin runs against all extensions; we only enforce on TS files.
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (!/\.(?:ts|cts|mts)$/.test(filename)) {
      return {}
    }

    /**
     * True when `typeAnnotation` already includes `undefined` somewhere
     * in its top-level union. Recursive into TSUnionType so
     * `T | (U | undefined)` (rare) still passes.
     */
    function hasUndefined(typeAnnotation: AstNode | undefined): boolean {
      if (!typeAnnotation) {
        return false
      }
      if (typeAnnotation.type === 'TSUndefinedKeyword') {
        return true
      }
      if (typeAnnotation.type === 'TSUnionType') {
        for (const t of typeAnnotation.types) {
          if (hasUndefined(t)) {
            return true
          }
        }
      }
      // `T | null` doesn't count — we want explicit `undefined`.
      return false
    }

    /**
     * Pull the property name token for the error message. Handles
     * Identifier keys (`foo?:`), Literal keys (`'foo'?:`), and
     * computed keys (skipped via "unknown").
     */
    function keyName(node: AstNode) {
      const k = node.key
      if (!k) return 'property'
      if (k.type === 'Identifier') return k.name
      if (k.type === 'Literal' && typeof k.value === 'string') return k.value
      return 'property'
    }

    /**
     * Source-text snippet of the type annotation for the error message
     * + the fix. Tolerant of missing source ranges.
     */
    function typeText(node: AstNode) {
      const ann = node.typeAnnotation?.typeAnnotation
      if (!ann || !ann.range) return 'T'
      const src = context.sourceCode ?? context.getSourceCode?.()
      if (!src) return 'T'
      return src.text.slice(ann.range[0], ann.range[1])
    }

    function check(node: AstNode) {
      // Only optional members.
      if (!node.optional) {
        return
      }
      // Must have a type annotation; bare `foo?` (no `:`) gets implicit
      // `any` and isn't our concern.
      const ann = node.typeAnnotation?.typeAnnotation
      if (!ann) {
        return
      }
      // Already explicit.
      if (hasUndefined(ann)) {
        return
      }
      const name = keyName(node)
      const type = typeText(node)
      context.report({
        node: ann,
        messageId: 'missingUndefined',
        data: { name, type },
        fix(fixer: RuleFixer) {
          // Append ` | undefined` after the existing annotation text.
          return fixer.insertTextAfter(ann, ' | undefined')
        },
      })
    }

    return {
      TSPropertySignature: check,
      // Class fields. ESLint's TS estree calls these PropertyDefinition
      // when in a class. The `?` -> `optional: true` shape matches.
      PropertyDefinition: check,
    }
  },
}

export default rule
