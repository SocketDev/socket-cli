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
 *   bullet), reported, every drop is returned, and git-reversible. Pairs with
 *   the `claude-md-section-size-guard`, the cap gate, and runs in `pnpm run
 *   fix`. Mirrors the guard's measurement exactly: the block is the lines from
 *   the `<fleet>` BEGIN marker (inclusive) up to the `<fleet>` END marker
 *   (exclusive) — via the shared
 *   `isFleetMarkerBeginLine`/`isFleetMarkerEndLine` predicates, so this trimmer
 *   and the splicer (checks/claude-md-fleet- block.mts) can never disagree on
 *   the boundary, short tag or the transitional long-form alias alike — and its
 *   size is that substring's UTF-8 byte length. Pure transforms, plus one thin
 *   fs applier (`applyClaudeMdTrim`) shared by the `trim-claude-md` CLI and the
 *   fix path.
 */

import { existsSync, readFileSync } from 'node:fs'

import {
  isFleetMarkerBeginLine,
  isFleetMarkerEndLine,
} from '../../../.claude/hooks/fleet/_shared/fleet-markers.mts'
import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'

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
 * Locate the fleet block by its markers (short tag or transitional long-form
 * alias, see fleet-markers.mts). Returns the BEGIN line index (inclusive) and
 * END line index (exclusive), matching `extractFleetBlock`. Undefined when
 * the block is absent.
 */
export function fleetBlockBounds(
  lines: readonly string[],
): BlockBounds | undefined {
  let beginIdx = -1
  let endIdx = -1
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (beginIdx === -1 && isFleetMarkerBeginLine(line)) {
      beginIdx = i
    } else if (beginIdx !== -1 && isFleetMarkerEndLine(line)) {
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
 * The fleet block's UTF-8 byte size, the guard's metric, or undefined when
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
// The comment arm spells out "any char that is not a dash, or a dash that does
// not open the terminator" rather than a lazy `[^]*?`. The lazy form sits inside
// a `+` group, so an unterminated `<!--` made the engine retry every split of
// the rest of the line — exponential backtracking on a line the trimmer reads
// from a file. This form has one way to match each character, so it is linear.
const TAIL_RE =
  /(?:\s*(?:\([^()]*\)|\[[^\]]*\]\([^)]*\)|<!--(?:[^-]|-(?!->))*-->))+\s*$/

/**
 * Whether a line is a top-level fleet bullet carrying a doc link (its detail
 * has a home, so trimming its description is safe).
 */
function isTrimmableBulletLine(line: string): boolean {
  return line.startsWith('- ') && /\]\(docs\/agents\.md\//.test(line)
}

/**
 * Index of the last `; ` clause boundary that sits at the description's TOP
 * level — outside every `()` / `[]` / `{}` group and outside every backtick
 * code span. `-1` when there is none.
 *
 * A `; ` nested inside a parenthetical is an aside's internal punctuation, not
 * a clause boundary: cutting there strips the closing `)` and emits markdown
 * with an unbalanced delimiter. An unterminated code span leaves `inCode` set,
 * which suppresses every later boundary — the conservative direction, since a
 * skipped bullet only means the trimmer moves on to the next-fattest one.
 */
function lastTopLevelClauseIndex(desc: string): number {
  let depth = 0
  let inCode = false
  let last = -1
  for (let i = 0, { length } = desc; i < length; i += 1) {
    const ch = desc[i]!
    if (ch === '`') {
      inCode = !inCode
      continue
    }
    if (inCode) {
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth > 0) {
        depth -= 1
      }
    } else if (depth === 0 && ch === ';' && desc[i + 1] === ' ') {
      last = i
    }
  }
  return last
}

/**
 * Drop the last top-level `; `-separated clause from a bullet's description,
 * preserving the leading marker, the first clause(s), and the citation/doc-link
 * tail. Returns undefined when the description has no top-level `; ` clause
 * boundary to drop: it carries a single clause, so trimming would gut the rule,
 * or every boundary is nested inside an aside, where cutting would unbalance
 * the delimiters.
 */
export function dropLastClause(line: string): string | undefined {
  const tailMatch = TAIL_RE.exec(line)
  const tail = tailMatch ? tailMatch[0] : ''
  const desc = tail ? line.slice(0, line.length - tail.length) : line
  const lastSemi = lastTopLevelClauseIndex(desc)
  if (lastSemi <= 0) {
    return undefined
  }
  // Keep up to the clause before the last `; `; strip any dangling terminal
  // punctuation, then re-terminate with a single period before the tail.
  const kept = desc.slice(0, lastSemi).replace(/[.;,\s]+$/u, '')
  return `${kept}.${tail}`
}

/**
 * Non-lossy normalization of the fleet block, applied ALWAYS (under or over
 * cap): strip trailing whitespace from every block line and collapse runs of
 * blank lines to one. No prose is lost — only bytes that render identically.
 * Mutates `lines` in place; returns whether anything changed. Blank-line
 * removal shifts the END marker, so the caller re-derives the bounds.
 */
export function normalizeFleetBlock(lines: string[]): boolean {
  const bounds = fleetBlockBounds(lines)
  if (bounds === undefined) {
    return false
  }
  let changed = false
  for (let i = bounds.beginIdx; i < bounds.endIdx; i += 1) {
    const stripped = lines[i]!.replace(/[ \t]+$/u, '')
    if (stripped !== lines[i]) {
      lines[i] = stripped
      changed = true
    }
  }
  for (let i = bounds.endIdx - 1; i > bounds.beginIdx; i -= 1) {
    if (lines[i] === '' && lines[i - 1] === '') {
      lines.splice(i, 1)
      changed = true
    }
  }
  return changed
}

/**
 * Trim the fleet block: the non-lossy normalization runs ALWAYS; the lossy
 * clause-dropping, last clause of the fattest trimmable bullet, engages only
 * while the block is still over `capBytes` after normalization. Pure —
 * returns the new content, the lossy trims applied, and whether the
 * non-lossy pass changed anything.
 */
export function trimFleetBlockToFit(
  content: string,
  capBytes: number = FLEET_BLOCK_MAX_BYTES,
): { content: string; normalized: boolean; trims: BulletTrim[] } {
  const lines = content.split('\n')
  let bounds = fleetBlockBounds(lines)
  if (bounds === undefined) {
    return { content, normalized: false, trims: [] }
  }
  const normalized = normalizeFleetBlock(lines)
  bounds = fleetBlockBounds(lines)
  if (bounds === undefined) {
    return { content: lines.join('\n'), normalized, trims: [] }
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
  return { content: lines.join('\n'), normalized, trims }
}

/**
 * A CLAUDE.md file changed on disk: its path, the lossy trims applied, and
 * whether the always-on non-lossy normalization changed anything.
 */
export interface ClaudeMdTrimResult {
  readonly file: string
  readonly normalized: boolean
  readonly trims: BulletTrim[]
}

/**
 * Trim the fleet block of each given CLAUDE.md IN PLACE: the non-lossy
 * normalization applies always; the lossy clause-dropping only while over
 * the cap. Reads each existing file, applies `trimFleetBlockToFit`, and
 * writes only when something changed, no spurious mtime churn. Missing
 * files / files with no fleet block are skipped. Returns one result per file
 * that changed. Shared by the CLI and the fix path.
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
    const { content, normalized, trims } = trimFleetBlockToFit(
      original,
      capBytes,
    )
    if (content !== original) {
      writeThroughMirrorLock(file, content)
      results.push({ file, normalized, trims })
    }
  }
  return results
}
