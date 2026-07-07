/*
 * @file Forbid `export default` — fleet convention is named exports only.
 *   Default exports lose the name at the import site (`import x from 'mod'`
 *   lets the caller rename freely), defeat grep / "find references" tools, and
 *   don't compose with re-exports (`export * from 'mod'` skips the default).
 *   Style signal that motivated the rule: across socket-sdk-js, socket-cli,
 *   socket-packageurl-js, socket-sdxgen, socket-lib, and socket-stuie, the
 *   named-vs-default ratio is essentially 100-to-1 — socket-lib has zero
 *   `export default` statements, the other repos have a handful of stragglers
 *   each. Autofix scope:
 *
 *   - `export default function foo() {}` → `export function foo() {}`
 *   - `export default class Foo {}` → `export class Foo {}`
 *   - `export default <identifier>` (separate-declaration form) → `export {
 *     <identifier> }` Skips (report-only, no fix):
 *   - `export default function () {}` / `export default class {}` — anonymous
 *     declarations, no canonical name to assign.
 *   - `export default <expression>` where the expression isn't a bare identifier
 *     (e.g. `export default { foo: 1 }`, `export default makePlugin(...)`) —
 *     choosing a name requires human input. Exempt: tooling **config
 *     entrypoints** (`*.config.{mts,ts,cts,mjs,js,cjs}`). vitest / oxlint /
 *     rolldown / vite / tsup read the module's `default` export by contract —
 *     `export default defineConfig({...})` is the documented shape and there is
 *     no named-export alternative the tool will honor. Flagging it is a false
 *     positive (the config file can't satisfy both the tool and the rule), so a
 *     config-entrypoint filename short-circuits the rule. This mirrors how the
 *     plugin's own rule files carry a per-file disable for the same "the tool's
 *     contract requires a default export" reason.
 *
 *   Both fixable shapes above are `suggest`-only (`meta.hasSuggestions`, no
 *   `meta.fixable`) — `--fix` / `pnpm run fix` never auto-applies them. The
 *   rewrite only changes the export statement; it can't see or update every
 *   importer, and a default-import site (`import x from './mod'`) breaks the
 *   moment the export becomes named. A rollout that auto-applied this fix
 *   rewrote the export while every importer still used default-import syntax,
 *   producing module-resolution errors at runtime. The rule still reports;
 *   the rewrite lands only via an explicit `--fix-suggestions` pass or an
 *   editor code action, after the importers are updated in lockstep.
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

// Tooling config entrypoints whose loader reads the module's `default` export
// by contract (vitest / oxlint / rolldown / vite / tsup / …): `foo.config.mts`,
// `vitest.config.ts`, etc. The path is normalized to `/` first so the suffix
// test holds on win32.
const CONFIG_ENTRYPOINT_RE = /\.config\.[cm]?[jt]s$/

export function isConfigEntrypoint(filename: string): boolean {
  return CONFIG_ENTRYPOINT_RE.test(normalizePath(filename))
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Forbid `export default` — use named exports so the export name is stable across import sites.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: undefined,
    hasSuggestions: true,
    messages: {
      noDefaultExport:
        'Avoid `export default` — use a named export so the export name is stable across imports, greppable, and composable with `export * from`.',
      noDefaultExportNoFix:
        'Avoid `export default` — the default-exported value is anonymous or a complex expression. Give it a name and switch to `export { <name> }`.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (isConfigEntrypoint(filename)) {
      return {}
    }

    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    return {
      ExportDefaultDeclaration(node: AstNode) {
        const decl = node.declaration
        if (!decl) {
          return
        }

        // `export default function name() {}` /
        // `export default class Name {}` — drop the `default` keyword
        // and emit the declaration as a named export.
        if (
          (decl.type === 'ClassDeclaration' ||
            decl.type === 'FunctionDeclaration') &&
          decl.id &&
          decl.id.type === 'Identifier'
        ) {
          context.report({
            node,
            messageId: 'noDefaultExport',
            // `suggest`, not `fix` — see the file-level doc. Every
            // default-import site needs updating in lockstep; auto-applying
            // this leaves importers broken until they're fixed by hand.
            suggest: [
              {
                messageId: 'noDefaultExport',
                fix(fixer: RuleFixer) {
                  const declText = sourceCode.getText(decl)
                  return fixer.replaceText(node, `export ${declText}`)
                },
              },
            ],
          })
          return
        }

        // `export default someIdentifier` — rewrite to
        // `export { someIdentifier }`. Only safe when the identifier
        // is declared in the same module; we don't try to verify that
        // here because the import side will fail loudly if not, and
        // the fix never strips a declaration.
        if (decl.type === 'Identifier') {
          context.report({
            node,
            messageId: 'noDefaultExport',
            suggest: [
              {
                messageId: 'noDefaultExport',
                fix(fixer: RuleFixer) {
                  return fixer.replaceText(node, `export { ${decl.name} }`)
                },
              },
            ],
          })
          return
        }

        // Anonymous declaration or complex expression — report without
        // a fix; the human needs to choose a name.
        context.report({
          node,
          messageId: 'noDefaultExportNoFix',
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
