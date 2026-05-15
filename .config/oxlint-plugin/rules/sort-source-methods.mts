/**
 * @fileoverview Top-level function declarations should be ordered by
 * visibility group then alphanumerically within each group:
 *
 *   1. Private (un-exported) functions, sorted alphanumerically.
 *   2. Exported functions (`export function ...`), sorted alphanumerically.
 *   3. The script entrypoint (`main()` for runners) is allowed to be
 *      last regardless of name.
 *
 * Rationale: a reader scanning the file should be able to predict
 * where any function lives. Mixed-visibility ordering makes it hard
 * to find the public surface; alphabetical inside each group is
 * cheap, deterministic, and matches the rest of the fleet's sorting
 * conventions (CLAUDE.md "Sorting" rule).
 *
 * Autofix: emits a single fix that re-orders top-level function
 * declarations into canonical order. Function declarations are
 * hoisted, so reordering them is safe for runtime semantics; the
 * leading JSDoc / line-comment block above each declaration travels
 * with the function. The rule only autofixes when every function in
 * the file has a name (anonymous default exports are skipped) and
 * when there are no top-level non-function statements interleaved
 * between functions — interleaved statements can carry side-effects
 * or rely on declaration order, so we don't reshuffle around them.
 */

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const SCRIPT_ENTRY_NAMES = new Set(['main'])

/**
 * Type-only top-level statements that can travel with the function they
 * sit above. Reordering them is safe because they're erased at compile
 * time (no runtime side effects, no declaration-order semantics).
 */
function isTypeOnlyStatement(node: AstNode) {
  if (!node) {
    return false
  }
  if (
    node.type === 'TSTypeAliasDeclaration' ||
    node.type === 'TSInterfaceDeclaration'
  ) {
    return true
  }
  if (
    node.type === 'ExportNamedDeclaration' &&
    node.declaration &&
    (node.declaration.type === 'TSTypeAliasDeclaration' ||
      node.declaration.type === 'TSInterfaceDeclaration')
  ) {
    return true
  }
  // `export type { ... }` re-exports — typically grouped at top with
  // imports, but if one slipped between functions it's safe to move.
  if (
    node.type === 'ExportNamedDeclaration' &&
    node.exportKind === 'type' &&
    !node.declaration
  ) {
    return true
  }
  return false
}

function declVisibility(node: AstNode) {
  // ExportNamedDeclaration wrapping a FunctionDeclaration.
  if (
    node.type === 'ExportNamedDeclaration' &&
    node.declaration &&
    node.declaration.type === 'FunctionDeclaration'
  ) {
    return { visibility: 'export', fn: node.declaration }
  }
  // export default function ...
  if (
    node.type === 'ExportDefaultDeclaration' &&
    node.declaration &&
    node.declaration.type === 'FunctionDeclaration'
  ) {
    return { visibility: 'export', fn: node.declaration }
  }
  if (node.type === 'FunctionDeclaration') {
    return { visibility: 'private', fn: node }
  }
  return undefined
}

/**
 * Compute the sort key for a function entry. Private functions sort
 * before exports; within each group, alphanumerical by name. The
 * script entrypoint (`main`) is pinned to the end regardless of group.
 */
interface FunctionEntry {
  isEntrypoint: boolean
  name: string
  visibility: 'private' | 'export'
  node: AstNode
  start: number
  end: number
}

function sortKey(entry: FunctionEntry): string {
  if (entry.isEntrypoint) {
    // '~' (0x7E) is the highest printable ASCII char, so this sort key
    // pins the entrypoint to the end of any group.
    return '~~entrypoint'
  }
  return `${entry.visibility === 'private' ? '0' : '1'}${entry.name}`
}

/**
 * Locate the byte-range start of a function entry, including any
 * leading JSDoc / line-comment block that's contiguous with it (a
 * block separated by a blank line is treated as a free-standing
 * comment and stays put). Falls back to the node's own start when
 * there are no leading comments.
 */
function leadingCommentStart(sourceCode: AstNode, node: AstNode): number {
  const comments = sourceCode.getCommentsBefore
    ? sourceCode.getCommentsBefore(node)
    : []
  if (!comments || comments.length === 0) {
    return node.range[0]
  }
  // Walk from the last comment back, accepting any comment that's
  // separated from the next one by no more than a single newline
  // (allows a tight stack of `// foo\n// bar\n/** ... */`).
  const tokenText = sourceCode.text
  let earliest = node.range[0]
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i]
    const between = tokenText.slice(c.range[1], earliest)
    // Reject if there's a blank line between this comment and the
    // next block — that means it's a free-standing comment.
    if (/\n\s*\n/.test(between)) {
      break
    }
    earliest = c.range[0]
  }
  return earliest
}

/**
 * Locate the byte-range end of a function entry, including any
 * trailing comment that's contiguous (no blank line between) and
 * exclusive of the next function. Useful for capturing
 * c8-ignore-stop markers that pair with a start above the function
 * — those need to travel with the function when reordered.
 */
function trailingCommentEnd(
  sourceCode: AstNode,
  node: AstNode,
  nextNodeStart: number | undefined,
): number {
  const tokenText = sourceCode.text
  const comments = sourceCode.getCommentsAfter
    ? sourceCode.getCommentsAfter(node)
    : []
  let latest = node.range[1]
  if (!comments || comments.length === 0) {
    return latest
  }
  for (const c of comments) {
    if (nextNodeStart !== undefined && c.range[0] >= nextNodeStart) {
      break
    }
    const between = tokenText.slice(latest, c.range[0])
    // Reject if there's a blank line between this function and the
    // comment — that means it's a free-standing comment.
    if (/\n\s*\n/.test(between)) {
      break
    }
    latest = c.range[1]
  }
  return latest
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Top-level functions sorted by visibility (private→export) and alphanumerically within each group.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      groupOutOfOrder:
        'Top-level function `{{name}}` ({{visibility}}) appears after a function from the next visibility group. Order: private functions first (alphanumeric), then exported functions (alphanumeric).',
      alphaOutOfOrder:
        'Top-level function `{{name}}` ({{visibility}}) is out of alphanumeric order within its visibility group. Expected to come before `{{prev}}`.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    return {
      Program(programNode: AstNode) {
        // First pass: collect entries + detect violations.
        const entries: FunctionEntry[] = []
        let lastVisibilityRank = -1
        let lastNameInGroup = null
        let currentVisibility = null
        const violations = []

        // First find the next program-body node after each function, so
        // trailingCommentEnd can stop before reaching it.
        const bodyByIndex = programNode.body
        for (let i = 0; i < bodyByIndex.length; i++) {
          const node = bodyByIndex[i]
          const info = declVisibility(node)
          if (!info || !info.fn.id || info.fn.id.type !== 'Identifier') {
            continue
          }
          const name = info.fn.id.name
          const isEntrypoint = SCRIPT_ENTRY_NAMES.has(name)
          let start = leadingCommentStart(sourceCode, node)
          // Pull in any contiguous type-only statements (TS type aliases
          // / interfaces) that sit immediately above this function —
          // they're erased at compile time, have no runtime side
          // effects, and are conventionally placed next to the function
          // that consumes them. They travel with the function on sort.
          let j = i - 1
          while (j >= 0 && isTypeOnlyStatement(bodyByIndex[j])) {
            // Only absorb the type when there's no other function entry
            // between it and the current node (entries are pushed in
            // order, so the previous entry's `end` marks where the
            // previous function's range ended).
            const prevEntry = entries[entries.length - 1]
            if (prevEntry && prevEntry.end > bodyByIndex[j].range[0]) {
              break
            }
            start = leadingCommentStart(sourceCode, bodyByIndex[j])
            j -= 1
          }
          const nextStart =
            i + 1 < bodyByIndex.length ? bodyByIndex[i + 1].range[0] : undefined
          const end = trailingCommentEnd(sourceCode, node, nextStart)
          entries.push({
            node,
            name,
            visibility: info.visibility as 'private' | 'export',
            isEntrypoint,
            start,
            end,
          })

          if (isEntrypoint) {
            continue
          }

          const rank = info.visibility === 'private' ? 0 : 1

          if (rank < lastVisibilityRank) {
            violations.push({
              node: info.fn.id,
              messageId: 'groupOutOfOrder',
              data: { name, visibility: info.visibility },
            })
            continue
          }
          if (rank !== lastVisibilityRank) {
            currentVisibility = info.visibility
            lastVisibilityRank = rank
            lastNameInGroup = name
            continue
          }
          if (lastNameInGroup !== null && name < lastNameInGroup) {
            violations.push({
              node: info.fn.id,
              messageId: 'alphaOutOfOrder',
              data: {
                name,
                visibility: currentVisibility,
                prev: lastNameInGroup,
              },
            })
          } else {
            lastNameInGroup = name
          }
        }

        if (violations.length === 0) {
          return
        }

        // Build the fix once, applied via the first violation. ESLint
        // dedupes overlapping fixes, so attaching it once is enough.
        const sorted = entries.slice().sort((a, b) => {
          const ka = sortKey(a)
          const kb = sortKey(b)
          if (ka < kb) {
            return -1
          }
          if (ka > kb) {
            return 1
          }
          return 0
        })

        const orderedByPosition = entries
          .slice()
          .sort((a, b) => a.start - b.start)
        const sourceText = sourceCode.text
        const rangeStart = orderedByPosition[0]!.start
        const rangeEnd = orderedByPosition[orderedByPosition.length - 1]!.end

        // Bail if any runtime statement lives between the first and
        // last function — re-ordering would skip over them and lose
        // their side-effects / declaration-order semantics. Type-only
        // statements (TSTypeAliasDeclaration / TSInterfaceDeclaration
        // and their exported forms) are erased at compile time and are
        // already absorbed into the preceding function's range above,
        // so they don't trigger the bail.
        for (const stmt of programNode.body) {
          const isFn = entries.some(e => e.node === stmt)
          if (isFn || isTypeOnlyStatement(stmt)) {
            continue
          }
          if (stmt.range[0] >= rangeStart && stmt.range[1] <= rangeEnd) {
            // Statement is sandwiched between functions; skip autofix.
            for (const v of violations) {
              context.report(v)
            }
            return
          }
        }

        const sortedTexts = sorted.map(e => sourceText.slice(e.start, e.end))
        const replacement = sortedTexts.join('\n\n')

        // Attach the fix to the first violation only; the rest are
        // reported without a fix so the user sees what's wrong even
        // when applying without --fix.
        let fixerAttached = false
        for (const v of violations) {
          if (!fixerAttached) {
            context.report({
              ...v,
              fix(fixer: RuleFixer) {
                return fixer.replaceTextRange(
                  [rangeStart, rangeEnd],
                  replacement,
                )
              },
            })
            fixerAttached = true
          } else {
            context.report(v)
          }
        }
      },
    }
  },
}

export default rule
