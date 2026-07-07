/*
 * @file In-source bypass markers carry a fixed grammar so a reviewer (and the
 *   machinery that reads them) can tell WHAT is being bypassed and WHY. Two
 *   forms live in fleet source:
 *
 *   - A per-site oxlint disable: `oxlint-disable-next-line <rule> -- <reason>`
 *     (or `oxlint-disable-line`). The fleet requires BOTH a rule id AND a
 *     `-- <reason>` — a bare `oxlint-disable-next-line` (no rule) silences every
 *     rule on the line, and a reasonless disable hides why the gate was waived.
 *     (File-scope `oxlint-disable` with no `-next-line`/`-line` is banned
 *     outright by `socket/no-file-scope-oxlint-disable`; this rule covers the
 *     per-site forms it allows.)
 *   - A fleet plugin opt-out: `socket-lint: allow <id>` — needs a kebab `<id>`
 *     naming the rule's opt-out token. `socket-lint: allow` with no token
 *     silently fails to match the rule's bypass checker, so the rule still
 *     fires and the author is confused.
 *
 *   Report-only: the fix is to add the missing rule/reason/id, which only the
 *   author knows. Default `error`. This is the only enforcement surface for the
 *   marker grammar — oxlint consumes its own disable directives but never checks
 *   that they carry a reason. Bypass: `socket-lint: allow malformed-bypass-marker`.
 */

import {
  makeBypassCommentChecker,
  SOCKET_LINT_ALLOW_PREFIX_RE,
  SOCKET_LINT_ALLOW_WELL_FORMED_RE,
} from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// A per-site oxlint disable directive — the comment body starts with one of
// these (anchored, so a prose mention of the directive is NOT a directive).
const PERSITE_DISABLE_RE = /^oxlint-disable-(?:next-line|line)\b/

// The canonical shape: directive, at least one rule token, ` -- `, a reason.
const WELL_FORMED_DISABLE_RE =
  /^oxlint-disable-(?:next-line|line)\s+\S.*?\s--\s+\S/

// The `socket-lint: allow` grammar comes from the shared marker home; anchor it
// to the comment body so a prose mention isn't treated as a directive.
const SOCKET_LINT_ALLOW_RE = new RegExp(
  `^${SOCKET_LINT_ALLOW_PREFIX_RE.source}`,
)
const WELL_FORMED_SOCKET_LINT_RE = new RegExp(
  `^${SOCKET_LINT_ALLOW_WELL_FORMED_RE.source}`,
)

// This rule's own opt-out id — the socket-lint-owned checker builds the regex.
const ALLOW_ID = 'malformed-bypass-marker'

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'In-source bypass markers must match the canonical grammar — `oxlint-disable-next-line <rule> -- <reason>` and `socket-lint: allow <id>` — so a reviewer can see what is waived and why.',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      missingDisableReason:
        'Malformed oxlint disable: `{{body}}`. Use `oxlint-disable-next-line <rule> -- <reason>` — name the rule(s) being disabled AND a `-- <reason>` so the waiver is justified.',
      malformedSocketLintAllow:
        'Malformed bypass marker: `{{body}}`. Use `socket-lint: allow <id>` — name the opt-out token; a bare `socket-lint: allow` never matches the rule’s bypass checker, so the rule still fires.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassCommentChecker(context, ALLOW_ID)
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    return {
      Program(_node: AstNode) {
        const comments =
          (sourceCode.getAllComments && sourceCode.getAllComments()) || []
        for (let i = 0, { length } = comments; i < length; i += 1) {
          const c = comments[i]!
          const raw = c.value || ''
          // Skip JSDoc blocks — prose + examples of the marker shape, not
          // live directives.
          if (c.type === 'Block' && raw.trimStart().startsWith('*')) {
            continue
          }
          const body = raw.trim()
          let messageId: string | undefined
          if (PERSITE_DISABLE_RE.test(body)) {
            if (!WELL_FORMED_DISABLE_RE.test(body)) {
              messageId = 'missingDisableReason'
            }
          } else if (SOCKET_LINT_ALLOW_RE.test(body)) {
            if (!WELL_FORMED_SOCKET_LINT_RE.test(body)) {
              messageId = 'malformedSocketLintAllow'
            }
          }
          if (!messageId) {
            continue
          }
          if (hasBypassComment(c as AstNode)) {
            continue
          }
          context.report({
            node: c as AstNode,
            messageId,
            data: { body },
          })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
