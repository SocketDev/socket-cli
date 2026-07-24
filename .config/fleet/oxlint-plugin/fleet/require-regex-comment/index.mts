/*
 * @file Require an explanatory comment near every non-trivial regex literal. A
 *   regex is dense, write-once-read-never syntax — the next reader (often a
 *   junior, per the CLAUDE.md comment rule) shouldn't have to mentally execute
 *   `/(?:[\s,{]|^)model\s*[:,}]/` to learn it matches a `model` property KEY.
 *   This rule flags a regex literal that has NO nearby comment, so the author
 *   (or the AI-fix step) writes a breakdown. "Nearby comment" = a `//` or block
 *   comment on the SAME line (trailing or leading), OR anywhere in the
 *   contiguous lead-in block above the regex — the comments-before-the-code
 *   plus the statement's own continuation/opener lines (`= ( [ { : , …`). That
 *   span is oxfmt-stable: the formatter reflows a regex onto its own line and
 *   nudges the comment up past a `regex:` key or `=` opener, and the rule still
 *   sees it. The walk stops at the first real prior-code line, so a comment from
 *   an unrelated block further up is never matched. Deliberately CONSERVATIVE — only
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

// regjsparser is CJS (the regexpu / Babel regex parser); a STATIC import (not
// createRequire) so rolldown inlines it into the oxlint-plugin bundle — a
// bundle-only member has no regjsparser install, and an opaque runtime
// require() left the whole plugin dead there. Default-import interop (the CJS
// module.exports object) rather than a named import: Node's cjs-module-lexer
// can't statically detect `parse` on regjsparser's exports, so the named form
// throws at source-load time in the wheelhouse. In source form it resolves from
// the rule's own package.json (`regjsparser` is a declared dependency).
import regjsparser from 'regjsparser'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const parseRegex = regjsparser.parse as unknown as (
  source: string,
  flags?: string | undefined,
  opts?: object | undefined,
) => RegjsNode

// Minimal shape of the regjsparser AST we walk. Node `type` is one of
// 'disjunction' | 'alternative' | 'group' | 'characterClass' | 'quantifier' |
// 'anchor' | 'value' | 'reference' | 'dot' | …; `body` holds children for the
// container kinds. We only read `type` + `body`, so a loose shape suffices.
interface RegjsNode {
  type: string
  body?: RegjsNode[] | undefined
  alternatives?: RegjsNode[] | undefined
}

const SOCKET_LINT_MARKER_RE =
  /(?:#|\/\*|\/\/)\s*socket-lint:\s*allow(?:\s+(?<tag>[\w-]+))?/

function isLineMarkered(line: string): boolean {
  const m = line.match(SOCKET_LINT_MARKER_RE)
  if (!m) {
    return false
  }
  const tag = m.groups?.['tag']
  return !tag || tag === 'uncommented-regex'
}

// Node kinds that make a disjunction BRANCH dense to read: a characterClass is
// a set, a group nests, a quantifier repeats. Deliberately NOT `anchor` (a `^` /
// `$` branch like `(?:$|/)` reads fine) and NOT `reference` (a backreference is
// caught separately, tree-wide). A branch built from `value` (literal chars),
// `dot`, and `anchor` reads at a glance — `tar|tgz`, `^\.config(?:$|/)`.
const STRUCTURAL_BRANCH_TYPES = new Set([
  'characterClass',
  'group',
  'quantifier',
])

const LOOKAROUND_BEHAVIORS = new Set([
  'lookahead',
  'lookbehind',
  'negativeLookahead',
  'negativeLookbehind',
])

function childrenOf(node: RegjsNode): RegjsNode[] {
  return node.body ?? node.alternatives ?? []
}

function isLookaround(node: RegjsNode): boolean {
  return (
    node.type === 'group' &&
    LOOKAROUND_BEHAVIORS.has(
      /* c8 ignore start - regjsparser always emits behavior on group nodes; ?? '' is a defensive fallback unreachable from real input */
      (node as { behavior?: string | undefined }).behavior ?? '',
      /* c8 ignore stop */
    )
  )
}

// Walk the subtree; true if any node is a branch-structural kind (a
// characterClass / capturing-or-grouping group / quantifier). A lookaround
// counts too — it's assertion logic a reader must decode.
function containsStructural(node: RegjsNode): boolean {
  if (STRUCTURAL_BRANCH_TYPES.has(node.type) || isLookaround(node)) {
    return true
  }
  const kids = childrenOf(node)
  for (let i = 0, { length } = kids; i < length; i += 1) {
    if (containsStructural(kids[i]!)) {
      return true
    }
  }
  return false
}

// Tally the structural signals across the whole tree.
//   - groups: capturing / non-capturing groups (NOT lookarounds).
//   - lookarounds: `(?=…)` / `(?<=…)` / `(?!…)` / `(?<!…)`.
//   - hasBackref: a `\1` / `\k<n>` reference.
//   - hasNonTrivialDisjunction: a `|` that is dense to read because EITHER a
//     branch carries a characterClass / group / quantifier / lookaround (e.g.
//     `(?:[\s,{]|^)`), OR the alternation is enclosed by a quantifier (the
//     repeat interacts with the choice — e.g. `(alpha|beta|gamma)+`). A plain
//     alternation of anchors + flat literals reads fine and is NOT non-trivial,
//     even inside a capturing group (capturing alone adds no reading load):
//     `tar|tgz`, `(?:tar|tgz)`, `(^|\/)` (the anchor-or-slash path idiom).
function analyze(node: RegjsNode): {
  groups: number
  lookarounds: number
  hasBackref: boolean
  hasNonTrivialDisjunction: boolean
} {
  let groups = 0
  let lookarounds = 0
  let hasBackref = false
  let hasNonTrivialDisjunction = false

  // Descend tracking whether we're under a quantifier — a repeated alternation
  // is worth a comment even when its branches are flat literals.
  function walk(
    n: RegjsNode,
    { underQuantifier }: { underQuantifier: boolean },
  ): void {
    let nextQuantifier = underQuantifier
    if (n.type === 'group') {
      if (isLookaround(n)) {
        lookarounds += 1
      } else {
        groups += 1
      }
    } else if (n.type === 'quantifier') {
      nextQuantifier = true
    } else if (n.type === 'reference') {
      hasBackref = true
    } else if (n.type === 'disjunction') {
      const branches = childrenOf(n)
      if (underQuantifier || branches.some(b => containsStructural(b))) {
        hasNonTrivialDisjunction = true
      }
    }
    const kids = childrenOf(n)
    for (let i = 0, { length } = kids; i < length; i += 1) {
      walk(kids[i]!, { underQuantifier: nextQuantifier })
    }
  }
  walk(node, { underQuantifier: false })
  return { groups, lookarounds, hasBackref, hasNonTrivialDisjunction }
}

// A regex needs an explanatory comment when its STRUCTURE is dense enough that
// a junior reader would stall. Decided from the parsed AST (precise), not a
// string heuristic:
//   - a non-trivial disjunction (a branch carrying a class / group / quantifier
//     / lookaround — a multi-way structural switch), OR
//   - 2+ groups (nested / sequential capture), OR
//   - 2+ lookarounds (stacked assertions, e.g. a password `(?=…)(?=…)` chain), OR
//   - a lookaround combined with a group (assertion layered on structure), OR
//   - a backreference (`\1` / `\k<n>`).
// A lone group, a lone char class, a flat-literal alternation (`tar|tgz`,
// `^\.config(?:$|/)`), or a single lone lookaround all read fine and stay
// exempt. If the pattern can't be parsed (an exotic construct regjsparser
// rejects), fall back to "not complex" — the rule never throws on user input.
function isComplexPattern(pattern: string, flags: string): boolean {
  let ast: RegjsNode
  try {
    ast = parseRegex(pattern, flags, { unicodePropertyEscape: true })
  } catch {
    return false
  }
  const { groups, lookarounds, hasBackref, hasNonTrivialDisjunction } =
    analyze(ast)
  if (hasNonTrivialDisjunction) {
    return true
  }
  if (groups >= 2) {
    return true
  }
  if (lookarounds >= 2) {
    return true
  }
  if (lookarounds >= 1 && groups >= 1) {
    return true
  }
  if (hasBackref) {
    return true
  }
  return false
}

// Test files document their regexes through the test name + assertion; a
// matcher in `assert.match` / `expect().toMatch` needs no separate comment.
function isTestFile(filename: string | undefined): boolean {
  // Matches filenames ending in `.test.ts`, `.test.mts`, `.test.cts`, `.test.tsx`, etc.
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
      const flags = node.regex.flags ?? ''
      if (!isComplexPattern(pattern, flags)) {
        return
      }
      const { lines } = sourceCode
      const lineIdx = node.loc.start.line - 1
      const ownLine = lines[lineIdx] ?? ''
      if (isLineMarkered(ownLine)) {
        return
      }
      // Explained when the regex's own line carries a comment, OR when a
      // comment sits anywhere in the contiguous lead-in block above it — the
      // comments-before-the-code plus any continuation/opener lines the regex
      // value spills from. A regex often wraps onto its own line (`const x =\n
      // /re/`, `s.match(\n  /re/)`, or `regex:\n  /re/`), and the formatter
      // (oxfmt) reflows it, pushing the breakdown comment a line or two up,
      // above the `=` / `(` / `regex:` opener. Accepting the whole lead-in
      // block keeps the rule and the formatter compatible: if the explanation
      // is part of the comments before the code, that satisfies it. The walk
      // stops at the first line that is NOT a lead-in (real prior code), so a
      // comment from an unrelated block further up is never matched.
      if (lineHasComment(ownLine)) {
        return
      }
      let explained = false
      for (let i = lineIdx - 1; i >= 0; i -= 1) {
        const line = lines[i] ?? ''
        if (lineHasComment(line)) {
          explained = true
          break
        }
        // A statement lead-in line ends with an operator/opener the regex value
        // continues from (`= ( [ { : , ? | & +`). Anything else is prior code.
        if (!/[=([{:,?|&+]\s*$/.test(line.trim())) {
          break
        }
      }
      if (explained) {
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
