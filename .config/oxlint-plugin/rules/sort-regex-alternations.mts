/**
 * @fileoverview Sort regex alternation groups alphanumerically. Per
 * CLAUDE.md "Sorting" rule extended to alternation: `(b|a)` should be
 * `(a|b)` so the regex reads in the same order as the rest of the
 * fleet's sorted-by-default style.
 *
 * Detects:
 *   - Capturing groups: `(foo|bar|baz)` → require sorted order.
 *   - Non-capturing groups: `(?:foo|bar)` → same.
 *   - Named-capture: `(?<name>foo|bar)` → same.
 *
 * Allowed exceptions (skipped):
 *   - Single-alternative groups (`(foo)`) — nothing to sort.
 *   - Position-bearing alternations where order encodes precedence
 *     (e.g. `<!--|-->` where `-->` MUST be tried after `<!--`). The
 *     rule can't prove this is the case, so it requires authors to
 *     append `// socket-hook: allow regex-alternation-order` on the
 *     line for the genuine exception.
 *   - Alternations whose elements aren't simple literals (containing
 *     `(`, `[`, `?`, `*`, `+`, `{`, etc.) — sorting may change
 *     match semantics in subtle ways. Reported but not auto-fixed.
 *
 * Autofix: rewrites the alternation in alphanumeric order when every
 * element is a "simple literal" (alphanumeric / underscore / hyphen
 * / colon / dot / forward-slash content). For richer alternations,
 * reports without autofix.
 */

const SOCKET_HOOK_MARKER_RE =
  /(?:#|\/\/|\/\*)\s*socket-hook:\s*allow(?:\s+([\w-]+))?/

const SIMPLE_ALT_ELEMENT_RE = /^[\w\-:./]+$/

function isLineMarkered(line) {
  const m = line.match(SOCKET_HOOK_MARKER_RE)
  if (!m) {
    return false
  }
  return !m[1] || m[1] === 'regex-alternation-order'
}

/**
 * Find every alternation group in a regex pattern. Returns
 * `{ start, end, prefix, alternatives, suffix }` for each group.
 * Walks the pattern character by character to handle nested groups +
 * character classes correctly.
 */
function findAlternationGroups(pattern) {
  const groups = []
  // Stack entries: { start: idx of '(' in original, alts: [{start, end}], altStart: idx }
  const stack = []
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
        if (next === ':' || next === '=' || next === '!') {
          prefix += next
          prefixEnd++
        } else if (next === '<') {
          prefix += '<'
          prefixEnd++
          // Read named capture name or lookbehind anchor.
          const after = pattern[prefixEnd]
          if (after === '=' || after === '!') {
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
      const top = stack[stack.length - 1]
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
 * Sort an alternation in alphanumeric order. Returns null if any
 * element isn't a simple literal (caller should report-only).
 */
function sortAlternativesIfSimple(pattern, group) {
  const alts = group.altsRanges.map(r => pattern.slice(r.start, r.end))
  const allSimple = alts.every(a => SIMPLE_ALT_ELEMENT_RE.test(a))
  if (!allSimple) {
    return null
  }
  const sorted = [...alts].sort()
  if (alts.every((a, i) => a === sorted[i])) {
    return null
  }
  return { actual: alts, sorted }
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
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
        'Regex alternation `({{actual}})` is not sorted alphanumerically. Expected `({{sorted}})`. (Not auto-fixed: contains non-literal elements; sort manually or append `// socket-hook: allow regex-alternation-order` if the order is intentional.)',
    },
    schema: [],
  },

  create(context) {
    function checkLiteral(node) {
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
      for (const group of groups) {
        const result = sortAlternativesIfSimple(pattern, group)
        if (!result) {
          // Not simple: still flag if alternation is unsorted (caller picks).
          const alts = group.altsRanges.map(r => pattern.slice(r.start, r.end))
          const sortedRaw = [...alts].sort()
          if (alts.every((a, i) => a === sortedRaw[i])) {
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
          fix(fixer) {
            const flags = node.regex.flags || ''
            return fixer.replaceText(node, `/${newPattern}/${flags}`)
          },
        })
      }
    }

    return {
      Literal(node) {
        checkLiteral(node)
      },
    }
  },
}

export default rule
