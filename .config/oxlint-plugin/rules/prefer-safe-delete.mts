/**
 * @fileoverview Per CLAUDE.md "File deletion" rule: route every delete
 * through `safeDelete()` / `safeDeleteSync()` from
 * `@socketsecurity/lib-stable/fs`. Never `fs.rm` / `fs.unlink` / `fs.rmdir` /
 * `rm -rf` directly — even for one known file.
 *
 * Detects:
 *   - `fs.rm(...)` / `fs.rmSync(...)` / `fs.promises.rm(...)`
 *   - `fs.unlink(...)` / `fs.unlinkSync(...)`
 *   - `fs.rmdir(...)` / `fs.rmdirSync(...)`
 *
 * Autofix: rewrites the call to `safeDelete(path)` / `safeDeleteSync(path)`
 * AND injects `import { safeDelete } from '@socketsecurity/lib-stable/fs'`
 * (or `safeDeleteSync`) when missing.
 *
 * The autofix is conservative — it only fires when the call shape is
 * "obviously equivalent" to safeDelete:
 *
 *   - The first argument is a single expression (the path).
 *   - Any second argument is an options object literal (we drop it;
 *     safeDelete handles recursive/force internally).
 *   - No third argument (rules out fs.rm with an explicit callback).
 *   - Not a node-callback-style usage (no trailing function expression).
 *
 * Skipped (reported without fix):
 *   - `fs.rm(p, opts, cb)` — node-callback style; semantics differ.
 *   - Calls whose result is checked/assigned in a way that depends on
 *     fs.rm's specific throw-on-missing or callback contract.
 *
 * Spawn-based bans (`rm -rf`, `Remove-Item`) live in a separate hook
 * (`.claude/hooks/path-guard/`) — this rule covers the JavaScript side.
 */

import { appendImportFixes, summarizeImportTarget } from './_inject-import.mts'

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const DELETE_METHODS = new Set([
  'rm',
  'rmSync',
  'unlink',
  'unlinkSync',
  'rmdir',
  'rmdirSync',
])

const SYNC_METHODS = new Set(['rmSync', 'unlinkSync', 'rmdirSync'])

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Route every delete through safeDelete / safeDeleteSync from @socketsecurity/lib-stable/fs.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      banned:
        'fs.{{method}}() — use safeDelete / safeDeleteSync from @socketsecurity/lib-stable/fs. The lib wrapper handles ENOENT, retries on EBUSY, and integrates with the rest of the fleet.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    // One summary per replacement target — async (safeDelete) and
    // sync (safeDeleteSync) are separate import names from the same
    // specifier, so each gets its own summary cache.
    const summaryCache = new Map<
      string,
      ReturnType<typeof summarizeImportTarget>
    >()

    function ensureSummary(importName: string) {
      let s = summaryCache.get(importName)
      if (s) {
        return s
      }
      s = summarizeImportTarget(
        sourceCode.ast,
        '@socketsecurity/lib-stable/fs',
        importName,
      )
      summaryCache.set(importName, s)
      return s
    }

    /**
     * The autofix only fires when the call shape is unambiguous:
     *   fs.rm(path)
     *   fs.rm(path, { ...opts })
     *   fs.rmSync(path)
     *   fs.rmSync(path, { ...opts })
     *
     * Bail on:
     *   - 0 args (malformed; skip)
     *   - 3+ args (callback-style fs.rm — semantics differ)
     *   - 2nd arg is a function expression (callback-style)
     *   - any spread argument (...args; can't reason about arity)
     */
    function isFixable(node: AstNode) {
      const args = node.arguments
      if (args.length === 0 || args.length > 2) {
        return false
      }
      for (const a of args) {
        if (a.type === 'SpreadElement') {
          return false
        }
      }
      if (args.length === 2) {
        const second = args[1]
        if (
          second.type === 'FunctionExpression' ||
          second.type === 'ArrowFunctionExpression'
        ) {
          return false
        }
      }
      return true
    }

    return {
      CallExpression(node: AstNode) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression') {
          return
        }
        if (callee.property.type !== 'Identifier') {
          return
        }
        if (!DELETE_METHODS.has(callee.property.name)) {
          return
        }

        // Heuristic: callee.object should be a node that plausibly
        // refers to the fs module (named `fs`, `promises`, etc.).
        // Cover both `fs.rm`, `fs.promises.rm`, `promises.rm`,
        // `fsPromises.rm`. Skip method calls on instances (e.g.
        // `child.rm()` — not fs).
        const obj = callee.object
        const objName =
          obj.type === 'Identifier'
            ? obj.name
            : obj.type === 'MemberExpression' &&
                obj.property.type === 'Identifier'
              ? obj.property.name
              : undefined

        if (!objName) {
          return
        }

        // Match common fs aliases. Conservative — we'd rather miss a
        // case than flag `someChild.unlink()` on an unrelated object.
        if (!/^(fs|fsPromises|promises|fsp)$/.test(objName)) {
          return
        }

        const method = callee.property.name
        const isSync = SYNC_METHODS.has(method)
        const replacement = isSync ? 'safeDeleteSync' : 'safeDelete'

        if (!isFixable(node)) {
          context.report({
            node,
            messageId: 'banned',
            data: { method },
          })
          return
        }

        const s = ensureSummary(replacement)
        const pathArg = node.arguments[0]
        const pathText = sourceCode.getText(pathArg)

        context.report({
          node,
          messageId: 'banned',
          data: { method },
          fix(fixer: RuleFixer) {
            return [
              fixer.replaceText(node, `${replacement}(${pathText})`),
              ...appendImportFixes(
                s,
                fixer,
                `import { ${replacement} } from '@socketsecurity/lib-stable/fs'`,
                undefined,
              ),
            ]
          },
        })
      },
    }
  },
}

export default rule
