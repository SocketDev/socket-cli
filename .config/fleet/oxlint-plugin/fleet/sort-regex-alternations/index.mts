/*
 * @file Sort regex alternation groups alphanumerically. Per CLAUDE.md "Sorting"
 *   rule extended to alternation: `(b|a)` should be `(a|b)` so the regex reads
 *   in the same order as the rest of the fleet's sorted-by-default style.
 *   Detects:
 *
 *   - Capturing groups: `(foo|bar|baz)` → require sorted order.
 *   - Non-capturing groups: `(?:foo|bar)` → same.
 *   - Named-capture: `(?<name>foo|bar)` → same. Allowed exceptions (skipped):
 *   - Single-alternative groups (`(foo)`) — nothing to sort.
 *   - Position-bearing alternations where order encodes precedence (e.g.
 *     `<!--|-->` where `-->` MUST be tried after `<!--`). The rule can't prove
 *     this is the case, so it requires authors to append `// socket-lint: allow
 *     regex-alternation-order` on the line for the genuine exception.
 *   - Alternations whose elements aren't simple literals (containing `(`, `[`,
 *     `?`, `*`, `+`, `{`, etc.) — sorting may change match semantics in subtle
 *     ways. Reported but not auto-fixed. Autofix: rewrites the alternation in
 *     alphanumeric order when every element is a "simple literal" (alphanumeric
 *     / underscore / hyphen / colon / dot / forward-slash content). For richer
 *     alternations, reports without autofix.
 */

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

interface AltRange {
  start: number
  end: number
}

interface StackEntry {
  start: number
  prefixEnd: number
  alts: AltRange[]
  altStart: number
}

interface AlternationGroup {
  altsRanges: AltRange[]
  end: number
  prefixEnd: number
  start: number
}

const SOCKET_LINT_MARKER_RE =
  /(?:#|\/\*|\/\/)\s*socket-lint:\s*allow(?:\s+(?<tag>[\w-]+))?/

const SIMPLE_ALT_ELEMENT_RE = /^[\w\-:./]+$/

function isLineMarkered(line: string): boolean {
  const m = line.match(SOCKET_LINT_MARKER_RE)
  if (!m) {
    return false
  }
  const tag = m.groups?.['tag']
  return !tag || tag === 'regex-alternation-order'
}

/**
 * Find every alternation group in a regex pattern. Returns `{ start, end,
 * prefix, alternatives, suffix }` for each group. Walks the pattern character
 * by character to handle nested groups + character classes correctly.
 */
function findAlternationGroups(pattern: string): AlternationGroup[] {
  const groups: AlternationGroup[] = []
  // Stack entries: { start: idx of '(' in original, alts: [{start, end}], altStart: idx }
  const stack: StackEntry[] = []
  let inClass = false
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (inClass) {
      if (c === ']') {
        inClass = false
      }
      i++
      continue
    }
    if (c === '[') {
      inClass = true
      i++
      continue
    }
    if (c === '(') {
      // Skip group-prefix syntax: `(?:`, `(?=`, `(?!`, `(?<name>`, `(?<=`, `(?<!`.
      let prefixEnd = i + 1
      let prefix = '('
      if (pattern[prefixEnd] === '?') {
        prefix += '?'
        prefixEnd++
        const next = pattern[prefixEnd]
        if (next === ':' || next === '!' || next === '=') {
          prefix += next
          prefixEnd++
        } else if (next === '<') {
          prefix += '<'
          prefixEnd++
          // Read named capture name or lookbehind anchor.
          const after = pattern[prefixEnd]
          if (after === '!' || after === '=') {
            prefix += after
            prefixEnd++
          } else {
            // Named capture group: read name then `>`.
            while (prefixEnd < pattern.length && pattern[prefixEnd] !== '>') {
              prefix += pattern[prefixEnd]
              prefixEnd++
            }
            if (prefixEnd < pattern.length) {
              prefix += '>'
              prefixEnd++
            }
          }
        }
      }
      stack.push({ start: i, prefixEnd, alts: [], altStart: prefixEnd })
      i = prefixEnd
      continue
    }
    if (c === '|' && stack.length > 0) {
      const top = stack[stack.length - 1]!
      top.alts.push({ start: top.altStart, end: i })
      top.altStart = i + 1
      i++
      continue
    }
    if (c === ')') {
      const top = stack.pop()
      if (top) {
        top.alts.push({ start: top.altStart, end: i })
        if (top.alts.length > 1) {
          groups.push({
            altsRanges: top.alts,
            end: i,
            prefixEnd: top.prefixEnd,
            start: top.start,
          })
        }
      }
      i++
      continue
    }
    i++
  }
  return groups
}

/**
 * True if any alternative is a prefix of another distinct alternative. When
 * this holds, alternation order is semantically load-bearing (leftmost match
 * wins), so the group must not be sorted OR flagged — alphabetical order would
 * be wrong. e.g. `js` is a prefix of `jsx`.
 */
export function hasPrefixOverlap(alts: readonly string[]): boolean {
  for (let i = 0, { length } = alts; i < length; i += 1) {
    for (let j = 0; j < length; j += 1) {
      if (i !== j && alts[j]!.startsWith(alts[i]!)) {
        return true
      }
    }
  }
  return false
}

/**
 * True if any alternative contains an unescaped position anchor — `^` (start)
 * or `$` (end). Such an alternation mixes a zero-width position with literal
 * text (the `(^|\/)` "start-of-path or a slash" idiom, or `(^|$)`): the
 * branches are different KINDS, not interchangeable values, so no alphanumeric
 * order between them is meaningful and sorting only makes the pattern read
 * worse. Skip these entirely — neither sort nor flag — like prefix-overlap
 * groups. An escaped `\^` / `\$` is a literal, not an anchor, so it doesn't
 * count.
 */
export function hasAnchorBranch(alts: readonly string[]): boolean {
  return alts.some(alt => {
    for (let i = 0, { length } = alt; i < length; i += 1) {
      const ch = alt[i]
      if ((ch === '^' || ch === '$') && alt[i - 1] !== '\\') {
        return true
      }
    }
    return false
  })
}

/**
 * Sort an alternation in alphanumeric order. Returns null if any element isn't
 * a simple literal (caller should report-only).
 */
function sortAlternativesIfSimple(
  pattern: string,
  group: AlternationGroup,
): { actual: string[]; sorted: string[] } | undefined {
  const alts = group.altsRanges.map((r: AltRange) =>
    pattern.slice(r.start, r.end),
  )
  const allSimple = alts.every((a: string) => SIMPLE_ALT_ELEMENT_RE.test(a))
  if (!allSimple) {
    return undefined
  }
  // Prefix-overlap guard: JS alternation is leftmost-match-wins, so if one alt
  // is a prefix of another (`js`/`jsx`), reordering them changes which match
  // wins — `/(jsx|js)/.exec('jsx')` is `jsx`, but `/(js|jsx)/.exec('jsx')` is
  // `js`. Alphabetical sort always puts the shorter prefix first, so autofixing
  // here would silently change behavior. Bail to the report-only path.
  if (hasPrefixOverlap(alts)) {
    return undefined
  }
  const sorted = [...alts].toSorted()
  if (alts.every((a: string, i: number) => a === sorted[i])) {
    return undefined
  }
  return { actual: alts, sorted }
}

/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Sort regex alternation groups alphanumerically per the CLAUDE.md sorting rule.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      unsorted:
        'Regex alternation `({{actual}})` is not sorted alphanumerically. Expected `({{sorted}})`.',
      unsortedNoFix:
        'Regex alternation `({{actual}})` is not sorted alphanumerically. Expected `({{sorted}})`. (Not auto-fixed: contains non-literal elements; sort manually or append `// socket-lint: allow regex-alternation-order` if the order is intentional.)',
    },
    schema: [],
  },

  create(context: RuleContext) {
    function checkLiteral(node: AstNode) {
      if (!node.regex) {
        return
      }
      const sourceCode = context.getSourceCode
        ? context.getSourceCode()
        : context.sourceCode
      const line = sourceCode.lines[node.loc.start.line - 1] ?? ''
      if (isLineMarkered(line)) {
        return
      }
      const pattern = node.regex.pattern
      const groups = findAlternationGroups(pattern)
      for (let i = 0, { length } = groups; i < length; i += 1) {
        const group = groups[i]!
        // Position-anchored alternations (`(^|\/)`, `(^|$)`) mix a zero-width
        // anchor with literal text — different kinds, no meaningful order.
        // Skip entirely (neither sort nor flag), like prefix-overlap groups.
        const groupAlts = group.altsRanges.map((r: AltRange) =>
          pattern.slice(r.start, r.end),
        )
        if (hasAnchorBranch(groupAlts)) {
          continue
        }
        const result = sortAlternativesIfSimple(pattern, group)
        if (!result) {
          // Not simple: still flag if alternation is unsorted (caller picks).
          const alts = group.altsRanges.map((r: AltRange) =>
            pattern.slice(r.start, r.end),
          )
          // Prefix-overlap groups are order-sensitive (leftmost match wins);
          // neither sorting nor "sort manually" is correct advice — skip them.
          if (hasPrefixOverlap(alts)) {
            continue
          }
          const sortedRaw = [...alts].toSorted()
          if (alts.every((a: string, idx: number) => a === sortedRaw[idx])) {
            continue
          }
          context.report({
            node,
            messageId: 'unsortedNoFix',
            data: {
              actual: alts.join('|'),
              sorted: sortedRaw.join('|'),
            },
          })
          continue
        }
        // Build the replacement pattern, then escape the slashes for
        // RegExp literal form when emitting the autofix.
        const before = pattern.slice(0, group.prefixEnd)
        const after = pattern.slice(group.end)
        const newPattern = before + result.sorted.join('|') + after

        context.report({
          node,
          messageId: 'unsorted',
          data: {
            actual: result.actual.join('|'),
            sorted: result.sorted.join('|'),
          },
          fix(fixer: RuleFixer) {
            const flags = node.regex.flags || ''
            return fixer.replaceText(node, `/${newPattern}/${flags}`)
          },
        })
      }
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
