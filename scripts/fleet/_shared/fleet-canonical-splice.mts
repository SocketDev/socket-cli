/*
 * @file Sentinel-scoped splice for the DESIGNATED fleet-mirror segment files
 *   (`FLEET_CANONICAL_SPLICE_FILES` — `.config/fleet/oxlintrc.json` and
 *   `.config/fleet/.prettierignore`). Everything from the start of the file
 *   THROUGH the end sentinel is fleet-owned and is replaced from the canonical
 *   source on placement; member content after the end sentinel — the repo-local
 *   `ignorePatterns` tail, the derived lockstep-mirrors block — is preserved
 *   byte-for-byte. Any begin marker is NOT a placement boundary: the head above
 *   it — rules, overrides, plugins, the default ignore prefix — is also
 *   canonical and must keep cascading, so the repo-owned surface is strictly
 *   the tail. Every placement path shares this one primitive — the
 *   sync-scaffolding check + copy fixer, the member-side release-bundle
 *   placement, and the dep-0 bootstrap installer — so check and fix can never
 *   disagree on the boundary. Two incidents this module answers for:
 *
 *   - the byte-identical mirror copy wiped socket-registry's repo-local tail
 *     three times, unmasking ~298 lint findings each time, because the lint
 *     runner re-emits the JSON tail as CLI ignore args — hence the splice;
 *   - the v1.0.14 fanout stitched v1.0.13 tails onto the NEW fetcher in 17
 *     members because splicing was CONTENT-gated: any placed file merely
 *     mentioning the sentinel token, the fetcher carried it in a doc comment
 *     was spliced — hence the PATH gate: only the designated segment files
 *     listed here may be sentinel-spliced, and no other bundle-shipped file may
 *     contain the raw token, the producer's stray-carrier class check.
 */

// Assembled from parts so this module never contains the raw sentinel byte
// sequence itself: member-side placement machinery that predates the path
// gate splices ANY placed file carrying the token, and the producer's class
// check forbids it in every non-designated bundle file — including this one.
export const FLEET_CANONICAL_END_SENTINEL = ['#fleet', 'canonical', 'end'].join(
  '-',
)

// The DESIGNATED segment files — the ONLY paths placement may sentinel-splice,
// keyed by repo-relative path. Owned here so every placement surface (the
// member-side fetcher, the cascade check + copy fixer, the producer's class
// check) shares one declaration and can never disagree. A new segment file
// must land in this list AND as a file-shaped mirror entry in bundle.json
// the fleet-canonical-splice unit sweep enforces both directions.
export const FLEET_CANONICAL_SPLICE_FILES: readonly string[] = [
  // Member tail: the repo-local `ignorePatterns` entries the lint runner
  // re-emits as CLI ignore args.
  '.config/fleet/oxlintrc.json',
  // Member tail: the derived lockstep-mirrors block emit-mirror-globs.mts
  // appends below the end sentinel — a whole-file copy wiped it at stuie on
  // every refresh, unmasking the verbatim upstream mirrors to oxfmt.
  '.config/fleet/.prettierignore',
]

/**
 * True when `relPath`, repo-relative, either separator, is a designated
 * segment file — the path gate every splice call site checks first.
 */
export function isFleetCanonicalSpliceFile(relPath: string): boolean {
  return FLEET_CANONICAL_SPLICE_FILES.includes(relPath.replaceAll('\\', '/'))
}

/**
 * Index just past the first end-sentinel token, including the closing quote
 * when the sentinel is a JSON string element. Returns -1 when the sentinel is
 * absent. The FIRST occurrence is the boundary — a tail that mentions the
 * sentinel text again never moves it.
 */
function fleetCanonicalEndBoundary(content: string): number {
  const idx = content.indexOf(FLEET_CANONICAL_END_SENTINEL)
  if (idx === -1) {
    return -1
  }
  let boundary = idx + FLEET_CANONICAL_END_SENTINEL.length
  if (content.charAt(boundary) === '"') {
    boundary += 1
  }
  return boundary
}

/**
 * True when `content` carries the end sentinel, i.e. placement must be
 * sentinel-scoped rather than a whole-file copy. Content is the SECOND gate:
 * call sites gate on `isFleetCanonicalSpliceFile` first — a non-designated
 * file is always a plain byte copy no matter what its content mentions.
 */
export function hasFleetCanonicalEndSentinel(content: string): boolean {
  return content.includes(FLEET_CANONICAL_END_SENTINEL)
}

// The repo-canonical wrapper's close tag, bare — matches every comment style
// the vocabulary defines (`<repo>`, `# <repo>`, `<!-- <repo> -->`) because all
// of them contain this literal substring. Deliberately NOT imported from
// fleet-markers.mts: this module stays a content-agnostic sentinel splicer, and
// a substring check is all a seed decision needs — no region parsing.
const REPO_REGION_BEGIN_TOKEN = '<repo>'
const REPO_REGION_END_TOKEN = '</repo>'

/**
 * True when `tail` (the bytes after a file's end-sentinel boundary) already
 * carries a `<repo>` wrapper — the seeded, host-owned carve-out
 * `.claude/hooks/fleet/_shared/fleet-markers.mts` defines. A tail with no
 * wrapper at all is either a not-yet-seeded target or a segment file that
 * never uses the wrapper at all, e.g. `.prettierignore`, in which case there
 * is nothing to seed.
 */
function tailHasRepoRegion(tail: string): boolean {
  return tail.includes(REPO_REGION_BEGIN_TOKEN)
}

/**
 * The seed fragment a source tail carries for a not-yet-migrated target:
 * everything from the start of `sourceTail`, right after the sentinel,
 * through the end of its `</repo>` marker, closing quote included when
 * present. Returns `''` when `sourceTail` has no `</repo>` to anchor on —
 * defensive; callers only reach here after confirming `sourceTail` has a
 * `<repo>` begin marker.
 */
function repoSeedFragment(sourceTail: string): string {
  const idx = sourceTail.indexOf(REPO_REGION_END_TOKEN)
  if (idx === -1) {
    return ''
  }
  let end = idx + REPO_REGION_END_TOKEN.length
  if (sourceTail.charAt(end) === '"') {
    end += 1
  }
  return sourceTail.slice(0, end)
}

/**
 * Compute the placement result for a designated segment file: the canonical
 * source's bytes through its end sentinel, followed by the target's bytes
 * after its own end sentinel — the repo-local tail, preserved byte-for-byte.
 * A target with no tail round-trips to exactly the source bytes. When either
 * side lacks the end sentinel the source wins whole — the plain mirror-copy
 * behavior, which also seeds a first placement.
 *
 * When the source seeds a `<repo>` wrapper right after the sentinel but the
 * target's own tail has none at all, graft the source's seed onto the FRONT
 * of the target's tail — the empty, "written but not yet populated" carve-out
 * a target that predates the seed, or was cascaded before this seeding
 * existed, never got. A target whose tail already carries a `<repo>` marker
 * anywhere keeps that tail completely untouched, whatever else it holds.
 */
export function spliceFleetCanonicalContent(
  source: string,
  target: string,
): string {
  const sourceBoundary = fleetCanonicalEndBoundary(source)
  if (sourceBoundary === -1) {
    return source
  }
  const targetBoundary = fleetCanonicalEndBoundary(target)
  if (targetBoundary === -1) {
    return source
  }
  const sourceTail = source.slice(sourceBoundary)
  const targetTail = target.slice(targetBoundary)
  const seed =
    tailHasRepoRegion(sourceTail) && !tailHasRepoRegion(targetTail)
      ? repoSeedFragment(sourceTail)
      : ''
  return source.slice(0, sourceBoundary) + seed + targetTail
}
