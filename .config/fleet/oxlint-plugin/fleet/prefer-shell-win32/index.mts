/**
 * @file Per CLAUDE.md "Cross-platform" fleet idiom: pass `shell: WIN32` (a
 *   boolean constant evaluated at module load — `true` on Windows, `false`
 *   everywhere else) rather than `shell: true` to a child-process call. Why:
 *   `shell: true` wraps the child in `cmd.exe` on Windows AND in `/bin/sh` on
 *   Unix. The Unix wrap is rarely what the caller wants — it adds an extra
 *   fork, breaks argv quoting for paths containing shell metacharacters, and
 *   changes signal-propagation semantics. The fleet's actual need is "wrap in
 *   `cmd.exe` so `.cmd`/`.bat`/`.ps1` resolution works on Windows" — exactly
 *   what `shell: WIN32` expresses. Detection: object-literal property `shell:
 *   true` (Property node where `key.name === 'shell'` and `value` is the `true`
 *   literal). The rule doesn't try to prove the surrounding call is a
 *   child-process call — `shell: true` is virtually never used as a non-spawn
 *   flag in fleet code, so the false-positive risk is acceptable. No autofix:
 *   rewriting to `shell: WIN32` requires the file to import `WIN32` from the
 *   canonical `constants/platform` (src) or `test/_shared/fleet/lib/platform`
 *   (tests). Adding that import is non-deterministic enough — different repos
 *   lay it out differently — that the right move is a report-only rule. The fix
 *   is a one-token edit; humans can do it. Bypass: adjacent comment
 *   `prefer-shell-win32: intentional` (matches the `prefer-async-spawn:
 *   sync-required` shape). Use when the call genuinely needs a shell wrap on
 *   every platform — e.g. running a user-supplied shell expression where
 *   `cmd.exe`/`sh` parsing IS the feature. Document the reason inline.
 *   File-scope exemptions: `src/process/spawn/**`, `src/process/exec/**`, and
 *   similar lib internals that document the `shell: true` behavior for
 *   downstream consumers. Handled at the .config/fleet/oxlintrc.json
 *   `ignorePatterns` level, not in the rule body — the rule should keep firing
 *   in plain consumer code.
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const BYPASS_RE = /prefer-shell-win32:\s*intentional/

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer `shell: WIN32` (Windows-only shell wrap) over `shell: true` (wraps on every platform).',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      shellTrue:
        'Use `shell: WIN32` (imported from `constants/platform` in src or `test/_shared/fleet/lib/platform` in tests). `shell: true` wraps the child in `/bin/sh` on Unix too, which is rarely intended — the fleet idiom is "wrap in cmd.exe on Windows so .cmd/.bat resolves, no shell wrap on Unix". If a cross-platform shell wrap really is intended, add `// prefer-shell-win32: intentional` with a reason.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    function hasBypassComment(node: AstNode) {
      const before = sourceCode.getCommentsBefore(node)
      const after = sourceCode.getCommentsAfter(node)
      for (const c of [...before, ...after]) {
        if (BYPASS_RE.test(c.value)) {
          return true
        }
      }
      return false
    }

    function findEnclosingStatement(node: AstNode) {
      let cur = node.parent
      while (cur) {
        if (
          cur.type === 'ExpressionStatement' ||
          cur.type === 'ReturnStatement' ||
          cur.type === 'ThrowStatement' ||
          cur.type === 'VariableDeclaration'
        ) {
          return cur
        }
        cur = cur.parent
      }
      return undefined
    }

    return {
      Property(node: AstNode) {
        const { key, value } = node
        /* c8 ignore start - Property nodes always have key + value in valid JS ASTs */
        if (!key || !value) {
          return
        }
        /* c8 ignore stop */
        // Accept both `shell: true` and `'shell': true`.
        const keyName =
          key.type === 'Identifier'
            ? key.name
            : key.type === 'Literal' && typeof key.value === 'string'
              ? key.value
              : undefined
        if (keyName !== 'shell') {
          return
        }
        if (value.type !== 'Literal' || value.value !== true) {
          return
        }
        // Bypass checks: the property itself, the value, and the
        // enclosing statement (where adjacent line-comments attach).
        if (hasBypassComment(node) || hasBypassComment(value)) {
          return
        }
        const stmt = findEnclosingStatement(node)
        if (stmt && hasBypassComment(stmt)) {
          return
        }
        context.report({
          node: value,
          messageId: 'shellTrue',
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
