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
 * No autofix: re-ordering function declarations is too risky to
 * automate (a `const` that depends on a function declared later via
 * hoisting could break, and TS type narrowing can move with declaration
 * order). Reporting only — caller re-orders manually.
 */

const SCRIPT_ENTRY_NAMES = new Set(['main'])

function declVisibility(node) {
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
  return null
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
    messages: {
      groupOutOfOrder:
        'Top-level function `{{name}}` ({{visibility}}) appears after a function from the next visibility group. Order: private functions first (alphanumeric), then exported functions (alphanumeric).',
      alphaOutOfOrder:
        'Top-level function `{{name}}` ({{visibility}}) is out of alphanumeric order within its visibility group. Expected to come before `{{prev}}`.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program(programNode) {
        let lastVisibilityRank = -1
        let lastNameInGroup = null
        let currentVisibility = null

        for (const node of programNode.body) {
          const info = declVisibility(node)
          if (!info || !info.fn.id || info.fn.id.type !== 'Identifier') {
            continue
          }
          const name = info.fn.id.name
          if (SCRIPT_ENTRY_NAMES.has(name)) {
            // Skip the entrypoint — allowed anywhere.
            continue
          }

          const rank = info.visibility === 'private' ? 0 : 1

          if (rank < lastVisibilityRank) {
            context.report({
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
            context.report({
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
      },
    }
  },
}

export default rule
