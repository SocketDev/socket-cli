/*
 * @file The fleet does not deprecate — it deletes. There is no `@deprecated`
 *   marker, no legacy fallback, no back-compat alias kept "until consumers
 *   migrate"; when a thing is replaced or removed, it and its call sites go in
 *   the same change. This rule bans the one machine-checkable signal of that
 *   anti-pattern: a `@deprecated` (or `@obsolete`) JSDoc/comment annotation. It
 *   fires on the annotation FORM only — a line whose first non-comment token is
 *   the tag (a `* @deprecated` JSDoc continuation, a `// @deprecated` line, a
 *   block comment opened with the tag) — so an inline prose mention of the word
 *   (this very sentence, a doc) does not trip.
 *   The broader "no legacy fallback / no alias" doctrine is too semantic to
 *   lint precisely; it lives in the topic doc. Skips:
 *
 *   - Test files (`*.test.*`) — fixtures legitimately embed the marker.
 *   - A line carrying `socket-lint: allow deprecated-marker` (the rare case of
 *     quoting an upstream API's own `@deprecated` in a comment).
 *
 *   No autofix — deleting deprecated code + rewiring its callers is not a
 *   mechanical specifier rewrite; the author does the removal.
 */

import { isTestFile } from '../../lib/test-file.mts'
import type { RuleContext } from '../../lib/rule-types.mts'

// The JSDoc/comment annotation form of a deprecation marker: a line whose first
// non-whitespace content is a comment opener (`/**`, `/*`, `*`, `//`) followed
// immediately by the `@deprecated` or `@obsolete` tag. Anchored at line start so
// an inline prose mention (`* the @deprecated tag`) is NOT matched.
const DEPRECATION_ANNOTATION_RE =
  /^\s*(?:\*|\/\*\*?|\/\/)\s*@(?:deprecated|obsolete)\b/

// socket-lint: allow deprecated-marker -- opt-out for a comment quoting an
// upstream API's own deprecation tag verbatim.
const BYPASS_RE = /socket-lint:\s*allow\s+deprecated-marker/

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban `@deprecated` / `@obsolete` markers — the fleet deletes rather than deprecates.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      banned:
        "`@deprecated` marker — the fleet deletes, it does not deprecate. Remove the code and its call sites in this change; there are no legacy fallbacks or back-compat aliases kept 'until consumers migrate'. If you are quoting an upstream API's own tag, append `// socket-lint: allow deprecated-marker`.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.getFilename?.() ?? context.physicalFilename ?? ''
    if (isTestFile(filename)) {
      return {}
    }
    // The spawned-oxlint plugin host exposes source lines via `sourceCode.lines`
    // (its `getText()` is absent there); the in-process test harness exposes
    // `getText()`. Read `.lines` when present, else split whichever raw-text
    // accessor the host offers. Self-contained: no shared-lib dependency, so a
    // parallel refactor of the comment-markers helper can't break this rule.
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    return {
      Program() {
        const rawText =
          typeof sourceCode?.getText === 'function'
            ? sourceCode.getText()
            : (sourceCode?.text ?? '')
        const lines = Array.isArray(sourceCode?.lines)
          ? (sourceCode.lines as string[])
          : String(rawText).split('\n')
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]!
          if (!DEPRECATION_ANNOTATION_RE.test(line) || BYPASS_RE.test(line)) {
            continue
          }
          const column = line.length - line.trimStart().length
          context.report({
            loc: { line: i + 1, column },
            messageId: 'banned',
          })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
