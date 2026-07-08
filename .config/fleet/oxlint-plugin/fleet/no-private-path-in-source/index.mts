/*
 * @file Forbid an INTERNAL / PRIVATE path reference inside a source-code
 *   comment. Mirrors the `no-private-path-in-source-guard` edit-time hook and
 *   the `scripts/fleet/check/private-paths-are-absent.mts` commit-time check
 *   (three surfaces, one rule — code is law). The incident: an agent leaked a
 *   scaffolding-repo plans-directory path into a public napi-rs source
 *   comment, disclosing internal fleet layout. Patterns:
 *     - paths under the plans or reports directories (untracked operator notes)
 *     - `socket-<repo>/.claude/…` (another fleet repo's private tree)
 *     - `/Users/<name>/…` (absolute home path — username + local layout)
 *     - `../socket-<repo>/…` (sibling fleet-repo relative path — dev-box layout)
 *   Only comments are inspected; a path in a string literal or real code is
 *   left alone. No autofix — the only correct fix is removing the reference,
 *   which the author must judge.
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// Pattern set, byte-identical to _shared/private-paths.mts (separate bundle
// trees can't share a module). Each entry's `kind` keys the message data.
const PATTERNS: ReadonlyArray<{ readonly kind: string; readonly re: RegExp }> =
  [
    {
      kind: 'an untracked .claude/plans|reports path',
      re: /(?:^|[\s"'`([{<])\.?\/?\.claude\/(?:plans|reports)\/[^\s"'`)\]}>]+/i,
    },
    {
      kind: "another fleet repo's private .claude/ tree",
      re: /(?:^|[\s"'`([{<])socket-[a-z0-9][a-z0-9-]*\/\.claude\/[^\s"'`)\]}>]*/i,
    },
    {
      kind: 'an absolute /Users/<name>/ home path',
      re: /(?:^|[\s"'`([{<])\/Users\/[^/\s"'`)\]}>]+\/[^\s"'`)\]}>]*/,
    },
    {
      kind: 'a ../socket-<repo>/ sibling fleet-repo relative path',
      re: /(?:^|[\s"'`([{<])\.\.\/socket-[a-z0-9][a-z0-9-]*\/[^\s"'`)\]}>]*/i,
    },
  ]

// Canonical fleet PLACEHOLDER owners — documentation, never a real leak. A
// comment that uses `socket-foo` (the placeholder sibling repo) or a bespoke
// single-char / ellipsis home stand-in is SHOWING the pattern it documents, not
// leaking a real path. Matched against the captured path's owner segment.
const PLACEHOLDER_MATCH_RE =
  /(?:^|[/.])(?:socket-foo\b|Users\/(?:x|me|\.\.\.)(?:\/|$))/

// A comment carrying any same-intent opt-out marker is exempt — the author is
// deliberately SHOWING the pattern (a doc example, this repo's own report path).
// Mirrors the commit-time check's SUPPRESS_RE so the two surfaces agree.
const SUPPRESS_RE =
  /socket-lint:\s*allow\s+(?:private-path|personal-path|cross-repo)\b/

/**
 * The first NON-placeholder private-path match in `value`, or undefined.
 * `value` is a comment body (delimiters stripped by oxlint). Exported for unit
 * tests.
 */
export function firstPrivatePath(
  value: string,
): { readonly kind: string; readonly match: string } | undefined {
  for (let i = 0, { length } = PATTERNS; i < length; i += 1) {
    const { kind, re } = PATTERNS[i]!
    const m = re.exec(value)
    if (m) {
      const match = m[0].replace(/^[\s"'`([{<]/, '')
      if (PLACEHOLDER_MATCH_RE.test(match)) {
        continue
      }
      return { kind, match }
    }
  }
  return undefined
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid an internal/private path (`.claude/plans|reports/…`, `socket-<repo>/.claude/…`, `/Users/<name>/…`, `../socket-<repo>/…`) inside a source-code comment; it leaks internal fleet layout into committed source.',
      category: 'Possible Errors',
      recommended: true,
    },
    schema: [],
    messages: {
      privatePath:
        'Comment references {{kind}} (`{{match}}`) — a private/internal path that leaks fleet layout into committed source. Remove it; describe the constraint, not where a plan doc lives.',
    },
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
          if (SUPPRESS_RE.test(comment.value)) {
            continue
          }
          const hit = firstPrivatePath(comment.value)
          if (!hit) {
            continue
          }
          context.report({
            node: comment as unknown as AstNode,
            messageId: 'privatePath',
            data: { kind: hit.kind, match: hit.match },
          })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
