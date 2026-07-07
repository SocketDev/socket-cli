/*
 * @file Per fleet "Code style" rule: in user-facing TEXT, three literal dots
 *   `...` should be the single ellipsis character `…` (U+2026). The ellipsis
 *   reads as one glyph, can't be confused with a truncated `..` / `....`, and
 *   matches the typography used across fleet UI copy, log messages, and docs.
 *   Detects `...` inside string literals, template-literal text, and comments.
 *   What this does NOT touch:
 *
 *   - The JS/TS spread & rest operator (`...args`, `[...arr]`, `{ ...obj }`,
 *     `function f(...rest)`). Those are syntax, not text — the rule only visits
 *     `Literal` (string) / `TemplateElement` text, so a `SpreadElement` /
 *     `RestElement` `...` is never seen.
 *   - Intentional three-dot forms inside text: path globs (`/Users/<user>/...`,
 *     `src/...`) where a `/` sits next to the dots, and CLI-usage rest-args
 *     (`foo ...args`, `run foo ... bar`) where the dots are preceded by
 *     whitespace and followed by a word. Only a WORD-FINAL / sentence ellipsis
 *     — `Loading...`, `wait....`, `done...` — is a typography slip worth
 *     fixing. Autofix: replaces the matched word-final `...` run with `…`.
 *     Allowed (skipped):
 *   - The plugin's own rules/ + test/ files (fixtures contain `...` as data).
 *   - Any text carrying a `socket-lint: allow literal-ellipsis` comment.
 */

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import { isPluginSelfFile } from '../../lib/fleet-paths.mts'
import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

// A WORD-FINAL ellipsis: 3+ dots immediately preceded by a letter/digit and
// followed by end-of-text or sentence punctuation/whitespace — NOT by a
// character that signals path/CLI/bracket notation. Rationale per disallowed
// follower:
//   - `[./]`  — path globs (`a/...`, `.../b`, `....x`).
//   - `[)\]}>]` — CLI usage / placeholder notation (`[path...]`, `(args...)`,
//     `<rest...>`), where the dots mean "one or more" and must stay literal.
// The leading `[A-Za-z0-9]` rejects CLI rest-args (`foo ...args` — dots after a
// space) and standalone `...`. `....` (word + 4 dots) is still caught — `\.{3,}`
// soaks up the run, collapsed to one `…`. The G form (used by the fixer)
// captures the leading char to preserve it.
const ELLIPSIS_TAIL = String.raw`(?![./)\]}>])`
const WORD_FINAL_ELLIPSIS_RE = new RegExp(
  String.raw`[A-Za-z0-9]\.{3,}${ELLIPSIS_TAIL}`,
)
const WORD_FINAL_ELLIPSIS_RE_G = new RegExp(
  String.raw`([A-Za-z0-9])\.{3,}${ELLIPSIS_TAIL}`,
  'g',
)

const BYPASS_RE = /socket-lint:\s*allow\s+literal-ellipsis/

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Use the ellipsis character `…` (U+2026) instead of three literal dots `...` in string / template / comment text.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      literalEllipsis:
        'Three literal dots `...` in text — use the ellipsis character `…` (U+2026). It reads as one glyph and matches fleet typography. (Spread/rest `...` operators are not flagged.) For an intentional three-dot form, add `// socket-lint: allow literal-ellipsis`.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    // This rule's own source + fixtures contain `...` as data.
    if (isPluginSelfFile(context)) {
      return {}
    }

    const hasBypassComment = makeBypassChecker(context, BYPASS_RE)
    // The fixer needs the node's raw source text to rewrite the dot-run.
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    // Report + autofix a string-literal / template node whose text contains a
    // WORD-FINAL `...` run (a real ellipsis), skipping path globs + CLI
    // rest-args. The fix rewrites the node's source text, collapsing each
    // word-final dot-run to a single `…` while keeping the preceding char.
    function checkTextNode(node: AstNode, text: string): void {
      if (!WORD_FINAL_ELLIPSIS_RE.test(text)) {
        return
      }
      if (hasBypassComment(node)) {
        return
      }
      context.report({
        node,
        messageId: 'literalEllipsis',
        fix(fixer: RuleFixer) {
          const raw = sourceCode.getText(node) as string
          return fixer.replaceText(
            node,
            raw.replace(
              WORD_FINAL_ELLIPSIS_RE_G,
              (_m, lead: string) => `${lead}…`,
            ),
          )
        },
      })
    }

    return {
      Literal(node: AstNode) {
        const v = (node as { value?: unknown | undefined }).value
        if (typeof v === 'string') {
          checkTextNode(node, v)
        }
      },
      TemplateElement(node: AstNode) {
        const cooked = (
          node as { value?: { cooked?: string | undefined } | undefined }
        ).value?.cooked
        if (typeof cooked === 'string') {
          checkTextNode(node, cooked)
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
