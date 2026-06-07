/**
 * @file Forbid underscore-prefixed _identifiers_ (functions, variables,
 *   classes, interfaces, type aliases, imports). Function PARAMETERS are
 *   excluded — there a leading `_` is TypeScript's own sanctioned marker for an
 *   intentionally-unused param under `noUnusedParameters` (TS6133), so banning
 *   it would conflict with the compiler. Privacy in TypeScript is handled by
 *   module boundaries (not exporting) or by the `_internal/` _directory_
 *   pattern — not by leading underscores on symbol names. The
 *   underscore-as-internal-marker convention is borrowed from other languages
 *   where it has runtime meaning (Python name mangling, Ruby visibility); in TS
 *   the underscore is decorative and adds noise to `git blame` and IDE
 *   autocomplete. Commit-time partner of the edit-time
 *   `.claude/hooks/fleet/no-underscore-ident-guard/`. Allowed (skipped by this
 *   rule):
 *
 *   - Bare `_` as a throwaway (`for (const _ of arr)`, destructuring rest).
 *   - Files under any `_internal/` directory — the canonical structural pattern
 *     for module-private files. The rule is about identifiers inside files, not
 *     folder layout.
 *   - Files matched by oxlint's default exclude list (dist, build, node_modules).
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const UNDERSCORE_NAME_RE = /^_[A-Za-z]/

// Node CJS exposes `__dirname` and `__filename` as module-scoped free
// variables. ESM modules conventionally re-create them with
// `path.dirname(fileURLToPath(import.meta.url))` etc., which means the
// identifiers appear in a `const ... = ...` declaration. Treat those
// declarations as allowed — they're not a `_internal` marker, they're
// matching Node's published names.
const ALLOWED_FREE_VARS = new Set(['__dirname', '__filename'])

function isInInternalDir(filename: string): boolean {
  return filename.includes('/_internal/')
}

function checkIdentifier(
  context: RuleContext,
  node: AstNode,
  name: string | undefined,
): void {
  if (!name || !UNDERSCORE_NAME_RE.test(name)) {
    return
  }
  if (ALLOWED_FREE_VARS.has(name)) {
    return
  }
  context.report({
    node,
    messageId: 'noUnderscoreIdentifier',
    data: { name },
  })
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Forbid underscore-prefixed identifiers — use module boundaries or `_internal/` directories for privacy.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    messages: {
      noUnderscoreIdentifier:
        "'{{name}}' starts with `_`. Drop the underscore — privacy in TS comes from not exporting (or from a `_internal/` directory), not from a leading underscore on the symbol name.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename =
      typeof context.filename === 'string'
        ? context.filename
        : (context.getFilename?.() ?? '')

    if (isInInternalDir(filename)) {
      return {}
    }

    return {
      VariableDeclarator(node: AstNode) {
        if (node.id?.type === 'Identifier') {
          checkIdentifier(context, node.id, node.id.name)
        }
      },
      FunctionDeclaration(node: AstNode) {
        if (node.id?.type === 'Identifier') {
          checkIdentifier(context, node.id, node.id.name)
        }
      },
      ClassDeclaration(node: AstNode) {
        if (node.id?.type === 'Identifier') {
          checkIdentifier(context, node.id, node.id.name)
        }
      },
      TSInterfaceDeclaration(node: AstNode) {
        if (node.id?.type === 'Identifier') {
          checkIdentifier(context, node.id, node.id.name)
        }
      },
      TSTypeAliasDeclaration(node: AstNode) {
        if (node.id?.type === 'Identifier') {
          checkIdentifier(context, node.id, node.id.name)
        }
      },
      // Method / class-field NAMES we own (`class K { _doFoo() {} }`,
      // `class K { _field = 1 }`). Computed keys (`[expr]`) are skipped — the
      // name isn't a literal we control.
      MethodDefinition(node: AstNode) {
        if (!node.computed && node.key?.type === 'Identifier') {
          checkIdentifier(context, node.key, node.key.name)
        }
      },
      PropertyDefinition(node: AstNode) {
        if (!node.computed && node.key?.type === 'Identifier') {
          checkIdentifier(context, node.key, node.key.name)
        }
      },
      // NOTE: function/method/arrow PARAMETERS are intentionally NOT checked.
      // A leading underscore on a parameter is TypeScript's own sanctioned
      // marker for an intentionally-unused param under `noUnusedParameters`
      // (TS6133). Banning `_` there directly conflicts with that compiler
      // setting: a positionally-required-but-unused param (Proxy traps,
      // fixed-arity callbacks) MUST keep the `_` or the build breaks. So params
      // are governed by tsc (`noUnusedParameters` + the `_` convention), not by
      // this rule. A `_`-param that the body DOES use is a separate smell that
      // tsc won't flag — catch that in review, not here.
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
