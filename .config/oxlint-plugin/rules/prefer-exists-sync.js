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
 *
 * No autofix: the call signature changes (existsSync returns boolean,
 * stat returns metadata). Replacing automatically would discard the
 * caller's metadata-handling code if any. Reporting only — caller
 * picks the right rewrite.
 */

const ACCESS_METHODS = new Set(['access', 'accessSync'])
const STAT_METHODS = new Set(['lstat', 'lstatSync', 'stat', 'statSync'])

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
    messages: {
      access:
        'fs.{{method}}() — use existsSync from node:fs for existence checks. fs.access throws on missing files (forces try/catch); existsSync returns boolean directly.',
      stat: 'fs.{{method}}() — if you only need to know whether the path exists, use existsSync from node:fs. If you need the metadata (size, mtime), keep stat but state intent in a comment.',
      fileExists:
        'Custom `fileExists` / `pathExists` / `isFile`-style wrapper — use existsSync from node:fs directly.',
    },
    schema: [],
  },

  create(context) {
    function calleeMethodName(callee) {
      if (callee.type !== 'MemberExpression') {
        return undefined
      }
      if (callee.property.type !== 'Identifier') {
        return undefined
      }
      return callee.property.name
    }

    return {
      CallExpression(node) {
        const method = calleeMethodName(node.callee)
        if (!method) {
          // Direct call: `await fileExists(p)` — flag known wrapper names.
          if (
            node.callee.type === 'Identifier' &&
            /^(fileExists|pathExists|isFile|isDir|exists)$/.test(
              node.callee.name,
            ) &&
            // Skip `existsSync` itself (the canonical form).
            node.callee.name !== 'exists'
          ) {
            context.report({
              node,
              messageId: 'fileExists',
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
