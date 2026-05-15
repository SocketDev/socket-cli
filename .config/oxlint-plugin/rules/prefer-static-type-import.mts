/**
 * @fileoverview Flag inline `import('module').Name` type expressions —
 * use a static `import type { Name } from 'module'` at the top of the
 * file instead.
 *
 * Inline-import type expressions read worse than the static form for
 * three reasons:
 *
 *   1. Repeat usages duplicate the module path at every annotation site,
 *      so renaming the module is a multi-edit instead of a one-line
 *      header change.
 *   2. The reader has to parse the type expression to discover what's
 *      imported; a static `import type { Remap, Spinner }` advertises
 *      the file's external dependencies at the top.
 *   3. Bundlers / language servers can deduplicate static imports more
 *      reliably than inline ones; some tools (oxfmt, prettier-tsdoc)
 *      don't reformat inline-import expressions consistently.
 *
 * Detects:
 *   - `import('module').Name` (TSImportType AST node — TypeScript's
 *     type-context import expression). Captures the module specifier
 *     plus the qualifier (the property name read off the imported
 *     namespace).
 *
 * No autofix:
 *   - Adding a static `import type` requires choosing a unique local
 *     name and inserting at the correct sort position. The fleet's
 *     `sort-named-imports` + `prefer-separate-type-import` rules
 *     already enforce the import-header shape; rather than racing them
 *     with a half-built rewrite, this rule reports the violation and
 *     leaves the lift to the human (one-line edit anyway).
 *
 * Allowed exceptions (skipped — no report):
 *   - `typeof import('module')` namespace forms (TSImportType wrapped
 *     in TSTypeQuery). The static equivalent is
 *     `import * as Foo from 'module'` followed by `typeof Foo`, which
 *     is heavier than the inline form for one-shot uses.
 *
 * Why a rule and not just a code-style note: socket-lib drift incident
 * 2026-05-14 — `SpawnOptions` accumulated inline-import properties
 * (`spinner?: import('../spinner/types').Spinner`) over time. When the
 * type was extended for a sibling `NodeSpawnSyncOptions`, the inline
 * shape duplicated the same module path again. A static
 * `import type { Spinner } from '../spinner/types'` makes the extension
 * a no-edit at the type-spec level.
 */

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer a static `import type { X } from "mod"` over inline `import("mod").X` type expressions.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      preferStaticTypeImport:
        'Inline `import("{{source}}").{{name}}` type expression — replace with a static `import type {{names}} from "{{source}}"` at the top of the file.',
      preferStaticTypeImportNoQualifier:
        'Inline `import("{{source}}")` namespace type — replace with a static `import type * as <Name> from "{{source}}"` at the top of the file.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    return {
      // TypeScript-AST node for `import('mod').Name` in a type position.
      TSImportType(node: AstNode) {
        // Skip when wrapped in `typeof import(...)` — those have no
        // single-import static rewrite that reads better than the inline
        // form. Recognized by the AST parent being a TSTypeQuery.
        const parent = node.parent
        if (parent && parent.type === 'TSTypeQuery') {
          return
        }

        // The argument is the literal `'mod'` source. Older AST shapes
        // expose it as `node.argument.literal.value`; newer shapes use
        // `node.argument.value` directly. Cover both.
        const argument = node.argument
        const source =
          argument && argument.type === 'TSLiteralType' && argument.literal
            ? argument.literal.value
            : argument && typeof argument.value === 'string'
              ? argument.value
              : undefined
        if (typeof source !== 'string') {
          return
        }

        // The qualifier is the dotted property name (the `Name` in
        // `import('mod').Name`). A bare `import('mod')` with no
        // qualifier is the namespace form — still worth flagging, but
        // with the namespace message.
        const qualifier = node.qualifier
        if (!qualifier) {
          context.report({
            node,
            messageId: 'preferStaticTypeImportNoQualifier',
            data: { source },
          })
          return
        }

        // Qualifiers can be nested (e.g. `import('mod').A.B`) — walk
        // to the leaf and pick the leftmost identifier as the named
        // import the user wants.
        let leftmost: AstNode = qualifier
        while (leftmost.left) {
          leftmost = leftmost.left
        }
        const name =
          leftmost.type === 'Identifier' && typeof leftmost.name === 'string'
            ? leftmost.name
            : undefined
        if (!name) {
          return
        }

        context.report({
          node,
          messageId: 'preferStaticTypeImport',
          data: {
            source,
            name,
            names: `{ ${name} }`,
          },
        })
      },
    }
  },
}

export default rule
