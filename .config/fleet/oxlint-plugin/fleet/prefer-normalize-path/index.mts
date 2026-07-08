/**
 * @file Per CLAUDE.md "Cross-platform path matching" — when code matches
 *   against a path string, normalize the path FIRST with `normalizePath` from
 *   `@socketsecurity/lib/paths/normalize` and write the regex against `/` only,
 *   rather than rewriting separators by hand with a `.replace(...)` /
 *   `.replaceAll(...)` over a path-separator regex. A manual `p.replace(/\\/g,
 *   '/')` (backslash → forward slash) or a dual-separator character class
 *   (`[\\/]` / `[/\\]`) is the exact shape `normalizePath` exists to replace:
 *   it gives one path representation across darwin / linux / win32, so a regex
 *   written against `/` works everywhere. Flags a `CallExpression` whose callee
 *   is a `.replace(` / `.replaceAll(` MemberExpression and whose FIRST argument
 *   is a separator regex (a manual rewrite), OR a `.test(` / `.exec(` call
 *   whose RECEIVER is a separator regex (a manual match — `/[/\\]/.test(p)` on
 *   an un-normalized path). No autofix — the rewrite is contextual (the right
 *   shape is `normalizePath(p)` at the input boundary, not a local
 *   substitution), so the AI-fix tier handles it. Skips the normalize helper
 *   itself (`paths/normalize`), where the canonical separator rewrite
 *   legitimately lives. Pairs with the `path-regex-normalize-nudge` Stop hook +
 *   the `socket/cross-platform-path-matching` doctrine.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// The three path-separator-rewrite regex pattern SOURCES this rule steers away
// from. Matched against `node.regex.pattern` (the raw source between the
// slashes), NOT against JS string escaping:
//
//   - `\\`        — a lone backslash matcher: `p.replace(/\\/g, '/')`.
//   - `[\\/]`     — escaped-backslash + slash character class (either separator).
//   - `[/\\]`     — slash + escaped-backslash character class (either separator).
//
// Deliberately narrow so an honest `.replace()` over non-path text (a URL
// segment, a Windows-newline strip `/\r\n/`, an arbitrary class) does not
// false-positive — a false-positive error rule gets disabled.
const SEPARATOR_REWRITE_PATTERNS: ReadonlySet<string> = new Set([
  '[/\\\\]',
  '[\\\\/]',
  '\\\\',
])

// A regex literal whose source rewrites path separators.
function isSeparatorRewriteRegex(node: AstNode): boolean {
  if (!node || node.type !== 'Literal' || !node.regex) {
    return false
  }
  const pattern: string = node.regex.pattern ?? ''
  return SEPARATOR_REWRITE_PATTERNS.has(pattern)
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Normalize a path with `normalizePath` from `@socketsecurity/lib/paths/normalize` instead of rewriting separators by hand with a `.replace(...)` over a path-separator regex, or matching one with `.test(...)` / `.exec(...)`.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      preferNormalizePath:
        'Manual path-separator rewrite. Use `normalizePath` from `@socketsecurity/lib/paths/normalize` to get one `/`-separated representation across darwin / linux / win32, then match `/` only.',
      preferNormalizePathMatch:
        'Matching a path against a dual-separator regex. Normalize the path first with `normalizePath` from `@socketsecurity/lib/paths/normalize`, then match against `/` only — a `[/\\\\]` / `[\\\\/]` class means the path was never normalized.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = normalizePath(
      context.filename ?? context.getFilename?.() ?? '',
    )
    // The normalize helper itself is where the canonical separator rewrite
    // lives — never steer it at itself.
    if (/\/paths\/normalize\.[mc]?[jt]s$/.test(filename)) {
      return {}
    }
    return {
      CallExpression(node: AstNode) {
        const callee = node.callee
        if (callee?.type !== 'MemberExpression') {
          return
        }
        const method = callee.property?.name
        // `.replace(regex, …)` / `.replaceAll(regex, …)` — a manual rewrite; the
        // separator regex is the FIRST argument.
        if (
          (method === 'replace' || method === 'replaceAll') &&
          isSeparatorRewriteRegex(node.arguments?.[0])
        ) {
          context.report({ node, messageId: 'preferNormalizePath' })
          return
        }
        // `/regex/.test(path)` / `/regex/.exec(path)` — a manual match; the
        // separator regex is the RECEIVER (`callee.object`), not an argument.
        if (
          (method === 'exec' || method === 'test') &&
          isSeparatorRewriteRegex(callee.object)
        ) {
          context.report({ node, messageId: 'preferNormalizePathMatch' })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
