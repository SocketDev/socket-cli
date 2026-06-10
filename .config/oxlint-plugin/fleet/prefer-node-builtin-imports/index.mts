/**
 * @file Per CLAUDE.md "Imports" rule: `node:fs` and `node:url` cherry-pick
 *   (`existsSync`, `promises as fs`; `fileURLToPath`, `pathToFileURL`); `path`
 *   / `os` / `crypto` use default imports. The fleet's Node-builtin import
 *   shape is asymmetric on purpose:
 *
 *   - `node:fs` is large; cherry-picking is the canonical idiom and keeps the
 *     import line meaningful (you can read off which fs APIs the module
 *     actually uses).
 *   - `node:url` is also cherry-picked: callers use just `fileURLToPath` /
 *     `pathToFileURL`, and `url.fileURLToPath(import.meta.url)` reads worse
 *     than the named form. So `node:url` is not default-import-required.
 *   - `node:path`, `node:os`, `node:crypto` are small; a default import (`import
 *     path from 'node:path'`) reads cleaner than four named imports and matches
 *     the way most fleet code references `path.join` / `path.resolve` /
 *     `path.dirname`. Detects:
 *   - `import fs from 'node:fs'` / `import * as fs from 'node:fs'` — recommends
 *     named imports.
 *   - `import { join, resolve } from 'node:path'` — recommends default import +
 *     dotted access (`path.join`, `path.resolve`).
 *   - Same for `node:os`, `node:crypto`. Autofix:
 *   - `import { join } from 'node:path'` → `import path from 'node:path'` AND
 *     every `join(...)` reference in the file is rewritten to `path.join(...)`.
 *     Same shape for os/url/crypto. Skipped when the file already has a default
 *     import for the module (would double-import).
 *   - `import fs from 'node:fs'` / `import * as fs from 'node:fs'` → scans the
 *     file's references to the local binding (e.g. `fs`), collects the set of
 *     accessed properties (`fs.existsSync`, `fs.readFileSync`), and rewrites
 *     the import to a sorted named-imports clause. Each `fs.X` reference is
 *     rewritten to bare `X`. Skipped when: a) any reference shape is "weird"
 *     (computed access `fs[expr]`, spread `...fs`, passed as a value `fn(fs)`,
 *     reassignment). Those need human eyes — the rewrite would lose semantics.
 *     b) collected names collide with existing top-level bindings in the file.
 *     (os/crypto follow the path autofix shape; url and fs are cherry-picked.)
 */

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

const PREFER_DEFAULT = ['node:path', 'node:os', 'node:crypto']
const DEFAULT_LOCAL = {
  'node:path': 'path',
  'node:os': 'os',
  'node:crypto': 'crypto',
}

// `node:url` is fully cherry-pickable (like `node:fs`): callers typically use
// just `fileURLToPath` / `pathToFileURL`, and `url.fileURLToPath(...)` reads
// worse than the named form. So `node:url` is not in PREFER_DEFAULT at all —
// no per-name exception list is needed.
const NAMED_EXCEPTIONS: Record<string, Set<string>> = {}

/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use cherry-pick named imports for node:fs / node:url and default imports for node:path / os / crypto. Per CLAUDE.md "Imports" rule.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      fsDefault:
        "`import fs from 'node:fs'` — use cherry-pick named imports (e.g. `import { existsSync } from 'node:fs'`). Per CLAUDE.md.",
      fsNamespace:
        "`import * as fs from 'node:fs'` — use cherry-pick named imports. Per CLAUDE.md.",
      preferDefault:
        "`import {{names}} from '{{specifier}}'` — use a default import and dotted access (`{{local}}.{{first}}`). Per CLAUDE.md.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    /**
     * Look at the program body to determine whether `localName` is already in
     * use (any binding form). If so, autofixing to a default import would
     * shadow it.
     */
    function localBindingExists(
      programBody: AstNode[],
      localName: string,
    ): boolean {
      for (let i = 0, { length } = programBody; i < length; i += 1) {
        const stmt = programBody[i]!
        if (stmt.type === 'ImportDeclaration') {
          for (const spec of stmt.specifiers) {
            if (
              spec.local &&
              spec.local.name === localName &&
              // Only count it as a clash if the import comes from a
              // *different* specifier — same-specifier same-local
              // means we'd be re-defining the same import.
              stmt.source.value !== ''
            ) {
              return true
            }
          }
          continue
        }
        if (stmt.type === 'VariableDeclaration') {
          for (const decl of stmt.declarations) {
            if (
              decl.id &&
              decl.id.type === 'Identifier' &&
              decl.id.name === localName
            ) {
              return true
            }
          }
        }
      }
      return false
    }

    return {
      ImportDeclaration(node: AstNode) {
        const specifier = node.source.value
        if (typeof specifier !== 'string') {
          return
        }

        // Type-only imports have zero runtime impact — they exist purely
        // for the type checker (e.g. `import type * as NodeFs from
        // 'node:fs'` used in `vi.importActual<typeof NodeFs>('node:fs')`
        // type arguments). The fleet's value-import shape rules don't
        // apply to them: a type namespace import doesn't carry the
        // "loaded the whole module" semantics of a value namespace
        // import. Skip.
        if (node.importKind === 'type') {
          return
        }

        // node:fs — should be named-imports.
        if (specifier === 'node:fs') {
          let bannedSpec
          let messageId
          for (const spec of node.specifiers) {
            if (spec.type === 'ImportDefaultSpecifier') {
              bannedSpec = spec
              messageId = 'fsDefault'
              break
            }
            if (spec.type === 'ImportNamespaceSpecifier') {
              bannedSpec = spec
              messageId = 'fsNamespace'
              break
            }
          }
          if (!bannedSpec) {
            return
          }

          const fsLocalName = bannedSpec.local.name

          // Walk the scope graph to collect every reference to the
          // local binding. If any reference is "weird" (not a plain
          // member expression on the read side), bail on the autofix
          // and report only — the rewrite isn't safe.
          const scope = context.getScope ? context.getScope() : undefined
          if (!scope) {
            context.report({ node, messageId })
            return
          }

          const accessed = new Set<string>()
          const memberRefs: AstNode[] = []
          let unsafe = false

          function visit(s: AstNode, visited: Set<AstNode>): void {
            if (visited.has(s)) {
              return
            }
            visited.add(s)
            for (const ref of s.references) {
              if (ref.identifier.name !== fsLocalName) {
                continue
              }
              // Skip the import-binding declaration itself.
              if (
                ref.identifier.range[0] >= node.range[0] &&
                ref.identifier.range[1] <= node.range[1]
              ) {
                continue
              }
              const refParent = ref.identifier.parent
              if (
                !refParent ||
                refParent.type !== 'MemberExpression' ||
                refParent.object !== ref.identifier ||
                refParent.computed ||
                refParent.property.type !== 'Identifier'
              ) {
                // Weird usage shape — bail.
                unsafe = true
                return
              }
              accessed.add(refParent.property.name)
              memberRefs.push(refParent)
            }
            for (const child of s.childScopes) {
              if (unsafe) {
                return
              }
              visit(child, visited)
            }
          }

          visit(scope, new Set())

          if (unsafe || accessed.size === 0) {
            // No usable references (or shadowed/aliased usage) — drop
            // back to report-only.
            context.report({ node, messageId })
            return
          }

          // Skip autofix if any accessed name collides with an
          // existing top-level binding (would shadow on rewrite).
          const programBody = sourceCode.ast.body
          for (const name of accessed) {
            if (localBindingExists(programBody, name)) {
              context.report({ node, messageId })
              return
            }
          }

          const sorted = [...accessed].toSorted()
          const newImport = `import { ${sorted.join(', ')} } from 'node:fs'`

          context.report({
            node,
            messageId,
            fix(fixer: RuleFixer) {
              const fixes = [fixer.replaceText(node, newImport)]
              for (let i = 0, { length } = memberRefs; i < length; i += 1) {
                const ref = memberRefs[i]!
                // Replace `fs.X` with bare `X`. We need the entire
                // member expression, not just the object.
                fixes.push(fixer.replaceText(ref, ref.property.name))
              }
              return fixes
            },
          })
          return
        }

        // node:path / os / url / crypto — should be default-import.
        if (!PREFER_DEFAULT.includes(specifier)) {
          return
        }

        // If there's already a default import on this statement,
        // accept the rest of the named imports as-is — multi-form
        // mix-ins (`import path, { sep } from 'node:path'`) are
        // unusual but tolerated.
        const hasDefault = node.specifiers.some(
          (s: AstNode) => s.type === 'ImportDefaultSpecifier',
        )
        if (hasDefault) {
          return
        }

        const named = node.specifiers.filter(
          (s: AstNode) => s.type === 'ImportSpecifier',
        )
        if (named.length === 0) {
          return
        }

        // Allow documented exceptions (e.g. `fileURLToPath`).
        const exceptions = (NAMED_EXCEPTIONS as Record<string, Set<string>>)[
          specifier
        ]
        const violatingNames = exceptions
          ? named.filter(
              (s: AstNode) =>
                s.imported &&
                s.imported.name &&
                !exceptions.has(s.imported.name),
            )
          : named
        if (violatingNames.length === 0) {
          return
        }

        const local = (DEFAULT_LOCAL as Record<string, string>)[specifier]!
        const violatingNameList = violatingNames
          .map((s: AstNode) => s.imported.name)
          .join(', ')

        // Skip autofix if the local binding (`path`, `os`, etc.)
        // already exists in the file under another name.
        const programBody = sourceCode.ast.body
        if (localBindingExists(programBody, local)) {
          context.report({
            node,
            messageId: 'preferDefault',
            data: {
              names: `{ ${violatingNameList} }`,
              specifier,
              local,
              first: violatingNames[0]!.imported.name,
            },
          })
          return
        }

        // Reference rewriting needs scope analysis to find every `homedir()` /
        // `platform()` call site and prefix it with `<local>.`. When the oxlint
        // engine doesn't expose `getScope` (older versions return nothing), we
        // can only safely rewrite the import line — which would leave the bare
        // call sites undefined (`ReferenceError`). So in that case report WITHOUT
        // a fix: the author rewrites by hand. Better a manual fix than a
        // half-conversion that breaks the module.
        const scopeForFix = context.getScope ? context.getScope() : undefined
        if (!scopeForFix) {
          context.report({
            node,
            messageId: 'preferDefault',
            data: {
              names: `{ ${violatingNameList} }`,
              specifier,
              local,
              first: violatingNames[0]!.imported.name,
            },
          })
          return
        }

        context.report({
          node,
          messageId: 'preferDefault',
          data: {
            names: `{ ${violatingNameList} }`,
            specifier,
            local,
            first: violatingNames[0]!.imported.name,
          },
          fix(fixer: RuleFixer) {
            const fixes: AstNode[] = []

            // Rewrite the import statement.
            const keptNamed = exceptions
              ? named.filter(
                  (s: AstNode) =>
                    s.imported &&
                    s.imported.name &&
                    exceptions.has(s.imported.name),
                )
              : []

            let newImport
            if (keptNamed.length > 0) {
              const keptText = keptNamed
                .map((s: AstNode) => sourceCode.getText(s))
                .join(', ')
              newImport = `import ${local}, { ${keptText} } from '${specifier}'`
            } else {
              newImport = `import ${local} from '${specifier}'`
            }
            fixes.push(fixer.replaceText(node, newImport))

            // Rewrite every reference in the file: each violating
            // named import becomes `<local>.<name>`.
            //
            // Walk the source text and look for word-boundary matches
            // of each violating name. Skip occurrences inside
            // strings/comments to avoid breaking unrelated text.
            //
            // Scope analysis is guaranteed available here — the report above
            // returns early (report-only, no fix) when getScope is absent.
            const scope = scopeForFix
            const targetNames = new Set(
              violatingNames.map((s: AstNode) => s.local.name),
            )

            if (scope) {
              const visited = new Set<AstNode>()

              function visitScope(s: AstNode): void {
                if (visited.has(s)) {
                  return
                }
                visited.add(s)
                for (const ref of s.references) {
                  if (!targetNames.has(ref.identifier.name)) {
                    continue
                  }
                  // Skip the import-declaration's own binding.
                  if (
                    ref.identifier.range[0] >= node.range[0] &&
                    ref.identifier.range[1] <= node.range[1]
                  ) {
                    continue
                  }
                  fixes.push(
                    fixer.replaceText(
                      ref.identifier,
                      `${local}.${ref.identifier.name}`,
                    ),
                  )
                }
                for (const child of s.childScopes) {
                  visitScope(child)
                }
              }

              visitScope(scope)
            }

            return fixes
          },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
