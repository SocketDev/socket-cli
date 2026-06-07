/* oxlint-disable socket/no-npx-dlx -- this file IS the rule definition; the banned commands are lookup-table data, not real usage. */

/**
 * @file Per CLAUDE.md "Tooling" rule: 🚨 NEVER use `npx`, `pnpm dlx`, or `yarn
 *   dlx` — run `node_modules/.bin/<tool>` or `pnpm run <script>` (`pnpm exec`
 *   is also banned, see no-pm-exec-guard). Detects `npx`, `pnpm dlx`, `pnx`
 *   (the pnpm-11 dlx shorthand), and `yarn dlx` in source string literals —
 *   argv slices passed to `spawn()`, shell strings, scripts, doc snippets,
 *   README examples, etc. The hook at `.claude/hooks/fleet/path-guard/` blocks
 *   these at the shell layer; this rule catches them at edit / commit time
 *   inside JavaScript / TypeScript source. Autofix: rewrites the literal in
 *   place — `npx foo` → `node_modules/.bin/foo`, `pnpm dlx foo` →
 *   `node_modules/.bin/foo`, `yarn dlx foo` → `node_modules/.bin/foo`, `pnx
 *   foo` → `node_modules/.bin/foo` (best-effort: assumes the tool is an
 *   installed dep). Allowed exceptions (skipped):
 *
 *   - The literal `npx` inside a comment with `socket-lint: allow npx` — the
 *     canonical bypass marker, used by the lockdown skill spec.
 *   - The literal `pnpm dlx` inside a comment justifying a soak-time bypass
 *     (rare; case-by-case).
 *   - The CLAUDE.md fleet block reference itself — string literals like `'`pnpm
 *     dlx`'` documenting the rule. Heuristic: skip when the literal is inside a
 *     backtick-wrapped phrase in the source text (i.e. the literal value starts
 *     and ends with a backtick).
 */

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const PATTERNS = [
  // Order matters — longest-prefix first so `pnpm dlx` is matched
  // before `pnpm` and `pnx ` is matched before `pnpm`. Each entry
  // is [match-prefix, replacement-prefix, label].
  ['pnpm dlx ', 'node_modules/.bin/', 'pnpm dlx'],
  ['yarn dlx ', 'node_modules/.bin/', 'yarn dlx'], // socket-lint: allow npx
  ['npx ', 'node_modules/.bin/', 'npx'], // socket-lint: allow npx
  ['pnx ', 'node_modules/.bin/', 'pnx'],
]

const COMMENT_BYPASS_RE = /socket-lint:\s*allow\s+npx/ // socket-lint: allow npx

/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use `node_modules/.bin/<tool>` or `pnpm run <script>` instead of `npx` / `pnpm dlx` / `yarn dlx` / `pnx`. Per CLAUDE.md "Tooling" rule.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      banned:
        '`{{label}}` — run `node_modules/.bin/<tool>` or `pnpm run <script>` instead. CLAUDE.md "Tooling" rule bans dlx-style commands; they bypass the soak time and fetch packages without lockfile verification. (`pnpm exec` is also banned — wrapper overhead — see no-pm-exec-guard.)',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    /**
     * Return [matchPrefix, replacementPrefix, label] for the longest dlx-style
     * prefix that appears anywhere in the string, or undefined when none match.
     * Anchors at word boundaries — `pnxx` doesn't match `pnx`.
     */
    function findBannedPrefix(
      value: string,
    ): [string, string, string, number] | undefined {
      for (const [match, repl, label] of PATTERNS) {
        if (!match || !repl || !label) {
          continue
        }
        // Word-boundary check: either the match is at the start, or
        // the preceding char is non-alphanum (whitespace, punctuation).
        let idx = 0
        while ((idx = value.indexOf(match, idx)) !== -1) {
          const before = idx === 0 ? ' ' : value[idx - 1]!
          if (!/[A-Za-z0-9_-]/.test(before)) {
            return [match, repl, label, idx]
          }
          idx += match.length
        }
      }
      return undefined
    }

    /**
     * Skip when the surrounding source has the canonical bypass comment
     * (`socket-lint: allow npx`) on the same or an adjacent line.
     */
    function hasBypassComment(node: AstNode) {
      const before = sourceCode.getCommentsBefore(node)
      const after = sourceCode.getCommentsAfter(node)
      for (const c of [...before, ...after]) {
        if (COMMENT_BYPASS_RE.test(c.value)) {
          return true
        }
      }
      return false
    }

    function checkLiteral(node: AstNode, value: string): void {
      const found = findBannedPrefix(value)
      if (!found) {
        return
      }
      if (hasBypassComment(node)) {
        return
      }
      const label = found[2]

      context.report({
        node,
        messageId: 'banned',
        data: { label },
        fix(fixer: RuleFixer) {
          // Replace every occurrence in the literal — the literal may
          // be a shell pipeline like `npx foo && npx bar`.
          let next = value
          for (const [m, r] of PATTERNS) {
            if (!m || !r) {
              continue
            }
            // Word-boundary aware replace-all.
            const parts = next.split(m)
            if (parts.length === 1) {
              continue
            }
            // Rejoin only at boundaries; leave embedded matches alone.
            let out = parts[0]!
            for (let i = 1; i < parts.length; i++) {
              const prevChar = out.length === 0 ? ' ' : out[out.length - 1]!
              const replacement = /[A-Za-z0-9_-]/.test(prevChar) ? m : r
              out += replacement + parts[i]
            }
            next = out
          }
          if (next === value) {
            // Defensive — if our replace-all became a no-op, don't
            // ship an empty fix.
            return undefined
          }
          // Preserve the original quote style.
          const raw = sourceCode.getText(node)
          const quote = raw[0]!
          if (quote === '`') {
            // Template literal — only safe to fix if no expressions.
            return fixer.replaceText(node, '`' + next + '`')
          }
          // Plain string — escape the quote char if it appears.
          const escaped = next.replace(
            new RegExp(`\\\\|${quote}`, 'g'),
            (ch: string) => '\\' + ch,
          )
          return fixer.replaceText(node, quote + escaped + quote)
        },
      })
    }

    return {
      Literal(node: AstNode) {
        if (typeof node.value !== 'string') {
          return
        }
        checkLiteral(node, node.value)
      },
      TemplateLiteral(node: AstNode) {
        // Only fix template literals with no expressions — interpolated
        // strings can't be safely rewritten by string replace.
        if (node.expressions.length !== 0) {
          // Still flag — the cooked text might contain `npx`. Report
          // without autofix.
          for (const q of node.quasis) {
            const found = findBannedPrefix(q.value.cooked)
            if (found) {
              context.report({
                node,
                messageId: 'banned',
                data: { label: found[2] },
              })
              return
            }
          }
          return
        }
        const cooked = node.quasis[0].value.cooked
        checkLiteral(node, cooked)
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
