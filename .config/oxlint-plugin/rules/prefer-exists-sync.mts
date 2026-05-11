/**
 * @fileoverview Per CLAUDE.md "File existence" rule: use `existsSync`
 * from `node:fs`. Never `fs.access` / `fs.stat`-for-existence / async
 * `fileExists` wrapper.
 *
 * Detects:
 *   - `fs.access(...)` / `fs.accessSync(...)` / `fs.promises.access(...)`
 *   - `fs.stat(...)` / `fs.statSync(...)` / `fs.promises.stat(...)`
 *     when the result is being used in a boolean / try-catch context
 *     (a strong signal of "is it there"). We can't perfectly detect
 *     all existence-checks, but flagging every `access(...)` and
 *     `statSync(...)` covers the common cases — false positives are
 *     fixed by switching to existsSync, which is harmless.
 *   - Custom wrappers: `fileExists(p)` / `pathExists(p)` / `isFile(p)` /
 *     `isDir(p)`.
 *
 * Autofix scope:
 *   - **Deterministic**: custom wrappers (`fileExists(p)` /
 *     `pathExists(p)` / `isFile(p)` / `isDir(p)`) are rewritten to
 *     `existsSync(p)` with `import { existsSync } from 'node:fs'`
 *     injected. Same arity, same boolean semantics, drop-in safe.
 *   - **AI-handled** (Step 4 of `pnpm run fix`): `fs.access` /
 *     `fs.stat` rewrites. These flip control flow — `try { await
 *     fs.access(p); … } catch { … }` becomes `if (existsSync(p))
 *     { … } else { … }`, and `const s = await fs.stat(p)` with
 *     metadata access (`s.size`, `s.isDirectory()`) needs to stay
 *     a stat call. The right rewrite depends on the surrounding
 *     code, but the pattern is mechanical enough for the AI step
 *     to handle reliably with the canonical guidance in
 *     scripts/ai-lint-fix.mts.
 */

import { appendImportFixes, summarizeImportTarget } from './_inject-import.mts'

const ACCESS_METHODS = new Set(['access', 'accessSync'])
const STAT_METHODS = new Set(['stat', 'statSync', 'lstat', 'lstatSync'])
const WRAPPER_NAMES = new Set(['fileExists', 'pathExists', 'isFile', 'isDir'])

const EXISTS_SYNC_IMPORT_LINE = "import { existsSync } from 'node:fs'"

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Prefer existsSync from node:fs over fs.access / fs.stat-for-existence / async fileExists wrapper.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      access:
        'fs.{{method}}() — use existsSync from node:fs for existence checks. fs.access throws on missing files (forces try/catch); existsSync returns boolean directly.',
      stat: 'fs.{{method}}() — if you only need to know whether the path exists, use existsSync from node:fs. If you need the metadata (size, mtime), keep stat but state intent in a comment.',
      fileExists:
        'Custom `{{name}}` wrapper — use existsSync from node:fs directly.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    let summary

    function ensureSummary() {
      if (summary) {
        return summary
      }
      summary = summarizeImportTarget(sourceCode.ast, 'node:fs', 'existsSync')
      return summary
    }

    function calleeMethodName(callee) {
      if (callee.type !== 'MemberExpression') {
        return undefined
      }
      if (callee.property.type !== 'Identifier') {
        return undefined
      }
      return callee.property.name
    }

    /**
     * Wrappers are only fixable when:
     *   - exactly 1 argument (matches existsSync arity)
     *   - argument is not a SpreadElement
     *
     * The call is often wrapped in `await` — that's fine. Replacing
     * `await fileExists(p)` with `existsSync(p)` (no await) is the
     * intended rewrite; existsSync is sync and the surrounding `await`
     * collapses to a no-op on a non-promise value.
     */
    function isFixableWrapperCall(node) {
      if (node.arguments.length !== 1) {
        return false
      }
      if (node.arguments[0].type === 'SpreadElement') {
        return false
      }
      return true
    }

    return {
      CallExpression(node) {
        const method = calleeMethodName(node.callee)
        if (!method) {
          // Direct call: `await fileExists(p)` — flag known wrapper
          // names and autofix to `existsSync(p)`.
          if (
            node.callee.type === 'Identifier' &&
            WRAPPER_NAMES.has(node.callee.name)
          ) {
            const name = node.callee.name
            if (!isFixableWrapperCall(node)) {
              context.report({
                node,
                messageId: 'fileExists',
                data: { name },
              })
              return
            }

            const s = ensureSummary()
            const argText = sourceCode.getText(node.arguments[0])

            context.report({
              node,
              messageId: 'fileExists',
              data: { name },
              fix(fixer) {
                // Replace just the callee identifier — preserve
                // arg text + parens. `await` (if present) becomes a
                // no-op against a sync boolean return; safe to leave.
                return [
                  fixer.replaceText(node, `existsSync(${argText})`),
                  ...appendImportFixes(
                    s,
                    fixer,
                    EXISTS_SYNC_IMPORT_LINE,
                    undefined,
                  ),
                ]
              },
            })
          }
          return
        }

        if (ACCESS_METHODS.has(method)) {
          context.report({
            node,
            messageId: 'access',
            data: { method },
          })
        } else if (STAT_METHODS.has(method)) {
          context.report({
            node,
            messageId: 'stat',
            data: { method },
          })
        }
      },
    }
  },
}

export default rule
