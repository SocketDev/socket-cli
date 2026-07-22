/*
 * @file Per CLAUDE.md "File deletion" rule: route every delete through
 *   `safeDelete()` / `safeDeleteSync()` from
 *   `@socketsecurity/lib-stable/fs/safe`. Never `fs.rm` / `fs.unlink` /
 *   `fs.rmdir` / `rm -rf` directly — even for one known file. Detects:
 *
 *   - `fs.rm(...)` / `fs.rmSync(...)` / `fs.promises.rm(...)`
 *   - `fs.unlink(...)` / `fs.unlinkSync(...)`
 *   - `fs.rmdir(...)` / `fs.rmdirSync(...)` Autofix: rewrites the call to
 *     `safeDelete(path)` / `safeDeleteSync(path)` AND injects `import {
 *     safeDelete } from '@socketsecurity/lib-stable/fs/safe'` (or
 *     `safeDeleteSync`) when missing. The autofix is conservative — it only
 *     fires when the call shape is "obviously equivalent" to safeDelete:
 *   - The first argument is a single expression (the path).
 *   - Any second argument is an options object literal (we drop it; safeDelete
 *     handles recursive/force internally).
 *   - No third argument (rules out fs.rm with an explicit callback).
 *   - Not a node-callback-style usage (no trailing function expression). Skipped
 *     (reported without fix):
 *   - `fs.rm(p, opts, cb)` — node-callback style; semantics differ.
 *   - Calls whose result is checked/assigned in a way that depends on fs.rm's
 *     specific throw-on-missing or callback contract. Spawn-based bans (`rm
 *     -rf`, `Remove-Item`) live in a separate hook
 *     (`.claude/hooks/fleet/path-guard/`) — this rule covers the JavaScript
 *     side.
 */

import {
  appendImportFixes,
  summarizeImportTarget,
} from '../../_shared/inject-import.mts'

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

const DELETE_METHODS = new Set([
  'rm',
  'rmdir',
  'rmdirSync',
  'rmSync',
  'unlink',
  'unlinkSync',
])

const SYNC_METHODS = new Set(['rmdirSync', 'rmSync', 'unlinkSync'])

/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Route every delete through safeDelete / safeDeleteSync from @socketsecurity/lib-stable/fs/safe.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      banned:
        '`{{method}}()` — use safeDelete / safeDeleteSync from @socketsecurity/lib-stable/fs/safe (bare `rmSync`/`unlinkSync` imported from node:fs counts too). The lib wrapper handles ENOENT, retries on EBUSY, and integrates with the rest of the fleet. In unit tests prefer an `os.tmpdir()` mkdtemp dir + `safeDeleteSync(dir)` over deleting individual files.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    // Bare named-import delete calls (`import { rmSync } from 'node:fs'; rmSync(p)`)
    // are the common test-cleanup shape and were slipping through the
    // MemberExpression-only match below. Collect the LOCAL name each fs delete
    // method is imported under (honoring `as` aliases) so a bare call to it is
    // caught too. Only the node:fs family is trusted — a local `rm`/`unlink`
    // helper is never flagged.
    const fsDeleteLocals = new Map<string, string>()
    const FS_SOURCES = new Set([
      'fs',
      'fs/promises',
      'node:fs',
      'node:fs/promises',
    ])
    const body = sourceCode.ast?.body
    if (Array.isArray(body)) {
      for (let i = 0, { length } = body; i < length; i += 1) {
        const stmt = body[i]!
        if (
          stmt.type !== 'ImportDeclaration' ||
          typeof stmt.source?.value !== 'string' ||
          !FS_SOURCES.has(stmt.source.value) ||
          !Array.isArray(stmt.specifiers)
        ) {
          continue
        }
        for (let j = 0, slen = stmt.specifiers.length; j < slen; j += 1) {
          const spec = stmt.specifiers[j]!
          if (
            spec.type === 'ImportSpecifier' &&
            spec.imported?.type === 'Identifier' &&
            DELETE_METHODS.has(spec.imported.name) &&
            spec.local?.type === 'Identifier'
          ) {
            fsDeleteLocals.set(spec.local.name, spec.imported.name)
          }
        }
      }
    }

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
      s = summarizeImportTarget(sourceCode.ast, importName)
      summaryCache.set(importName, s)
      return s
    }

    /**
     * The autofix only fires when the call shape is unambiguous: fs.rm(path)
     * fs.rm(path, { ...opts }) fs.rmSync(path) fs.rmSync(path, { ...opts })
     *
     * Bail on: - 0 args (malformed; skip) - 3+ args (callback-style fs.rm —
     * semantics differ) - 2nd arg is a function expression (callback-style) -
     * any spread argument (...args; can't reason about arity)
     */
    function isFixable(node: AstNode) {
      const args = node.arguments
      if (args.length === 0 || args.length > 2) {
        return false
      }
      for (let i = 0, { length } = args; i < length; i += 1) {
        const a = args[i]!
        if (a.type === 'SpreadElement') {
          return false
        }
      }
      if (args.length === 2) {
        const second = args[1]
        if (
          second.type === 'ArrowFunctionExpression' ||
          second.type === 'FunctionExpression'
        ) {
          return false
        }
      }
      return true
    }

    // Resolve the fs delete method this call invokes, or undefined if it isn't
    // one. Covers `fs.rm` / `fs.promises.rm` / `promises.rm` / `fsPromises.rm`
    // (member) AND a bare `rmSync(...)` whose name is a node:fs delete import
    // (bare). A method call on an unrelated object (`child.unlink()`) or a local
    // `rm`/`unlink` helper (not imported from fs) is skipped.
    function detectFsDeleteMethod(callee: AstNode): string | undefined {
      if (callee.type === 'MemberExpression') {
        if (
          callee.property.type !== 'Identifier' ||
          !DELETE_METHODS.has(callee.property.name)
        ) {
          return undefined
        }
        const obj = callee.object
        const objName =
          obj.type === 'Identifier'
            ? obj.name
            : obj.type === 'MemberExpression' &&
                obj.property.type === 'Identifier'
              ? obj.property.name
              : undefined
        if (!objName || !/^(fs|fsPromises|fsp|promises)$/.test(objName)) {
          return undefined
        }
        return callee.property.name
      }
      if (callee.type === 'Identifier') {
        return fsDeleteLocals.get(callee.name)
      }
      return undefined
    }

    return {
      CallExpression(node: AstNode) {
        const method = detectFsDeleteMethod(node.callee)
        if (!method) {
          return
        }
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
                `import { ${replacement} } from '@socketsecurity/lib-stable/fs/safe'`,
                undefined,
              ),
            ]
          },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
