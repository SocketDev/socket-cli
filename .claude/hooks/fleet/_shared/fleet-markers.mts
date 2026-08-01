/**
 * @file Single home for fleet + repo canonical block detection / extraction.
 *   The `<fleet>` tag markers (parsed by `named-blocks.mts`) delimit the
 *   cascade-owned region of a hybrid file (CLAUDE.md, .gitignore,
 *   .gitattributes, workflows, …); the symmetric `<repo>` tag marks the
 *   host-owned region of a freshly SEEDED hybrid file (currently just
 *   CLAUDE.md, via `template/presets/CLAUDE.md`) so a reader can tell "repo
 *   section not written yet" from "file truncated." Emitters produce the
 *   short bare-tag form (`<fleet>` / `<repo>`); the parser ALSO recognizes the
 *   long-form tag names (`fleet-canonical` / `repo-canonical`) every existing
 *   fleet member still carries, plus the legacy `BEGIN`/`END` keyword form, so
 *   members migrate incrementally as their own cascade re-splices the block.
 *   Drop the long-form recognition (LEGACY_FLEET_TAG / LEGACY_REPO_TAG below)
 *   once every roster member's cascade has run at least once post-rename —
 *   audit with a fleet-wide grep for `<fleet-canonical>` / `<repo-canonical>`;
 *   zero hits clears it. Every fleet-block matcher / fixer reads its marker
 *   knowledge from here, so the grammar stays single-sourced.
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

// Comment style of the host file, selecting which marker form generators emit.
export type FleetCommentStyle = 'hash' | 'html' | 'slash'

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
 * `<!-- <fleet> -->` / `# <fleet>`.
 */
function beginMarkerForTag(tag: string, style: FleetCommentStyle): string {
  if (style === 'html') {
    return `<!-- <${tag}> -->`
  }
  if (style === 'slash') {
    return `// <${tag}>`
  }
  return `# <${tag}>`
}

/**
 * The close marker for a tag + comment style — bare close tag, e.g.
 * `<!-- </fleet> -->` / `# </fleet>`.
 */
function endMarkerForTag(tag: string, style: FleetCommentStyle): string {
  if (style === 'html') {
    return `<!-- </${tag}> -->`
  }
  if (style === 'slash') {
    return `// </${tag}>`
  }
  return `# </${tag}>`
}

/**
 * True when a single line is a BEGIN marker for `tag` OR its transitional
 * `legacyTag` alias. `scanMarkers` anchors the match to the whole line, so a
 * prose mention of the marker name elsewhere on a line is never mistaken for
 * a marker.
 */
function isMarkerBeginLineForTag(
  tag: string,
  legacyTag: string,
  line: string,
): boolean {
  return scanMarkers(line).some(
    m => m.kind === 'begin' && (m.tag === tag || m.tag === legacyTag),
  )
}

/**
 * True when a single line is an END marker for `tag` OR its transitional
 * `legacyTag` alias.
 */
function isMarkerEndLineForTag(
  tag: string,
  legacyTag: string,
  line: string,
): boolean {
  return scanMarkers(line).some(
    m => m.kind === 'end' && (m.tag === tag || m.tag === legacyTag),
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

export interface RepoRegionBounds {
  // 0-based line index of the `<repo>` BEGIN marker.
  readonly start: number
  // 0-based line index of the `</repo>` END marker, or the last line index +
  // 1 (i.e. end of file) when the file has no close marker.
  readonly end: number
}

/**
 * Locate an explicit `<repo>` marker region in `lines` (any hybrid file:
 * CLAUDE.md, .gitignore, .gitattributes — a repo-owned region wrapped so a
 * splice can target it without inferring its bounds from what the fleet block
 * leaves over, and so a fresh EMPTY region reads as "written, empty" rather
 * than "missing"). Returns undefined when no `<repo>` BEGIN marker is present
 * — the caller's positional fallback applies (e.g. CLAUDE.md's `## 🏗️`
 * heading, or "everything outside the fleet block" for .gitignore /
 * .gitattributes).
 */
export function repoRegionBounds(
  lines: readonly string[],
): RepoRegionBounds | undefined {
  const start = lines.findIndex(l => isRepoMarkerBeginLine(l))
  if (start === -1) {
    return undefined
  }
  const end = lines.findIndex((l, i) => i > start && isRepoMarkerEndLine(l))
  return { end: end === -1 ? lines.length : end, start }
}
