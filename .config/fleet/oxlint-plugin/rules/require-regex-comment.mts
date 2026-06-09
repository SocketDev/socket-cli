/**
 * @file Require an explanatory comment near every non-trivial regex literal. A
 *   regex is dense, write-once-read-never syntax — the next reader (often a
 *   junior, per the CLAUDE.md comment rule) shouldn't have to mentally execute
 *   `/(?:[\s,{]|^)model\s*[:,}]/` to learn it matches a `model` property KEY.
 *   This rule flags a regex literal that has NO adjacent comment, so the author
 *   (or the AI-fix step) writes a breakdown. "Adjacent comment" = a `//` or
 *   block comment on the SAME line (trailing or leading) OR on the line
 *   immediately above the regex. That's where a reader looks; a comment ten
 *   lines up doesn't explain this pattern. Deliberately CONSERVATIVE — only
 *   flag a GENUINELY-COMPLEX regex, one that combines two or more of the
 *   structural features that make a pattern hard to read at a glance: groups
 *   (`(…)` / `(?:…)` / `(?<n>…)`), alternations (`a|b`), lookarounds (`(?=…)` /
 *   `(?<=…)` / `(?!…)` / `(?<!…)`), backreferences (`\1` / `\k<n>`). A
 *   single-feature pattern (a lone char class `/[^\w\s]/`, a lone group
 *   `/(\d+)/`, a literal-with-escaped-dots `/gone\.js/`, `/\s+/`) reads fine
 *   and is exempt. The bar is "would a junior stall on this?" Also skipped:
 *
 *   - Test files (`*.test.mts` / `*.test.ts`): a regex in `assert.match` /
 *     `expect().toMatch` is an assertion documented by the test's own name.
 *     Escape (per-call-site, when a complex pattern is still obvious in
 *     context): append `// socket-lint: allow uncommented-regex` on the regex's
 *     line. Report-only — NO deterministic autofix: a comment's CONTENT can't
 *     be mechanically derived from the pattern. The AI-fix orchestrator
 *     (`scripts/fleet/ai-lint-fix/`) handles this rule: it reads each flagged
 *     regex and writes a part-by-part breakdown comment. See AI_HANDLED_RULES +
 *     RULE_MODEL_TIER (tier: sonnet — the model must reason about the
 *     pattern).
 */

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const SOCKET_LINT_MARKER_RE =
  /(?:#|\/\/|\/\*)\s*socket-lint:\s*allow(?:\s+([\w-]+))?/

function isLineMarkered(line: string): boolean {
  const m = line.match(SOCKET_LINT_MARKER_RE)
  if (!m) {
    return false
  }
  return !m[1] || m[1] === 'uncommented-regex'
}

// Count how many TIMES the group/lookaround probes match — a pattern with
// several groups is the genuinely-dense case, not one anchored group with a
// two-literal alternation (`/^\.config(?:$|\/)/` reads fine). We require real
// structural density, not just "uses a group + an alternation".
function countMatches(pattern: string, re: RegExp): number {
  const g = new RegExp(
    re.source,
    re.flags.includes('g') ? re.flags : `${re.flags}g`,
  )
  let n = 0
  while (g.exec(pattern)) {
    n += 1
  }
  return n
}

// A regex is complex enough to require a comment when EITHER:
//   - it has 2+ groups (nested / sequential capture is where readers get lost), OR
//   - it uses a lookaround AND a group (assertion logic layered on structure), OR
//   - it has a TOP-LEVEL alternation between non-trivial branches (each branch
//     itself contains a group/class/quantifier — a multi-way structural switch).
// A single group, a single char class, an anchored two-literal alternation, or
// a lone lookaround all read fine and are exempt.
function isComplexPattern(pattern: string): boolean {
  const groups = countMatches(pattern, /\((?!\?[=!])/)
  if (groups >= 2) {
    return true
  }
  const hasLookaround = /\(\?<?[=!]/.test(pattern)
  if (hasLookaround && groups >= 1) {
    return true
  }
  const hasBackref = /\\(?:[1-9]|k<)/.test(pattern)
  if (hasBackref) {
    return true
  }
  return false
}

// Test files document their regexes through the test name + assertion; a
// matcher in `assert.match` / `expect().toMatch` needs no separate comment.
function isTestFile(filename: string | undefined): boolean {
  return !!filename && /\.test\.[cm]?tsx?$/.test(filename)
}

// Does a line carry an EXPLANATORY comment? A `//` or `/* */` anywhere on it —
// but a `socket-lint:` lint directive is NOT an explanation (it's machinery, of
// any category), so a line whose only comment is such a directive doesn't
// count. (We don't judge comment QUALITY beyond that — presence of real prose
// is the gate; the AI-fix writes a good one, and a human can too.)
function lineHasComment(line: string | undefined): boolean {
  if (!line) {
    return false
  }
  // Drop any socket-lint directive before looking for a real comment.
  const withoutDirective = line.replace(SOCKET_LINT_MARKER_RE, '')
  return (
    withoutDirective.includes('//') ||
    withoutDirective.includes('/*') ||
    withoutDirective.includes('*/')
  )
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require an explanatory comment near every non-trivial regex literal so a junior reader understands the pattern without executing it.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    // No deterministic fix — the AI-fix step writes the comment content.
    messages: {
      uncommented:
        'Complex regex `{{pattern}}` (combines groups / alternation / lookaround / backreference) has no adjacent explanatory comment. Add a `//` breakdown on the line above (what each part matches) for a junior reader, or append `// socket-lint: allow uncommented-regex` if it is obvious in context.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    // Test-file regexes are assertions documented by the test name — skip the
    // whole file.
    if (isTestFile(context.filename ?? context.getFilename?.())) {
      return {}
    }
    function checkLiteral(node: AstNode) {
      if (!node.regex) {
        return
      }
      const pattern = node.regex.pattern
      if (!isComplexPattern(pattern)) {
        return
      }
      const { lines } = sourceCode
      const lineIdx = node.loc.start.line - 1
      const ownLine = lines[lineIdx] ?? ''
      if (isLineMarkered(ownLine)) {
        return
      }
      // Explained when the regex's own line OR the line directly above carries
      // a comment — the two places a reader looks for the pattern's intent.
      const lineAbove = lineIdx > 0 ? lines[lineIdx - 1] : undefined
      if (lineHasComment(ownLine) || lineHasComment(lineAbove)) {
        return
      }
      context.report({
        node,
        messageId: 'uncommented',
        data: { pattern: `/${pattern}/` },
      })
    }

    return {
      Literal(node: AstNode) {
        checkLiteral(node)
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
