/*
 * @file In-source bypass markers carry a fixed grammar so a reviewer (and the
 *   machinery that reads them) can tell WHAT is being bypassed and WHY. Two
 *   forms live in fleet source:
 *
 *   - A per-site oxlint disable: `oxlint-disable-next-line <rule> -- <reason>`
 *     (or `oxlint-disable-line`). The fleet requires BOTH a rule id AND a
 *     `-- <reason>` — a bare `oxlint-disable-next-line`, no rule, silences every
 *     rule on the line, and a reasonless disable hides why the gate was waived.
 *     (File-scope `oxlint-disable` with no `-next-line`/`-line` is banned
 *     outright by `socket/no-file-scope-oxlint-disable`; this rule covers the
 *     per-site forms it allows.)
 *   - A fleet plugin opt-out: `socket-lint: allow <id>` — needs a kebab `<id>`
 *     naming the rule's opt-out token. `socket-lint: allow` with no token
 *     silently fails to match the rule's bypass checker, so the rule still
 *     fires and the author is confused.
 *
 *   Placement: a `socket-lint: allow` marker belongs on its OWN line directly
 *   above the code it excuses — every enforcement surface (this plugin's
 *   leading-comment walk, the Claude guards, the git-hook scanners) honors that
 *   form, and it reads as a heading instead of trailing off the right edge. A
 *   trailing marker is flagged with an autofix that hoists it; trailing stays
 *   legal only when the line above already carries another marker (two waivers
 *   for one line need both slots).
 *
 *   The grammar findings are report-only (the missing rule/reason/id is the
 *   author's to supply); the placement finding is fixable. Default `error`.
 *   This is the only enforcement surface for the marker grammar — oxlint
 *   consumes its own disable directives but never checks that they carry a
 *   reason. Bypass: `socket-lint: allow malformed-bypass-marker`.
 */

import {
  makeBypassCommentChecker,
  MAX_LEADING_COMMENT_LINES,
  SOCKET_LINT_ALLOW_PREFIX_RE,
  SOCKET_LINT_ALLOW_WELL_FORMED_RE,
  SOCKET_LINT_MARKER_ONLY_LINE_RE,
  sourceTextOf,
} from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

// A per-site oxlint disable directive — the comment body starts with one of
// these (anchored, so a prose mention of the directive is NOT a directive).
const PERSITE_DISABLE_RE = /^oxlint-disable-(?:line|next-line)\b/

// The canonical shape: directive, at least one rule token, ` -- `, a reason.
const WELL_FORMED_DISABLE_RE =
  /^oxlint-disable-(?:line|next-line)\s+\S.*?\s--\s+\S/

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

// A line that is entirely a comment, so the bypass checker keeps walking past
// it. Mirrors the walk in comment-markers.mts.
const COMMENT_ONLY_RE = /^\s*(?:\*|\/\*|\/\/)/

/**
 * Lines between a marker comment and the first code line below it. `0` means
 * the marker shares a line with code (a trailing marker, always in range).
 * `Infinity` means there is no code below it at all — nothing to exempt.
 */
export function markerDistanceToCode(
  sourceLines: readonly string[],
  comment: AstNode,
): number {
  const startLine = comment?.loc?.start?.line
  if (typeof startLine !== 'number' || startLine < 1) {
    return 0
  }
  const ownIdx = startLine - 1
  const own = sourceLines[ownIdx] ?? ''
  // Code precedes the marker on its own line → trailing marker, distance 0.
  if (own.trim() !== '' && !COMMENT_ONLY_RE.test(own)) {
    return 0
  }
  for (let idx = ownIdx + 1; idx < sourceLines.length; idx += 1) {
    const text = sourceLines[idx] ?? ''
    if (text.trim() === '' || COMMENT_ONLY_RE.test(text)) {
      continue
    }
    return idx - ownIdx
  }
  return Number.POSITIVE_INFINITY
}

/**
 * The hoist fix for a trailing marker: one contiguous range replacement that
 * rewrites `<indent><code> // socket-lint: allow <id>` into the marker line
 * (same indent) followed by the code line, trailing spaces trimmed. Returns
 * undefined when the comment's offsets are unavailable — no fix beats a
 * corrupting one.
 */
function hoistTrailingMarkerFix(
  sourceText: string,
  comment: AstNode,
): ((fixer: RuleFixer) => unknown) | undefined {
  const cs = comment.range?.[0] ?? comment.start
  const ce = comment.range?.[1] ?? comment.end
  const startLine = comment.loc?.start?.line
  if (
    typeof cs !== 'number' ||
    typeof ce !== 'number' ||
    typeof startLine !== 'number' ||
    startLine < 1
  ) {
    return undefined
  }
  const lineStart = sourceText.lastIndexOf('\n', cs - 1) + 1
  const before = sourceText.slice(lineStart, cs)
  // Only hoist when real code precedes the marker on this line — a marker
  // already alone on its line has nothing to hoist.
  if (before.trim() === '') {
    return undefined
  }
  const indent = /^\s*/.exec(before)?.[0] ?? ''
  const commentText = sourceText.slice(cs, ce)
  const codePart = before.replace(/\s+$/, '')
  return (fixer: RuleFixer) =>
    fixer.replaceTextRange(
      [lineStart, ce],
      `${indent}${commentText}\n${codePart}`,
    )
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'In-source bypass markers must match the canonical grammar — `oxlint-disable-next-line <rule> -- <reason>` and `socket-lint: allow <id>` — so a reviewer can see what is waived and why, and sit on their own line above the code they excuse.',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      missingDisableReason:
        'Malformed oxlint disable: `{{body}}`. Use `oxlint-disable-next-line <rule> -- <reason>` — name the rule(s) being disabled AND a `-- <reason>` so the waiver is justified.',
      malformedSocketLintAllow:
        'Malformed bypass marker: `{{body}}`. Use `socket-lint: allow <id>` — name the opt-out token; a bare `socket-lint: allow` never matches the rule’s bypass checker, so the rule still fires.',
      outOfRangeSocketLintAllow:
        'Out-of-range bypass marker: `{{body}}` sits {{distance}} lines above the code it should exempt, past the {{limit}}-line lookback, so no rule will ever see it and the error stays. Move the marker to within {{limit}} lines of the code (put a long justification ABOVE the marker line, not between it and the code).',
      preferMarkerAbove:
        'Trailing bypass marker: `{{body}}`. Put the marker on its own line ABOVE the code it excuses — every enforcement surface honors that placement, and it reads as a heading instead of trailing off the right edge. Trailing stays legal only when the line above already carries another marker.',
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
        const sourceText = sourceTextOf(context)
        const hasSource = sourceText.trim() !== ''
        const sourceLines = sourceText.split('\n')
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
          let distance = ''
          let fixFn: ((fixer: RuleFixer) => unknown) | undefined
          if (PERSITE_DISABLE_RE.test(body)) {
            if (!WELL_FORMED_DISABLE_RE.test(body)) {
              messageId = 'missingDisableReason'
            }
          } else if (SOCKET_LINT_ALLOW_RE.test(body)) {
            if (!WELL_FORMED_SOCKET_LINT_RE.test(body)) {
              messageId = 'malformedSocketLintAllow'
            } else if (
              // No readable source means the distance is unknowable, so the
              // range check stays silent rather than guessing. The grammar
              // check above does not depend on it.
              hasSource &&
              markerDistanceToCode(sourceLines, c) > MAX_LEADING_COMMENT_LINES
            ) {
              // Well-formed but unreachable: the bypass checker walks up only
              // MAX_LEADING_COMMENT_LINES from the code, so a marker further
              // away is inert. That failure is otherwise SILENT — the rule
              // keeps firing and the marker looks like it should have worked.
              messageId = 'outOfRangeSocketLintAllow'
              distance = String(markerDistanceToCode(sourceLines, c))
            } else if (
              hasSource &&
              c.type === 'Line' &&
              markerDistanceToCode(sourceLines, c) === 0
            ) {
              // Well-formed but TRAILING: the preferred placement is a
              // marker-only line directly above the code — every enforcement
              // surface honors it. Trailing stays legal only when the
              // line above already carries another marker (the stacked case:
              // two waivers for one line need both slots).
              const ownIdx = (c.loc?.start?.line ?? 0) - 1
              const above = ownIdx > 0 ? (sourceLines[ownIdx - 1] ?? '') : ''
              if (!SOCKET_LINT_MARKER_ONLY_LINE_RE.test(above)) {
                messageId = 'preferMarkerAbove'
                fixFn = hoistTrailingMarkerFix(sourceText, c)
              }
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
            data: {
              body,
              distance,
              limit: String(MAX_LEADING_COMMENT_LINES),
            },
            ...(fixFn ? { fix: fixFn } : {}),
          })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
