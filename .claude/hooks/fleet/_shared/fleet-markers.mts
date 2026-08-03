/**
 * @file Single home for fleet + repo canonical region detection / extraction.
 *   The `<fleet>` tag markers (parsed by `named-blocks.mts`) delimit a
 *   cascade-owned region of a hybrid file (CLAUDE.md, .gitignore,
 *   .gitattributes, a JSON array, …); the symmetric `<repo>` tag marks a
 *   host-owned region so a reader can tell "repo content not written yet"
 *   from "file truncated." A file may carry MULTIPLE regions of either kind —
 *   a JSON config with several arrays (`ignorePatterns`, `plugins`, …) gives
 *   each array its own `<fleet>`/`<repo>` pair — so every accessor here is
 *   plural: `findFleetRegions` / `findRepoRegions` return every region found,
 *   in document order. `repoRegionBounds` stays as a singular convenience for
 *   the one caller (CLAUDE.md's repo-section auditor) that only ever expects
 *   one repo region in a file.
 *   Per-syntax delimiter, one tag vocabulary:
 *   markdown / hash-comment   <!-- <fleet> -->   # <fleet>
 *   JSON array element        <fleet>            (bare string, no comment
 *   wrapper — JSON has none)
 *   Emitters produce the short bare-tag form (`<fleet>` / `<repo>`); the
 *   parser ALSO recognizes the long-form tag names (`fleet-canonical` /
 *   `repo-canonical`) every existing fleet member still carries, plus the
 *   legacy `BEGIN`/`END` keyword form, so members migrate incrementally as
 *   their own cascade re-splices the region. Drop the long-form recognition
 *   (LEGACY_FLEET_CANONICAL_TAG / LEGACY_REPO_CANONICAL_TAG below) once every
 *   roster member's cascade has run at least once post-rename — audit with a
 *   fleet-wide grep for `<fleet-canonical>` / `<repo-canonical>`; zero hits
 *   clears it. Every fleet-region matcher / fixer reads its marker knowledge
 *   from here, so the grammar stays single-sourced.
 */

import { findBlocksByTag, scanMarkers } from './named-blocks.mts'

// The tag name the cascade manages. Short form — emitters write only this.
export const FLEET_CANONICAL_TAG = 'fleet'

// The long-form tag name every existing fleet member still carries pre-rename.
// Matchers accept it as an alias of FLEET_CANONICAL_TAG; emitters never write
// it. Transitional — see the file header for the removal condition.
const LEGACY_FLEET_CANONICAL_TAG = 'fleet-canonical'

// The tag name a seeded hybrid file wraps its host-owned region in. Short
// form — emitters write only this.
export const REPO_CANONICAL_TAG = 'repo'

// The long-form repo-region tag name. Same transitional-alias contract as
// LEGACY_FLEET_CANONICAL_TAG.
const LEGACY_REPO_CANONICAL_TAG = 'repo-canonical'

// Comment style of the host file, selecting which marker form generators
// emit. `json` is bare — a JSON array element IS the marker text; the
// surrounding quotes are JSON's own string syntax, not part of the grammar
// here.
export type FleetCommentStyle = 'hash' | 'html' | 'json' | 'slash'

// Well-formed fleet blocks (named-blocks returns none when the content is
// malformed — overlap / unclosed / orphan-end). Tries the short tag first —
// every emitted file — then falls back to the long-form legacy tag for a
// not-yet-recascaded member.
function tagBlocksForTag(
  content: string,
  tag: string,
  legacyTag: string,
): ReturnType<typeof findBlocksByTag> {
  const current = findBlocksByTag(content, tag)
  if (current.length > 0) {
    return current
  }
  return findBlocksByTag(content, legacyTag)
}

function tagBlocks(content: string): ReturnType<typeof findBlocksByTag> {
  return tagBlocksForTag(
    content,
    FLEET_CANONICAL_TAG,
    LEGACY_FLEET_CANONICAL_TAG,
  )
}

/**
 * The open marker for a tag + comment style — bare-tag form, e.g.
 * `<!-- <fleet> -->` / `# <fleet>` / `<fleet>` (json — a bare JSON array
 * element, no comment wrapper).
 */
function beginMarkerForTag(tag: string, style: FleetCommentStyle): string {
  if (style === 'html') {
    return `<!-- <${tag}> -->`
  }
  if (style === 'slash') {
    return `// <${tag}>`
  }
  if (style === 'json') {
    return `<${tag}>`
  }
  return `# <${tag}>`
}

/**
 * The close marker for a tag + comment style — bare close tag, e.g.
 * `<!-- </fleet> -->` / `# </fleet>` / `</fleet>` (json).
 */
function endMarkerForTag(tag: string, style: FleetCommentStyle): string {
  if (style === 'html') {
    return `<!-- </${tag}> -->`
  }
  if (style === 'slash') {
    return `// </${tag}>`
  }
  if (style === 'json') {
    return `</${tag}>`
  }
  return `# </${tag}>`
}

/**
 * True when `value` is EXACTLY a bare `<tag>` (or its legacy alias), no
 * comment wrapper — the JSON-array-element form, where the marker IS the
 * whole element and there is no comment syntax to strip. Whitespace-trimmed
 * so a pretty-printer's leading indent never defeats the match.
 */
function isBareBeginTag(
  value: string,
  tag: string,
  legacyTag: string,
): boolean {
  const trimmed = value.trim()
  return trimmed === `<${tag}>` || trimmed === `<${legacyTag}>`
}

/**
 * The bare `</tag>` (or legacy alias) twin of `isBareBeginTag`.
 */
function isBareEndTag(value: string, tag: string, legacyTag: string): boolean {
  const trimmed = value.trim()
  return trimmed === `</${tag}>` || trimmed === `</${legacyTag}>`
}

/**
 * True when a single line (or JSON array element) is a BEGIN marker for `tag`
 * OR its transitional `legacyTag` alias — either the comment-wrapped form
 * (`scanMarkers` anchors the match to the whole line, so a prose mention of
 * the marker name elsewhere on a line is never mistaken for a marker) or the
 * bare JSON-element form.
 */
function isMarkerBeginLineForTag(
  tag: string,
  legacyTag: string,
  line: string,
): boolean {
  return (
    isBareBeginTag(line, tag, legacyTag) ||
    scanMarkers(line).some(
      m => m.kind === 'begin' && (m.tag === tag || m.tag === legacyTag),
    )
  )
}

/**
 * True when a single line (or JSON array element) is an END marker for `tag`
 * OR its transitional `legacyTag` alias — comment-wrapped or bare.
 */
function isMarkerEndLineForTag(
  tag: string,
  legacyTag: string,
  line: string,
): boolean {
  return (
    isBareEndTag(line, tag, legacyTag) ||
    scanMarkers(line).some(
      m => m.kind === 'end' && (m.tag === tag || m.tag === legacyTag),
    )
  )
}

/**
 * The open marker for a comment style — bare-tag form, e.g.
 * `<!-- <fleet> -->` / `# <fleet>`.
 */
export function fleetBeginMarker(style: FleetCommentStyle): string {
  return beginMarkerForTag(FLEET_CANONICAL_TAG, style)
}

/**
 * The close marker for a comment style — bare close tag, e.g.
 * `<!-- </fleet> -->` / `# </fleet>`.
 */
export function fleetEndMarker(style: FleetCommentStyle): string {
  return endMarkerForTag(FLEET_CANONICAL_TAG, style)
}

/**
 * True when a single line is a fleet-BEGIN marker (short form, or the
 * transitional long-form alias).
 */
export function isFleetMarkerBeginLine(line: string): boolean {
  return isMarkerBeginLineForTag(
    FLEET_CANONICAL_TAG,
    LEGACY_FLEET_CANONICAL_TAG,
    line,
  )
}

/**
 * True when a single line is a fleet-END marker (short form, or the
 * transitional long-form alias).
 */
export function isFleetMarkerEndLine(line: string): boolean {
  return isMarkerEndLineForTag(
    FLEET_CANONICAL_TAG,
    LEGACY_FLEET_CANONICAL_TAG,
    line,
  )
}

/**
 * The open marker for the repo-canonical wrapper, e.g.
 * `<!-- <repo> -->` / `# <repo>`.
 */
export function repoBeginMarker(style: FleetCommentStyle): string {
  return beginMarkerForTag(REPO_CANONICAL_TAG, style)
}

/**
 * The close marker for the repo-canonical wrapper, e.g.
 * `<!-- </repo> -->` / `# </repo>`.
 */
export function repoEndMarker(style: FleetCommentStyle): string {
  return endMarkerForTag(REPO_CANONICAL_TAG, style)
}

/**
 * True when a single line is a repo-canonical BEGIN marker (short form, or
 * the transitional long-form alias).
 */
export function isRepoMarkerBeginLine(line: string): boolean {
  return isMarkerBeginLineForTag(
    REPO_CANONICAL_TAG,
    LEGACY_REPO_CANONICAL_TAG,
    line,
  )
}

/**
 * True when a single line is a repo-canonical END marker (short form, or the
 * transitional long-form alias).
 */
export function isRepoMarkerEndLine(line: string): boolean {
  return isMarkerEndLineForTag(
    REPO_CANONICAL_TAG,
    LEGACY_REPO_CANONICAL_TAG,
    line,
  )
}

/**
 * True when `text` contains a fleet-BEGIN marker — i.e. the file is (or claims
 * to be) fleet-managed. Recognizes the short tag and the transitional
 * long-form alias.
 */
export function containsFleetBeginMarker(text: string): boolean {
  return scanMarkers(text).some(
    m =>
      m.kind === 'begin' &&
      (m.tag === FLEET_CANONICAL_TAG || m.tag === LEGACY_FLEET_CANONICAL_TAG),
  )
}

/**
 * True when `text` carries a complete, balanced fleet block — a hybrid file
 * whose content outside the markers is repo-owned.
 */
export function textHasFleetBlockMarkers(text: string | undefined): boolean {
  if (text === undefined) {
    return false
  }
  return tagBlocks(text).length > 0
}

/**
 * The fleet block of a CLAUDE.md: the lines from the BEGIN marker up to (not
 * including) the END marker. Returns undefined when the block is absent or
 * malformed.
 */
export function extractFleetBlock(content: string): string | undefined {
  const blocks = tagBlocks(content)
  if (blocks.length === 0) {
    return undefined
  }
  const block = blocks[0]!
  return content.split('\n').slice(block.beginLine, block.endLine).join('\n')
}

/**
 * The per-repo region of a CLAUDE.md: everything after the END marker line (the
 * `🏗️ …-Specific` postamble). A file with no markers at all counts as
 * all-per-repo, the whole file. Returns undefined for a malformed block (a
 * BEGIN with no balanced END) so callers don't double-count the fleet content.
 */
export function extractPerRepo(content: string): string | undefined {
  const blocks = tagBlocks(content)
  if (blocks.length > 0) {
    return content
      .split('\n')
      .slice(blocks[0]!.endLine + 1)
      .join('\n')
  }
  return containsFleetBeginMarker(content) ? undefined : content
}

// A region's kind — which tag it was found under.
export type MarkerKind = 'fleet' | 'repo'

export interface MarkerRegion {
  readonly kind: MarkerKind
  // 0-based index (into the scanned `items`) of the BEGIN marker.
  readonly start: number
  // 0-based index of the END marker, or `items.length` (i.e. end of the
  // scanned sequence) when the region has no close marker.
  readonly end: number
}

// Kept for the shape existing callers destructure — `{ start, end }`, no
// `kind` — so a caller that only ever wants "the one repo region" (CLAUDE.md's
// bullet-index auditor) doesn't have to know about MarkerRegion's extra field.
export type RepoRegionBounds = Pick<MarkerRegion, 'end' | 'start'>

/**
 * Find every region for `tag` (or its legacy alias) in `items` — a file's
 * lines, or a JSON array's elements; both are just a sequence of strings to
 * scan. Regions pair sequentially: each BEGIN is matched with the next END
 * found after it, tolerating an unclosed final BEGIN (its region runs to the
 * end of `items`, rather than being reported as an error — a fresh, empty,
 * or mid-edit region is a normal state, not a malformed one). A BEGIN nested
 * inside an already-open region of the SAME tag before its END is swallowed
 * into the outer region's span rather than starting a second one — a
 * deliberately tolerant, non-crashing default for a hand-edited file.
 */
function findRegionsForTag(
  items: readonly string[],
  kind: MarkerKind,
  tag: string,
  legacyTag: string,
): MarkerRegion[] {
  const regions: MarkerRegion[] = []
  const { length } = items
  let i = 0
  while (i < length) {
    if (!isMarkerBeginLineForTag(tag, legacyTag, items[i]!)) {
      i += 1
      continue
    }
    const start = i
    let end = length
    for (let j = i + 1; j < length; j += 1) {
      if (isMarkerEndLineForTag(tag, legacyTag, items[j]!)) {
        end = j
        break
      }
    }
    regions.push({ end, kind, start })
    i = end + 1
  }
  return regions
}

/**
 * Every `<fleet>` region in `items`, in document order. A JSON config with
 * several arrays gives each its own region — a file with N canonical arrays
 * returns N regions here, not one.
 */
export function findFleetRegions(items: readonly string[]): MarkerRegion[] {
  return findRegionsForTag(
    items,
    'fleet',
    FLEET_CANONICAL_TAG,
    LEGACY_FLEET_CANONICAL_TAG,
  )
}

/**
 * Every `<repo>` region in `items`, in document order. See `findFleetRegions`
 * for the pairing/tolerance rules — identical, just the repo tag.
 */
export function findRepoRegions(items: readonly string[]): MarkerRegion[] {
  return findRegionsForTag(
    items,
    'repo',
    REPO_CANONICAL_TAG,
    LEGACY_REPO_CANONICAL_TAG,
  )
}

/**
 * Locate the FIRST explicit `<repo>` marker region in `lines` (any hybrid
 * file: CLAUDE.md, .gitignore, .gitattributes — a repo-owned region wrapped
 * so a splice can target it without inferring its bounds from what the fleet
 * region leaves over, and so a fresh EMPTY region reads as "written, empty"
 * rather than "missing"). Returns undefined when no `<repo>` BEGIN marker is
 * present — the caller's positional fallback applies (e.g. CLAUDE.md's
 * `## 🏗️` heading, or "everything outside the fleet region" for .gitignore /
 * .gitattributes). A singular convenience over `findRepoRegions` for the one
 * caller (claude-md-repo-section-is-a-bullet-index.mts) that only ever
 * expects ONE repo region in a file — a file with more than one (the JSON
 * multi-array case) should call `findRepoRegions` directly.
 */
export function repoRegionBounds(
  lines: readonly string[],
): RepoRegionBounds | undefined {
  const region = findRepoRegions(lines)[0]
  if (region === undefined) {
    return undefined
  }
  return { end: region.end, start: region.start }
}
