/**
 * @file Deterministic CLAUDE.md fleet-block trimmer. The fleet-canonical block
 *   ships byte-identical to every socket-* repo, so it is byte-capped (75% of
 *   the 40 KB whole-file limit). The mandate: bullets are a terse INDEX — the
 *   one-line invariant + citations + a `docs/agents.md/{fleet,repo}/<topic>.md`
 *   link — and the DETAIL lives in that linked doc. So when the block is over
 *   cap, the fix is to trim a bullet's DESCRIPTION (the detail is already in
 *   the doc), never to defer the new rule. This trimmer does exactly that,
 *   deterministically: while the block is over cap, it drops the LAST `;
 *   `-separated clause from the fattest bullet that (a) carries a doc link (so
 *   its detail has a home) and (b) has more than one clause (so it never
 *   empties a bullet). Bounded (only fires over cap, only the fattest trimmable
 *   bullet), reported (every drop is returned), and git-reversible. Pairs with
 *   the `claude-md-section-size-guard` (the cap gate) and runs in `pnpm run
 *   fix`. Mirrors the guard's measurement exactly: the block is the lines from
 *   the `<!-- <fleet-canonical> -->` BEGIN marker (inclusive) up to the `<!--
 *   </fleet-canonical> -->` END marker (exclusive), and its size is that
 *   substring's UTF-8 byte length. Pure transforms, plus one thin fs applier
 *   (`applyClaudeMdTrim`) shared by the `trim-claude-md` CLI and the fix path.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const BEGIN_MARKER = '<!-- <fleet-canonical> -->'
const END_MARKER = '<!-- </fleet-canonical> -->'

// The default fleet-block byte cap — 75% of the 40 KB whole-file budget, the
// same value claude-md-section-size-guard enforces.
export const FLEET_BLOCK_MAX_BYTES = 30_720

/**
 * A single trim: the bullet line's before/after text and its 0-based line index
 * in the file.
 */
export interface BulletTrim {
  readonly after: string
  readonly before: string
  readonly line: number
}

interface BlockBounds {
  readonly beginIdx: number
  readonly endIdx: number
}

/**
 * Locate the fleet block by its HTML markers. Returns the BEGIN line index
 * (inclusive) and END line index (exclusive), matching `extractFleetBlock`.
 * Undefined when the block is absent.
 */
export function fleetBlockBounds(
  lines: readonly string[],
): BlockBounds | undefined {
  let beginIdx = -1
  let endIdx = -1
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const trimmed = lines[i]!.trim()
    if (beginIdx === -1 && trimmed === BEGIN_MARKER) {
      beginIdx = i
    } else if (beginIdx !== -1 && trimmed === END_MARKER) {
      endIdx = i
      break
    }
  }
  if (beginIdx === -1 || endIdx === -1) {
    return undefined
  }
  return { beginIdx, endIdx }
}

/**
 * The fleet block's UTF-8 byte size (the guard's metric), or undefined when
 * there is no well-formed block.
 */
export function fleetBlockBytes(content: string): number | undefined {
  const lines = content.split('\n')
  const bounds = fleetBlockBounds(lines)
  if (bounds === undefined) {
    return undefined
  }
  const block = lines.slice(bounds.beginIdx, bounds.endIdx).join('\n')
  return Buffer.byteLength(block, 'utf8')
}

// Trailing run of citation groups + doc links (+ HTML comments), e.g.
// ` (`hook/path`) [`topic`](docs/agents.md/fleet/x.md) <!--advisory-->`. This
// is the bullet's INDEX tail — never trimmed; only the description before it is.
const TAIL_RE = /(?:\s*(?:\([^()]*\)|\[[^\]]*\]\([^)]*\)|<!--[^]*?-->))+\s*$/

/**
 * Whether a line is a top-level fleet bullet carrying a doc link (its detail
 * has a home, so trimming its description is safe).
 */
function isTrimmableBulletLine(line: string): boolean {
  return /^- /.test(line) && /\]\(docs\/agents\.md\//.test(line)
}

/**
 * Drop the last `; `-separated clause from a bullet's description, preserving
 * the leading marker, the first clause(s), and the citation/doc-link tail.
 * Returns undefined when the description has no `; ` clause boundary to drop
 * (single-clause — trimming would gut the rule).
 */
export function dropLastClause(line: string): string | undefined {
  const tailMatch = TAIL_RE.exec(line)
  const tail = tailMatch ? tailMatch[0] : ''
  const desc = tail ? line.slice(0, line.length - tail.length) : line
  const lastSemi = desc.lastIndexOf('; ')
  if (lastSemi <= 0) {
    return undefined
  }
  // Keep up to the clause before the last `; `; strip any dangling terminal
  // punctuation, then re-terminate with a single period before the tail.
  const kept = desc.slice(0, lastSemi).replace(/[.;,\s]+$/u, '')
  return `${kept}.${tail}`
}

/**
 * Trim the fleet block to fit under `capBytes`. Repeatedly drops the last
 * clause of the fattest trimmable bullet until the block is under cap or no
 * bullet can be safely trimmed further. Pure — returns the new content and the
 * list of trims applied (empty when already under cap or nothing is trimmable).
 */
export function trimFleetBlockToFit(
  content: string,
  capBytes: number = FLEET_BLOCK_MAX_BYTES,
): { content: string; trims: BulletTrim[] } {
  const lines = content.split('\n')
  const bounds = fleetBlockBounds(lines)
  if (bounds === undefined) {
    return { content, trims: [] }
  }
  const trims: BulletTrim[] = []
  // Guard against a pathological loop: at most one trim per bullet-line per
  // pass, bounded by the number of block lines total.
  const maxIterations = bounds.endIdx - bounds.beginIdx
  for (let iter = 0; iter < maxIterations; iter += 1) {
    const block = lines.slice(bounds.beginIdx, bounds.endIdx).join('\n')
    if (Buffer.byteLength(block, 'utf8') <= capBytes) {
      break
    }
    // Find the fattest trimmable bullet in the block.
    let fattestIdx = -1
    let fattestBytes = -1
    for (let i = bounds.beginIdx; i < bounds.endIdx; i += 1) {
      const line = lines[i]!
      if (!isTrimmableBulletLine(line)) {
        continue
      }
      if (dropLastClause(line) === undefined) {
        continue
      }
      const bytes = Buffer.byteLength(line, 'utf8')
      if (bytes > fattestBytes) {
        fattestBytes = bytes
        fattestIdx = i
      }
    }
    if (fattestIdx === -1) {
      // Nothing left to trim safely.
      break
    }
    const before = lines[fattestIdx]!
    const after = dropLastClause(before)!
    lines[fattestIdx] = after
    trims.push({ after, before, line: fattestIdx })
  }
  return { content: lines.join('\n'), trims }
}

/**
 * A CLAUDE.md file trimmed on disk: its path plus the trims applied.
 */
export interface ClaudeMdTrimResult {
  readonly file: string
  readonly trims: BulletTrim[]
}

/**
 * Trim the fleet block of each given CLAUDE.md IN PLACE to fit under the cap.
 * Reads each existing file, applies `trimFleetBlockToFit`, and writes only when
 * something changed (no spurious mtime churn). Missing files / files with no
 * fleet block are skipped. Returns one result per file that changed. Shared by
 * the CLI and the fix path.
 */
export function applyClaudeMdTrim(
  files: readonly string[],
  capBytes: number = FLEET_BLOCK_MAX_BYTES,
): ClaudeMdTrimResult[] {
  const results: ClaudeMdTrimResult[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    if (!existsSync(file)) {
      continue
    }
    const original = readFileSync(file, 'utf8')
    const { content, trims } = trimFleetBlockToFit(original, capBytes)
    if (trims.length > 0 && content !== original) {
      writeFileSync(file, content)
      results.push({ file, trims })
    }
  }
  return results
}
