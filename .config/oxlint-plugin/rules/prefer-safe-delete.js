/**
 * @fileoverview Per CLAUDE.md "File deletion" rule: route every delete
 * through `safeDelete()` / `safeDeleteSync()` from
 * `@socketsecurity/lib/fs`. Never `fs.rm` / `fs.unlink` / `fs.rmdir` /
 * `rm -rf` directly — even for one known file.
 *
 * Detects:
 *   - `fs.rm(...)` / `fs.rmSync(...)` / `fs.promises.rm(...)`
 *   - `fs.unlink(...)` / `fs.unlinkSync(...)`
 *   - `fs.rmdir(...)` / `fs.rmdirSync(...)`
 *
 * No autofix: `safeDelete()` swallows ENOENT (the whole point), but
 * call sites may rely on fs.rm's throw-on-missing behavior. Forcing
 * a rewrite without inspection could change error semantics.
 *
 * Spawn-based bans (`rm -rf`, `Remove-Item`) live in a separate hook
 * (`.claude/hooks/path-guard/`) — this rule covers the JavaScript side.
 */

const DELETE_METHODS = new Set([
  'rm',
  'rmSync',
  'unlink',
  'unlinkSync',
  'rmdir',
  'rmdirSync',
])

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Route every delete through safeDelete / safeDeleteSync from @socketsecurity/lib/fs.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      banned:
        'fs.{{method}}() — use safeDelete / safeDeleteSync from @socketsecurity/lib/fs. The lib wrapper handles ENOENT, retries on EBUSY, and integrates with the rest of the fleet.',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
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
              : null

        if (!objName) {
          return
        }

        // Match common fs aliases. Conservative — we'd rather miss a
        // case than flag `someChild.unlink()` on an unrelated object.
        if (!/^(fs|fsPromises|promises|fsp)$/.test(objName)) {
          return
        }

        context.report({
          node,
          messageId: 'banned',
          data: { method: callee.property.name },
        })
      },
    }
  },
}

export default rule
