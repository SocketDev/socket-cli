/*
 * @file Forbid `import * as x from '…'` (a namespace import). The fleet uses
 *   named imports only. A namespace import pulls a module's WHOLE surface under
 *   one local binding, which:
 *
 *   - defeats per-name dead-code analysis — `import * as lib` reads as "uses
 *     everything," so tree-shaking and the fleet API-usage audit
 *     (scripts/repo/audit-api-usage.mts) can't tell which exports are live;
 *   - hides the actual dependency surface from a reader and from grep / "find
 *     references";
 *   - composes poorly with the fleet's named-export convention (see
 *     `socket/no-default-export`).
 *
 *   Report-only — no autofix. Rewriting `import * as x` to named imports needs
 *   the set of members actually accessed off `x`, which the rule can't infer
 *   safely (a computed `x[key]` access, or re-export of `x`, would be dropped).
 *   The author replaces it with `import { a, b } from '…'`.
 *
 *   Exempt:
 *   - Test files (`*.test.*`, `/test/` trees) — mocking a whole module with
 *     `import * as mod from '…'` + `vi.spyOn(mod, 'fn')` is the canonical spy
 *     pattern and has no named-import equivalent.
 *   - `import * as x from 'node:…'` / a bare builtin — some builtins expose no
 *     useful named exports; the namespace form is idiomatic there and is not a
 *     fleet-surface concern.
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// A test file: a `.test.` source extension at end of path (optional c/m prefix,
// j or t, optional s, optional x — covers .test.ts/.mts/.cts/.tsx/.js/…), or a
// `/test/` path segment anywhere.
const TEST_FILE_RE = /(?:\.test\.[cm]?[jt]sx?$|\/test\/)/

export function isTestFile(filename: string): boolean {
  return TEST_FILE_RE.test(normalizePath(filename))
}

// A `node:`-prefixed builtin or a bare builtin name (no `/` and no leading `.`
// or `@`). Namespace-importing these is idiomatic and out of scope — the rule
// targets the fleet's own + npm package surface, not builtins.
export function isBuiltinSpecifier(specifier: string): boolean {
  if (specifier.startsWith('node:')) {
    return true
  }
  return !specifier.startsWith('.') && !specifier.includes('/')
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Forbid `import * as x` — use named imports so the dependency surface is explicit and dead-code-analyzable.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    schema: [],
    messages: {
      noNamespaceImport:
        'Avoid `import * as {{name}}` — use named imports (`import { … } from …`) so the used surface is explicit, greppable, and dead-code-analyzable. (Test module-mocks + bare builtins are exempt.)',
    },
  },
  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (isTestFile(filename)) {
      return {}
    }
    return {
      ImportDeclaration(node: AstNode) {
        const specifier: string = node.source?.value || ''
        if (isBuiltinSpecifier(specifier)) {
          return
        }
        const specifiers: AstNode[] = node.specifiers ?? []
        for (let i = 0, { length } = specifiers; i < length; i += 1) {
          const spec = specifiers[i]!
          if (spec.type === 'ImportNamespaceSpecifier') {
            context.report({
              node: spec,
              messageId: 'noNamespaceImport',
              data: { name: spec.local?.name ?? 'x' },
            })
          }
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
