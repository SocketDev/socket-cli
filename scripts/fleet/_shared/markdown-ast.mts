/**
 * @file One owner for "parse this markdown the way GitHub renders it". The
 *   README pin and the changelog flows all need structure answers — where a
 *   heading is, whether a block carries bullets, which refs are images — and
 *   answering those with line scans or string patterns misreads content as
 *   structure: a `## ` or `- ` inside a fenced code block is text, not a
 *   heading or an entry. Parsing to a position-tracked mdast tree (GFM, so
 *   tables/footnotes/strikethrough parse as their real constructs) gives every
 *   consumer byte- and line-accurate positions to edit against, with no
 *   serializer round-trip — untouched bytes stay byte-identical.
 */

import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

import type { Nodes, Root } from 'mdast'

/** Parse markdown to a position-tracked mdast tree with the GFM extensions. */
export function parseMarkdownGfm(source: string): Root {
  return fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
}

/**
 * 0-based line indexes of the document's level-2 (`## `) headings, from
 * parser-reported positions. The changelog flows treat `## ` headings as
 * section boundaries; reading them from the tree means a `## ` line inside a
 * fenced code block is never mistaken for one.
 */
export function h2LineIndexes(source: string): number[] {
  const indexes: number[] = []
  for (const node of parseMarkdownGfm(source).children) {
    if (
      node.type === 'heading' &&
      node.depth === 2 &&
      node.position?.start.line !== undefined
    ) {
      indexes.push(node.position.start.line - 1)
    }
  }
  return indexes
}

/**
 * True when the tree under `node` contains a real list item. The changelog
 * flows use this as "does this section carry at least one entry" — a `- `
 * lookalike inside a code fence parses as code, not a listItem, and does not
 * count.
 */
export function hasListItem(node: Nodes): boolean {
  if (node.type === 'listItem') {
    return true
  }
  if ('children' in node) {
    return node.children.some(hasListItem)
  }
  return false
}
