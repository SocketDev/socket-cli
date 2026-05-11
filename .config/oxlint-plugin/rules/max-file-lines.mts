/**
 * @fileoverview Per CLAUDE.md "File size" rule:
 *
 *   Source files have a soft cap of 500 lines and a hard cap of 1000
 *   lines. Past those thresholds, split the file along its natural
 *   seams.
 *
 * Two severities:
 *   - >500 lines: warning, with the message pointing at the splitting
 *     guidance in CLAUDE.md.
 *   - >1000 lines: error.
 *
 * No autofix — splitting requires judgment about where the natural
 * seams are. The rule's job is to make the cap visible at every
 * commit.
 *
 * Allowed exceptions:
 *   - Files marked at the top with a comment containing
 *     `max-file-lines: legitimate parser/state-machine/table` or
 *     `eslint-disable socket/max-file-lines`. Per CLAUDE.md the rare
 *     legitimate cases are parsers, state machines, and config tables;
 *     they should self-document with a one-line comment.
 *   - Generated artifacts — the rule trusts .oxlintrc.json's
 *     ignorePatterns to keep generated files out of scope.
 */

const SOFT_CAP = 500
const HARD_CAP = 1000

const BYPASS_RE =
  /max-file-lines:\s*(legitimate|parser|state[- ]?machine|table)/i

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Files have a soft cap of 500 lines (warn) and a hard cap of 1000 lines (error). Split along natural seams.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      soft: '{{lines}} lines — past the 500-line soft cap. Consider splitting along natural seams (one tool / domain / phase per file). See CLAUDE.md "File size".',
      hard: '{{lines}} lines — past the 1000-line hard cap. Split this file. See CLAUDE.md "File size".',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    return {
      Program(node) {
        // Trust the parser's location info — `loc.end.line` is the
        // 1-indexed line of the last token. Empty trailing lines are
        // counted as part of the source per the line-counting
        // convention CLAUDE.md uses.
        const lines = node.loc.end.line

        if (lines <= SOFT_CAP) {
          return
        }

        // Bypass detection — scan leading comments only. A bypass
        // comment buried 600 lines deep doesn't communicate intent at
        // the file level.
        const leadingComments = sourceCode
          .getAllComments()
          .filter(c => c.loc.start.line <= 5)
        for (const c of leadingComments) {
          if (BYPASS_RE.test(c.value)) {
            return
          }
        }

        const messageId = lines > HARD_CAP ? 'hard' : 'soft'
        // Anchor the report at line 1 — the file as a whole is the
        // problem, not any specific node.
        context.report({
          loc: { line: 1, column: 0 },
          messageId,
          data: { lines: String(lines) },
        })
      },
    }
  },
}

export default rule
