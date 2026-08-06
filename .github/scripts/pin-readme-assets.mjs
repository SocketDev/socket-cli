// Registry pages (npmjs.com) render the README from the published tarball,
// where relative `assets/…` refs 404 — they only resolve when viewing the
// repo on GitHub. Rewrite them to the release tag's raw-GitHub URL before the
// packs, so every variant ships absolute, immutable asset URLs. The CI
// workspace is ephemeral, so no restore pass is needed. Mirrors
// socket-wheelhouse's publish-infra pin-readme pass; absolute refs are
// untouched and the rewrite is idempotent — an already-absolute ref has no
// leading `assets/` to pin.
//
// The README is parsed to a position-tracked mdast tree and edits land on the
// exact byte ranges the parser reports, never via a scan of the raw markdown:
// `assets/` inside a code fence or an inline code span is content, not a ref,
// and stays as written. Raw HTML arrives as mdast `html` nodes; each node's
// source slice goes through parse5 with source locations on, and only
// `src`/`srcset` attribute values that start with `assets/` are pinned.
import { readFileSync, writeFileSync } from 'node:fs'

import { fromMarkdown } from 'mdast-util-from-markdown'
import { parseFragment } from 'parse5'

const RELATIVE_PREFIX = 'assets/'
const PINNED_ATTRS = new Set(['src', 'srcset'])

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const base = `https://raw.githubusercontent.com/SocketDev/socket-cli/v${version}/`
const readme = readFileSync('README.md', 'utf8')

/**
 * Byte offsets in the README where `base` gets inserted, each sitting
 * immediately before a relative ref's leading `assets/`.
 * @type {number[]}
 */
const insertAt = []

/** @param {import('mdast').Nodes} node */
function walkMdast(node) {
  if (
    node.type === 'image' ||
    node.type === 'link' ||
    node.type === 'definition'
  ) {
    collectMarkdownUrl(node)
  } else if (node.type === 'html') {
    collectHtmlAttrs(node)
  }
  if ('children' in node) {
    for (const child of node.children) {
      walkMdast(child)
    }
  }
}

/**
 * An image, link, or definition node carries its destination in `url` and its
 * own span in `position`. The destination is the last occurrence of that url
 * inside the span (label text precedes it), so the insertion point derives
 * from the node position rather than a scan of the document.
 * @param {import('mdast').Image | import('mdast').Link | import('mdast').Definition} node
 */
function collectMarkdownUrl(node) {
  if (!node.url.startsWith(RELATIVE_PREFIX)) {
    return
  }
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (start === undefined || end === undefined) {
    return
  }
  const urlAt = readme.slice(start, end).lastIndexOf(node.url)
  if (urlAt === -1) {
    return
  }
  insertAt.push(start + urlAt)
}

/**
 * Parse the html node's source slice with locations on and pin `src`/`srcset`
 * values that start with `assets/`, using parse5's attribute byte ranges.
 * @param {import('mdast').Html} node
 */
function collectHtmlAttrs(node) {
  const nodeStart = node.position?.start?.offset
  const nodeEnd = node.position?.end?.offset
  if (nodeStart === undefined || nodeEnd === undefined) {
    return
  }
  const html = readme.slice(nodeStart, nodeEnd)
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true })
  walkParse5(fragment, element => {
    const attrLocations = element.sourceCodeLocation?.attrs
    if (!attrLocations) {
      return
    }
    for (const attr of element.attrs) {
      if (
        !PINNED_ATTRS.has(attr.name) ||
        !attr.value.startsWith(RELATIVE_PREFIX)
      ) {
        continue
      }
      const location = attrLocations[attr.name]
      if (!location) {
        continue
      }
      const attrText = html.slice(location.startOffset, location.endOffset)
      const valueAt = attrText.indexOf(attr.value, attr.name.length)
      if (valueAt === -1) {
        continue
      }
      insertAt.push(nodeStart + location.startOffset + valueAt)
    }
  })
}

/**
 * Visit every element in a parse5 tree, including template contents.
 * @param {object} node
 * @param {(element: { attrs: Array<{ name: string, value: string }>, sourceCodeLocation?: { attrs?: Record<string, { startOffset: number, endOffset: number }> } }) => void} visit
 */
function walkParse5(node, visit) {
  if (Array.isArray(node.attrs)) {
    visit(node)
  }
  if (node.content) {
    walkParse5(node.content, visit)
  }
  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) {
      walkParse5(child, visit)
    }
  }
}

walkMdast(fromMarkdown(readme))

let pinned = readme
for (const offset of [...new Set(insertAt)].sort((a, b) => b - a)) {
  pinned = pinned.slice(0, offset) + base + pinned.slice(offset)
}

if (pinned === readme) {
  console.log('pin-readme-assets: no relative assets/ refs to pin')
} else {
  writeFileSync('README.md', pinned)
  console.log(`pin-readme-assets: pinned relative assets/ refs to ${base}`)
}
