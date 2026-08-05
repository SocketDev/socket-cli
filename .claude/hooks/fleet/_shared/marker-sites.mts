/*
 * @file Tell a real opt-out marker from a MENTION of one.
 *
 *   `// socket-lint: allow console` in a comment is a marker. The same text
 *   inside a string literal is documentation — a guard's help text, a rule's
 *   error message, a doc example. A regex cannot separate them, and that one
 *   confusion has now broken three separate efforts:
 *
 *     - the bypass-marker audit reported ~40 live suppressions as deletable,
 *       every hit being marker syntax quoted in a guard's own help text;
 *     - a second pass, narrowed to scanner-backed rules, was still 100% wrong
 *       for the same reason;
 *     - the migration to oxlint's grammar rewrote a sentence inside an
 *       AI-guidance string, and picked the wrong directive doing it, because a
 *       mid-string match reads as a trailing marker.
 *
 *   So: parse, and count a marker only when it lives in a COMMENT node. This is
 *   the shared primitive both the audit and the migration are blocked on.
 *
 *   Fail-closed. A file that will not parse reports `parsed: false` with no
 *   sites, never an empty list that reads as "no markers here" — the same
 *   blindness-is-not-absence rule the retirement sweep follows.
 */

import { tryParse, walkSimple } from './ast/core.mts'
import type { AcornNode, ParseOptions } from './ast/core.mts'

/**
 * Which spelling a marker uses. Both are live during the migration to oxlint's
 * grammar; `legacy` is the bespoke `socket-lint: allow <id>` form.
 */
export type MarkerSpelling = 'legacy' | 'oxlint'

/**
 * One genuine opt-out marker, located in a comment.
 */
export interface MarkerSite {
  /**
   * The rule the marker names. Undefined for the bare `socket-lint: allow`
   * blanket form, which names none — the oxlint spelling always names one.
   */
  id: string | undefined
  /**
   * 1-based line of the comment's opening marker.
   */
  line: number
  /**
   * True when the comment starts its own line, so it covers the line BELOW.
   * False for a trailing comment, which covers the line it sits on. This is
   * the distinction that decides `-next-line` vs `-line`.
   */
  ownLine: boolean
  spelling: MarkerSpelling
}

/**
 * The result of scanning one file. `parsed` is the honest half: false means
 * the source could not be parsed, so the empty `sites` list carries no
 * information. A caller that treats it as "no markers" reintroduces exactly
 * the bug this module exists to remove.
 */
export interface MarkerScan {
  parsed: boolean
  sites: MarkerSite[]
}

// Matched against a comment's BODY — the text between the markers — so these
// carry no `//` / `#` / `/*` prefix of their own. Searched anywhere in the
// body, not anchored, because a marker may follow other prose on the line.
const LEGACY_IN_BODY_RE = /socket-lint:\s*allow(?:\s+([\w-]+))?/

// `oxlint-disable`, then an optional `next-` (group 1, present for the
// own-line form and absent for the trailing one), `line`, then the
// `socket/`-scoped rule name in group 2.
const OXLINT_IN_BODY_RE = /oxlint-disable-(next-)?line\s+socket\/([\w-]+)/

// A comment opens its own line when the trimmed source line for that comment
// begins with a comment opener. `CommentSite.text` is already that trimmed
// line, so no re-slicing of the source is needed.
const LINE_STARTS_WITH_COMMENT_RE = /^(?:#|\/\*|\/\/)/

/**
 * The marker a comment body names, or undefined when it names none. Pure and
 * prefix-free: pass the body, not the whole line.
 */
export function markerInCommentBody(
  body: string,
):
  | { id: string | undefined; index: number; spelling: MarkerSpelling }
  | undefined {
  const oxlint = OXLINT_IN_BODY_RE.exec(body)
  if (oxlint) {
    return { id: oxlint[2], index: oxlint.index, spelling: 'oxlint' }
  }
  const legacy = LEGACY_IN_BODY_RE.exec(body)
  if (legacy) {
    return { id: legacy[1], index: legacy.index, spelling: 'legacy' }
  }
  return undefined
}

/**
 * Every genuine marker in `source`, located by parsing rather than scanning.
 * Marker text inside a string or template literal is never reported: this walk
 * only ever visits comment nodes, so a literal is not merely filtered out — it
 * is never seen.
 *
 * `options` forwards to the parser for callers that need a non-default source
 * type; `comments` is always forced on.
 */
export function findMarkerSites(
  source: string,
  options?: ParseOptions | undefined,
): MarkerScan {
  if (tryParse(source, options) === undefined) {
    return { parsed: false, sites: [] }
  }
  const literals = stringLiteralRanges(source, options)
  const sites: MarkerSite[] = []
  const lines = source.split('\n')
  // UTF-8 BYTE offset of the current line's start. The parser reports node
  // ranges in bytes while a JS string index counts UTF-16 code units, so the
  // two only agree on pure ASCII. Fleet prose is full of em-dashes; mixing the
  // spaces drifts the comparison by a byte per non-ASCII character and silently
  // mis-answers every containment test after the first one.
  let lineStart = 0
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const marker = markerInCommentBody(line)
    if (marker) {
      const at = lineStart + Buffer.byteLength(line.slice(0, marker.index))
      if (!offsetIsInsideAny(at, literals)) {
        sites.push({
          id: marker.id,
          line: i + 1,
          ownLine: LINE_STARTS_WITH_COMMENT_RE.test(line.trim()),
          spelling: marker.spelling,
        })
      }
    }
    lineStart += Buffer.byteLength(line) + 1
  }
  return { parsed: true, sites }
}

/**
 * Byte ranges of every string and template literal in `source`. A marker whose
 * offset lands inside one is a MENTION — a guard's help text, a rule's error
 * message, a doc example — not an opt-out.
 *
 * Ranges rather than comment nodes on purpose. The parser's comment
 * attachment is unreliable at the pinned version — the same reason
 * `lib/comment-markers.mts` line-scans instead of reading comment APIs — and
 * it silently returned 1 of 9 real markers on a real file, mangling the body
 * of the one it did return. Literal ranges come straight off node
 * `start`/`end`, which the parser gets right.
 */
export function stringLiteralRanges(
  source: string,
  options?: ParseOptions | undefined,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const record = (node: AcornNode): void => {
    ranges.push([node.start, node.end])
  }
  walkSimple(
    source,
    {
      Literal: (node: AcornNode) => {
        // Only string literals can host marker prose; a number or regex
        // literal cannot contain one.
        if (typeof node['value'] === 'string') {
          record(node)
        }
      },
      TemplateLiteral: record,
    },
    options,
  )
  return ranges
}

/**
 * Whether `offset` falls inside any of `ranges`. Linear: a source file's
 * literal count is small, and a sort-plus-binary-search would cost more to
 * read than it saves.
 */
export function offsetIsInsideAny(
  offset: number,
  ranges: ReadonlyArray<readonly [number, number]>,
): boolean {
  for (let i = 0, { length } = ranges; i < length; i += 1) {
    const range = ranges[i]!
    if (offset >= range[0] && offset < range[1]) {
      return true
    }
  }
  return false
}

/**
 * The oxlint directive that preserves a marker's meaning at its position:
 * a comment on its own line covers the line below (`-next-line`), a trailing
 * comment covers the line it sits on (`-line`). Naming this mapping once keeps
 * the migration from having to re-derive it per call site.
 */
export function directiveFor(site: MarkerSite): string {
  return site.ownLine ? 'oxlint-disable-next-line' : 'oxlint-disable-line'
}
