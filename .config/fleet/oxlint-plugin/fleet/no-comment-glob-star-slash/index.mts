/**
 * @file Forbid a star-then-slash glob sequence inside a block comment. oxfmt's
 *   jsdoc reflow rewrites comment prose and unescapes a glob such as
 *   double-star-slash-star-dot-yml, leaving a star immediately before a slash —
 *   which is the comment-closing token. The block then ends early and the rest
 *   of the file becomes a parse error (oxfmt produces output it cannot
 *   re-parse). No oxfmt sub-option preserves the escape, and even
 *   backtick-wrapping the whole glob fails when the backticked text still
 *   contains a literal star-then-slash. The fix that holds: split the glob on
 *   every star-then-slash boundary and backtick each side so no literal
 *   star-then-slash survives (double-star-slash-star-dot-yml becomes the
 *   backtick-split form). This rule flags any block comment whose prose
 *   contains a star-immediately-before-slash sequence (escaped backslash-slash
 *   included) and autofixes it to the backtick-split form. Line comments are
 *   exempt — they have no closing token to break. The comment's own trailing
 *   close token is not matched (it is the close, not prose).
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// Walk the comment text char by char, tracking backtick depth. At every
// star-run-then-optional-backslash-then-slash boundary seen OUTSIDE a backtick
// span, insert a backtick break so the stars and the slash land in separate
// backtick runs (the stars get their own run; the rest of the glob token gets
// one). A boundary already inside backticks is left alone — so the transform is
// idempotent (re-running on fixed text is a no-op) and never doubles a backtick.
//   double-star-slash-star-dot-yml      -> backtick-stars + slash + backtick-rest
//   escaped backslash form               -> same (the backslash is dropped)
//   an already-backtick-split occurrence -> unchanged
// Returns the rewritten text; equal to the input when there was nothing to fix.
export function backtickSplitGlobs(value: string): string {
  let out = ''
  let inTick = false
  for (let i = 0, { length } = value; i < length; i += 1) {
    const c = value[i]!
    if (c === '`') {
      inTick = !inTick
      out += c
      continue
    }
    if (!inTick && c === '*') {
      let j = i
      while (value[j] === '*') {
        j += 1
      }
      let k = j
      if (value[k] === '\\') {
        k += 1
      }
      if (value[k] === '/') {
        // Boundary found: emit `<stars>`/` then the rest of the glob token
        // (non-space, non-backtick) wrapped in its own backtick run.
        const stars = value.slice(i, j)
        let m = k + 1
        while (m < length && !/\s/.test(value[m]!) && value[m] !== '`') {
          m += 1
        }
        out += `\`${stars}\`/\`${value.slice(k + 1, m)}\``
        i = m - 1
        continue
      }
    }
    out += c
  }
  return out
}

// Does the comment body carry a star-then-slash sequence in prose, OUTSIDE any
// backtick span (an already-backtick-split glob is fine)? `value` is the comment
// text without the delimiters, so the fix and the detector use the same walk:
// the body needs a fix exactly when re-emitting it would differ.
function bodyHasGlobStarSlash(value: string): boolean {
  return backtickSplitGlobs(value) !== value
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Forbid a `*/`-forming glob sequence in a block comment; oxfmt's jsdoc reflow turns it into a comment-closing token and corrupts the file. Backtick-split the glob instead.",
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      globStarSlash:
        "Block comment contains `{{snippet}}` — a `*`-before-`/` glob that oxfmt's jsdoc reflow rewrites into a comment-closing `*/`, breaking the file. Backtick-split it so no literal `*/` survives (e.g. `**`/`*.yml` becomes `` `**`/`*.yml` ``).",
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    return {
      Program() {
        const comments = sourceCode.getAllComments
          ? sourceCode.getAllComments()
          : []
        for (let i = 0, { length } = comments; i < length; i += 1) {
          const comment = comments[i]!
          // Line comments have no closing token to break — only block comments
          // are at risk.
          if (comment.type !== 'Block') {
            continue
          }
          if (!bodyHasGlobStarSlash(comment.value)) {
            continue
          }
          // First offending token, for the message only (the fix rewrites every
          // occurrence). Match a star-run + optional backslash + slash + tail.
          const m = /\*+\\?\/\S*/.exec(comment.value)
          /* c8 ignore start - bodyHasGlobStarSlash true guarantees m is non-null; the else arm is unreachable */
          const snippet = m ? m[0].replace(/\\\//, '/') : '*/'
          /* c8 ignore stop */
          context.report({
            node: comment as unknown as AstNode,
            messageId: 'globStarSlash',
            data: { snippet },
            fix(fixer: { replaceText: (n: unknown, text: string) => unknown }) {
              // Rebuild the whole comment with every glob backtick-split. The
              // comment range covers the `/*`...`*/` delimiters; reconstruct
              // them around the fixed body so the close token is untouched.
              const fixedBody = backtickSplitGlobs(comment.value)
              return fixer.replaceText(comment, `/*${fixedBody}*/`)
            },
          })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
