/*
 * @file Per CLAUDE.md "File size" rule: Source files have a soft cap of 500
 *   lines and a hard cap of 1000 lines. Past those thresholds, split the file
 *   along its natural seams. Two severities:
 *
 *   - > 500 lines (soft band, 501–1000): warning. The file MUST split — there is
 *     no exemption marker in this band. A top-of-file `max-file-lines:` marker is
 *     IGNORED here; the warning fires regardless. Split along a natural seam.
 *   - > 1000 lines (hard cap): error. No autofix — splitting requires judgment
 *     about where the natural seams are.
 *
 *   The marker exempts ONLY a file past the HARD cap (>1000): the rare genuine
 *   case where one cohesive unit (a single function that needs the space, a
 *   generated artifact, an exhaustive table) truly can't split. Form:
 *   `max-file-lines: <category> — <reason>` — a category word naming WHAT the
 *   file is (parser, state-machine, table, cli, …) plus a `—`/`-`/`:`-separated
 *   reason for WHY it can't split. The filler word `legitimate` is NOT a category
 *   (it was the loophole that let a padded test dodge splitting). Say what the
 *   file is, not that you deem it acceptable. A soft-band file CANNOT use this
 *   marker to dodge the cap — the cap forces the split.
 *
 *   Generated artifacts: the rule trusts .config/fleet/oxlintrc.json's
 *   ignorePatterns to keep generated files out of scope.
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'
import { isLockstepMirror } from '../../lib/lockstep-mirror.mts'

const SOFT_CAP = 500
const HARD_CAP = 1000

// A file self-exempts with `max-file-lines: <category> — <reason>`: a real
// category word (parser, state-machine, table, cli, …) followed by a `—`/`-`/
// `:`-separated justification. `<category> — <reason>` is the whole contract —
// the category names WHAT the file is, the reason says WHY it can't split. The
// filler word `legitimate` is NOT a category: `max-file-lines: legitimate …`
// does not exempt. "No blanket file exclusions" — say what it is, not that you
// deem it OK.
const BYPASS_RE = /max-file-lines:\s*(?!legitimate\b)[a-z][a-z-]*\s*[—:-]\s*\S/i

/**
 * @type {import('eslint').Rule.RuleModule}
 */
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

  create(context: RuleContext) {
    // Verbatim upstream mirrors keep upstream's shape; see lib/lockstep-mirror.mts.
    if (isLockstepMirror(context)) {
      return {}
    }
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    return {
      Program(node: AstNode) {
        // Trust the parser's location info — `loc.end.line` is the
        // 1-indexed line of the last token. Empty trailing lines are
        // counted as part of the source per the line-counting
        // convention CLAUDE.md uses.
        const lines = node.loc.end.line

        if (lines <= SOFT_CAP) {
          return
        }

        // The bypass marker is HARD-CAP-ONLY. A file in the soft band
        // (501–1000) can NEVER exempt itself — it must split. The marker
        // exempts only a file PAST the hard cap (>1000): the rare genuine
        // single-function/cohesive-unit case. So a soft-band file falls
        // straight through to the `soft` report regardless of any marker.
        if (lines > HARD_CAP) {
          // Bypass detection — scan leading comments only. A bypass
          // comment buried 600 lines deep doesn't communicate intent at
          // the file level.
          const leadingComments = sourceCode
            .getAllComments()
            .filter((c: AstNode) => c.loc.start.line <= 5)
          for (let i = 0, { length } = leadingComments; i < length; i += 1) {
            const c = leadingComments[i]!
            if (BYPASS_RE.test(c.value)) {
              return
            }
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

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
