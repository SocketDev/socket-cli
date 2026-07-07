/*
 * @file Generic nested named-block parser for comment-delimited regions.
 *
 *   Markers are HTML-element-like, wrapped in the host file's comment syntax
 *   (`<!-- … -->`, `#`, or `//`). The canonical (bare-tag) form uses only the
 *   HTML open/close tags without redundant keywords:
 *
 *     <!-- <fleet-canonical id="standards"> -->   # open tag + attributes
 *       …fleet-managed content…
 *       <!-- <fleet-canonical id="extra"> -->     # nested, like HTML
 *       <!-- </fleet-canonical> -->
 *     <!-- </fleet-canonical> -->                 # bare close tag
 *
 *     # <fleet-canonical id="ignores">
 *     # </fleet-canonical>
 *
 *     // <fleet-canonical>
 *     // </fleet-canonical>
 *
 *   The legacy form (`BEGIN`/`END` keywords before the tag) is recognized for
 *   backward compatibility during the transition — members on the old emitter
 *   still parse correctly until they are re-cascaded to the bare-tag form:
 *
 *     <!-- BEGIN <fleet-canonical> -->   ← legacy open
 *     <!-- END </fleet-canonical> -->    ← legacy close
 *
 *   Grammar:
 *     - The OPEN marker carries an HTML open tag `<tag key="value" bool …>` —
 *       `tag` is a hyphenated kebab name, attributes are zero+ HTML-style pairs
 *       (`key="value"`) or bare boolean attributes (`bool`). The tag + its
 *       attributes are parsed by neosanitize's zero-dependency WHATWG parser,
 *       so attribute quoting / boolean attrs behave exactly like HTML.
 *       Attributes are PARSED but not yet consumed by any caller (a disabled
 *       seam — wired in, gated off); a future cascade feature can read them
 *       without a grammar change.
 *     - The CLOSE marker is a bare close tag `</tag>` — no attributes.
 *     - Blocks NEST and must be BALANCED by tag name, like HTML elements.
 *       the WHATWG parser is lenient (it never errors on bad nesting), so the
 *       "nested-but-not-malformed → reject" rule is enforced HERE by a
 *       stack walk over the marker sequence: overlap (`BEGIN a … BEGIN b …
 *       END a`), an unclosed open, or a close with no open match are
 *       MALFORMED — reported, never auto-fixed.
 *
 *   The fleet cascade manages blocks tagged `fleet-canonical`. This is the
 *   single shared primitive every fleet-block matcher/fixer builds on, so the
 *   marker grammar can't drift between them.
 */

import { find, parse } from 'neosanitize/whatwg-parser'

import type { ElementNode } from 'neosanitize/whatwg-parser'

export interface NamedBlock {
  readonly tag: string
  readonly attributes: Readonly<Record<string, string>>
  // 0-based line index of the BEGIN marker.
  readonly beginLine: number
  // 0-based line index of the END marker.
  readonly endLine: number
  // Nesting depth (0 = top level).
  readonly depth: number
  readonly children: readonly NamedBlock[]
}

export type MalformedKind = 'mismatch' | 'orphan-end' | 'unclosed'

export interface Malformed {
  readonly kind: MalformedKind
  readonly tag: string
  // 0-based line index of the offending marker.
  readonly line: number
  readonly message: string
}

export interface ParsedBlocks {
  // Top-level blocks; nested blocks hang off each block's `children`.
  readonly roots: readonly NamedBlock[]
  readonly malformed: readonly Malformed[]
  readonly wellFormed: boolean
}

export interface MarkerLine {
  readonly kind: 'begin' | 'end'
  readonly tag: string
  readonly attributes: Readonly<Record<string, string>>
  // 0-based line index.
  readonly line: number
}

// An OPEN marker line: optional indent, a comment opener (`<!--` / `#`+ / `//`),
// an optional legacy `BEGIN` keyword, an HTML open tag `<tag …>` (captured
// whole, handed to the parser), then an optional `-->` close. Accepts both the
// canonical bare-tag form (`# <fleet-canonical>`) and the legacy keyword form
// (`# BEGIN <fleet-canonical>`) for backward compatibility.
const OPEN_MARKER_RE =
  /^\s*(?:<!--|#+|\/\/)\s*(?:BEGIN\s+)?(<[A-Za-z][^>]*>)\s*(?:-->)?\s*$/i
// A CLOSE marker line: an optional legacy `END` keyword + a bare close tag
// `</tag>`. Accepts both `# </fleet-canonical>` and `# END </fleet-canonical>`.
const CLOSE_MARKER_RE =
  /^\s*(?:<!--|#+|\/\/)\s*(?:END\s+)?<\/\s*([A-Za-z][A-Za-z0-9-]*)\s*>\s*(?:-->)?\s*$/i

const EMPTY_ATTRS: Readonly<Record<string, string>> = Object.freeze({
  __proto__: null,
} as unknown as Record<string, string>)

interface OpenFrame {
  tag: string
  attributes: Readonly<Record<string, string>>
  beginLine: number
  children: NamedBlock[]
}

/**
 * Parse a single HTML open tag (`<tag key="value" bool>`) with neosanitize and
 * return its lowercased name + attributes, or `undefined` if no tag is found.
 * Boolean attributes (no `="value"`) map to an empty string.
 */
export function parseOpenTag(
  tagHtml: string,
): { tag: string; attributes: Record<string, string> } | undefined {
  // The WHATWG parser wraps input in an html/head/body document; the marker is
  // the first element that isn't that synthesized scaffold (fleet markers are
  // custom tags — fleet-canonical, socket-*, etc. — never html/head/body).
  const element = find(
    parse(tagHtml),
    (el: ElementNode) =>
      el.name !== 'body' && el.name !== 'head' && el.name !== 'html',
  )
  if (!element) {
    return undefined
  }
  const attributes: Record<string, string> = {
    __proto__: null,
  } as unknown as Record<string, string>
  // neosanitize exposes attributes as [name, value] tuples; a boolean attr's
  // value is the empty string (so bare boolean attrs map to '').
  for (let i = 0, { length } = element.attrs; i < length; i += 1) {
    const pair = element.attrs[i]!
    attributes[pair[0].toLowerCase()] = pair[1]
  }
  return { tag: element.name.toLowerCase(), attributes }
}

/**
 * Scan every line for a BEGIN/END marker, returning them in document order.
 * Open-tag names + attributes come from the WHATWG parser; tags are lowercased.
 */
export function scanMarkers(content: string): MarkerLine[] {
  const out: MarkerLine[] = []
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const open = OPEN_MARKER_RE.exec(line)
    if (open) {
      const parsed = parseOpenTag(open[1]!)
      if (parsed) {
        out.push({
          kind: 'begin',
          tag: parsed.tag,
          attributes: parsed.attributes,
          line: i,
        })
      }
      continue
    }
    const close = CLOSE_MARKER_RE.exec(line)
    if (close) {
      out.push({
        kind: 'end',
        tag: close[1]!.toLowerCase(),
        attributes: EMPTY_ATTRS,
        line: i,
      })
    }
  }
  return out
}

/**
 * Parse `content` into a tree of balanced named blocks. Reports every
 * malformedness (overlap, unclosed BEGIN, orphan END) instead of throwing, so
 * callers can decide to skip the file and surface a finding.
 */
export function parseNamedBlocks(content: string): ParsedBlocks {
  const markers = scanMarkers(content)
  const malformed: Malformed[] = []
  const roots: NamedBlock[] = []
  const stack: OpenFrame[] = []
  for (let i = 0, { length } = markers; i < length; i += 1) {
    const marker = markers[i]!
    if (marker.kind === 'begin') {
      stack.push({
        tag: marker.tag,
        attributes: marker.attributes,
        beginLine: marker.line,
        children: [],
      })
      continue
    }
    if (stack.length === 0) {
      malformed.push({
        kind: 'orphan-end',
        tag: marker.tag,
        line: marker.line,
        message: `END </${marker.tag}> (line ${marker.line + 1}) has no open BEGIN.`,
      })
      continue
    }
    const top = stack[stack.length - 1]!
    if (top.tag !== marker.tag) {
      malformed.push({
        kind: 'mismatch',
        tag: marker.tag,
        line: marker.line,
        message: `END </${marker.tag}> (line ${marker.line + 1}) does not close the open <${top.tag}> (line ${top.beginLine + 1}); blocks must nest, not overlap.`,
      })
      continue
    }
    stack.pop()
    const block: NamedBlock = {
      tag: top.tag,
      attributes: top.attributes,
      beginLine: top.beginLine,
      endLine: marker.line,
      depth: stack.length,
      children: top.children,
    }
    if (stack.length === 0) {
      roots.push(block)
    } else {
      stack[stack.length - 1]!.children.push(block)
    }
  }
  for (let i = 0, { length } = stack; i < length; i += 1) {
    const frame = stack[i]!
    malformed.push({
      kind: 'unclosed',
      tag: frame.tag,
      line: frame.beginLine,
      message: `BEGIN <${frame.tag}> (line ${frame.beginLine + 1}) is never closed.`,
    })
  }
  return { roots, malformed, wellFormed: malformed.length === 0 }
}

/**
 * Depth-first flatten of a block tree into a single list (parents before
 * children).
 */
export function flattenBlocks(roots: readonly NamedBlock[]): NamedBlock[] {
  const out: NamedBlock[] = []
  const queue: NamedBlock[] = [...roots]
  while (queue.length) {
    const block = queue.shift()!
    out.push(block)
    queue.unshift(...block.children)
  }
  return out
}

/**
 * Find every block with the given tag (case-insensitive), at any nesting depth.
 * Returns an empty list when the content is malformed.
 */
export function findBlocksByTag(content: string, tag: string): NamedBlock[] {
  const parsed = parseNamedBlocks(content)
  if (!parsed.wellFormed) {
    return []
  }
  const wanted = tag.toLowerCase()
  return flattenBlocks(parsed.roots).filter(block => block.tag === wanted)
}
