/**
 * @fileoverview Per CLAUDE.md "Completion" rule: never leave TODO /
 * FIXME / XXX / shims / stubs / placeholders. Finish 100%. If too
 * large for one pass, ask before cutting scope.
 *
 * Detects the literal markers TODO, FIXME, XXX, HACK in any comment
 * (line or block). Word-boundary anchored so identifiers that happen
 * to contain "todo" (e.g., `todoStore`) don't trigger.
 *
 * No autofix: a TODO is a deferred decision; auto-removing the
 * comment would just delete the deferral note without addressing the
 * underlying gap. Reporting only — caller resolves the work or
 * promotes it to an issue/skill.
 *
 * Allowed exceptions:
 *   - The `TODO` literal inside a string or regex (intentional, e.g.
 *     a parser that detects TODO comments). Skipped automatically by
 *     scoping the rule to comment AST nodes only.
 */

const MARKER_RE = /\b(TODO|FIXME|XXX|HACK)\b/

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban TODO / FIXME / XXX / HACK markers in comments. Per CLAUDE.md "Completion" rule — finish the work or open an issue.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      banned:
        '`{{marker}}` comment — finish the work, open an issue, or ask before deferring. CLAUDE.md "Completion" rule bans deferral markers in source.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        const sourceCode = context.getSourceCode
          ? context.getSourceCode()
          : context.sourceCode
        const comments = sourceCode.getAllComments()
        for (const comment of comments) {
          const match = MARKER_RE.exec(comment.value)
          if (!match) {
            continue
          }
          context.report({
            node: comment,
            messageId: 'banned',
            data: { marker: match[1] },
          })
        }
      },
    }
  },
}

export default rule
