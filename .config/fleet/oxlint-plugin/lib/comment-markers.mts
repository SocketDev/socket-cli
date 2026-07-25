/**
 * @file Shared "is there a bypass marker adjacent to this node?" scanner used
 *   by the rules that support an inline opt-out comment
 *   (`no-which-for-local-bin` → `socket-lint: allow which-lookup`,
 *   `prefer-ellipsis-char` → `socket-lint: allow literal-ellipsis`,
 *   `use-fleet-canonical-api-token-getter` → `socket-api-token-getter: allow
 *   direct-env`). Why a source-text line scan instead of the AST comment APIs:
 *   at the catalog-pinned oxlint version the plugin engine's
 *   `getCommentsBefore` / `getCommentsAfter` return nothing for the nodes these
 *   rules report on, so a comment-attachment approach silently fails to
 *   suppress. Scanning the raw source by line is engine-version-independent.
 *   `makeBypassChecker(context, bypassRe)` reads the source once per
 *   `create(context)` call and returns `hasBypassComment(node)`. A node is
 *   bypassed when the marker appears on the node's own line (trailing comment)
 *   or in the contiguous block of comment lines directly above it — the walk
 *   stops at the first non-comment, non-blank line so the marker must be
 *   genuinely adjacent, not somewhere arbitrary earlier in the file.
 */

import type { AstNode, RuleContext } from './rule-types.mts'

// How far up a leading-comment block to look for the marker. A leading marker
// comment may wrap onto a couple of continuation lines, so allow a few.
const MAX_LEADING_COMMENT_LINES = 3

// A line that is entirely a comment (`//`, `/*`, or a `*` block continuation).
// Used to keep walking upward through a contiguous comment block.
const COMMENT_LINE_RE = /^\s*(?:\*|\/\*|\/\/)/

// Canonical `socket-lint: allow <id>` opt-out marker grammar, defined once here
// (the marker-reading home) so consumers can't drift: a rule builds its bypass
// regex via `socketLintAllowRe(<id>)` for `makeBypassChecker`, and the
// `socket/no-malformed-bypass-marker` validator reuses these `.source` strings
// (anchored) to decide what is well-formed. `<id>` is lowercase-kebab. Regexes
// are UNANCHORED — the reader line-scans raw source; a consumer needing
// "comment starts with the marker" anchors via `new RegExp('^' + RE.source)`.
export const SOCKET_LINT_ALLOW_PREFIX_RE = /socket-lint\s*:\s*allow\b/
export const SOCKET_LINT_ALLOW_WELL_FORMED_RE =
  /socket-lint\s*:\s*allow\s+[a-z0-9][a-z0-9-]*/

/**
 * Build a rule's `socket-lint: allow <id>` bypass regex from the canonical
 * grammar. Pass the result to `makeBypassChecker` so every rule's opt-out
 * marker shares one definition.
 */
export function socketLintAllowRe(id: string): RegExp {
  return new RegExp(`socket-lint\\s*:\\s*allow\\s+${id}`)
}

/**
 * The socket-lint-owned bypass checker: build a `hasBypassComment(node)` for a
 * rule's `socket-lint: allow <id>` opt-out by `id` alone — no hand-written
 * regex at the call site. This is the ONE place the `socket-lint:` opt-out is
 * matched, so a rule can't mis-spell the grammar; `makeBypassChecker` stays the
 * generic primitive for other marker namespaces (e.g. `socket-api-token-getter:
 * allow <id>`). A rule does: `const allowed = makeBypassCommentChecker(context,
 * 'my-opt-out-id')`.
 */
export function makeBypassCommentChecker(
  context: RuleContext,
  id: string,
): (node: AstNode) => boolean {
  return makeBypassChecker(context, socketLintAllowRe(id))
}

/**
 * The raw source text for the file being linted, across the context shapes the
 * oxlint plugin engine exposes (`getSourceCode().getText()` vs a `sourceCode`
 * with `getText()` or a `.text` field).
 */
export function sourceTextOf(context: RuleContext): string {
  const sourceCode = context.getSourceCode
    ? context.getSourceCode()
    : context.sourceCode
  if (typeof sourceCode?.getText === 'function') {
    return sourceCode.getText()
  }
  return (sourceCode as { text?: string | undefined })?.text ?? ''
}

/**
 * 1-based start line of a node, derived from `loc` when present, else by
 * counting newlines up to the node's start offset in `sourceText`. Returns -1
 * when neither is available.
 */
function nodeStartLine(node: AstNode, sourceText: string): number {
  const locLine = (
    node as {
      loc?: { start?: { line?: number | undefined } | undefined } | undefined
    }
  )?.loc?.start?.line
  if (typeof locLine === 'number') {
    return locLine
  }
  const start = (node as { range?: [number, number] | undefined }).range?.[0]
  if (typeof start !== 'number') {
    return -1
  }
  let line = 1
  for (let i = 0; i < start && i < sourceText.length; i += 1) {
    if (sourceText[i] === '\n') {
      line += 1
    }
  }
  return line
}

/**
 * Build a `hasBypassComment(node)` predicate for `bypassRe`, reading the source
 * once. True when the marker is on the node's own line or in the contiguous
 * comment block immediately above it.
 */
export function makeBypassChecker(
  context: RuleContext,
  bypassRe: RegExp,
): (node: AstNode) => boolean {
  const sourceText = sourceTextOf(context)
  const sourceLines = sourceText.split('\n')

  return function hasBypassComment(node: AstNode): boolean {
    const line = nodeStartLine(node, sourceText)
    if (line < 1) {
      return false
    }
    // sourceLines is 0-indexed; node line is 1-based, so the node's own line
    // is sourceLines[line - 1]. Check that (trailing-comment case) first.
    const ownIdx = line - 1
    if (
      ownIdx >= 0 &&
      ownIdx < sourceLines.length &&
      bypassRe.test(sourceLines[ownIdx]!)
    ) {
      return true
    }
    // Then walk up through a contiguous leading-comment block.
    for (
      let idx = ownIdx - 1;
      idx >= 0 && idx >= ownIdx - MAX_LEADING_COMMENT_LINES;
      idx -= 1
    ) {
      const text = sourceLines[idx]!
      if (bypassRe.test(text)) {
        return true
      }
      // Stop once we pass a non-comment, non-blank line: the marker must be in
      // the comment block adjacent to the read, not arbitrarily earlier.
      if (text.trim() !== '' && !COMMENT_LINE_RE.test(text)) {
        break
      }
    }
    return false
  }
}

// Canonical single-file lockstep-mirror marker. A verbatim upstream mirror — a
// shim kept byte-close to its upstream source so it stays trivially diffable
// when upstream bumps — carries ONE header line naming the upstream source plus
// the SHA it was copied at:
//
//   // @lockstep-mirror packages/core/src/lib/yoga.ts @ 0c8c4f7cff2927e3df63a9757a45eff9a343611c
//
// It is the single-file analogue of the multi-file `BEGIN LOCK-STEP HEADER`
// block — same "name the upstream source + sha" provenance convention, one line
// because a verbatim mirror has exactly one upstream source. `<upstream-path>`
// is a non-whitespace token: the path inside the upstream submodule (a file-fork
// row's `upstream_path`) or the upstream module a conformance shim re-exposes.
// `<sha>` is the 40-hex upstream commit the mirror was copied at, reusing the
// lockstep schema's FULL_SHA_PATTERN. Like the `socket-lint:` markers above the
// regex is UNANCHORED — the reader line-scans the raw header. Defined ONCE here
// (the marker-reading home) so rules, the validator, and the format-deriver
// can't drift on the grammar.
export const LOCKSTEP_MIRROR_MARKER_RE =
  /@lockstep-mirror\s+(\S+)\s+@\s+([0-9a-f]{40})/

export interface LockstepMirrorMarker {
  readonly upstreamPath: string
  readonly sha: string
}

/**
 * Parse the `@lockstep-mirror <upstream-path> @ <sha>` header marker from a
 * file's source text. The marker must live in the leading comment block —
 * before the first non-comment statement, the same first-lines header window
 * `max-file-lines` scans — so a stray match deep in the file (a doc example, a
 * fixture string) can't turn an arbitrary file into a declared mirror. Returns
 * the parsed `{ upstreamPath, sha }`, or undefined when no well-formed marker
 * is present in the header. A raw-line scan, engine-version-independent,
 * exactly like `makeBypassChecker`.
 */
export function parseLockstepMirrorMarker(
  sourceText: string,
): LockstepMirrorMarker | undefined {
  const lines = sourceText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const trimmed = line.trim()
    // Skip a leading shebang and any blank lines ahead of the comment block.
    if (trimmed === '' || trimmed.startsWith('#!')) {
      continue
    }
    // The marker must sit in the leading comment block: stop at the first
    // real (non-comment) line so a later match in the file body never counts.
    if (!COMMENT_LINE_RE.test(line)) {
      break
    }
    const m = LOCKSTEP_MIRROR_MARKER_RE.exec(line)
    if (m) {
      return { upstreamPath: m[1]!, sha: m[2]! }
    }
  }
  return undefined
}
