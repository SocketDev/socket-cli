/*
 * @file Sentinel-scoped splice for the DESIGNATED fleet-mirror segment files
 *   (`FLEET_CANONICAL_SPLICE_FILES` — today only
 *   `.config/fleet/oxlintrc.json`). Everything from the start of the file
 *   THROUGH the end sentinel is fleet-owned and is replaced from the canonical
 *   source on placement; member content after the end sentinel — the repo-local
 *   `ignorePatterns` tail — is preserved byte-for-byte. The begin marker is NOT
 *   a placement boundary: the head above it — rules, overrides, plugins, the
 *   default ignore prefix — is also canonical and must keep cascading, so the
 *   repo-owned surface is strictly the tail. Every placement path shares this
 *   one primitive — the sync-scaffolding check + copy fixer and the member-side
 *   release-bundle placement — so check and fix can never disagree on the
 *   boundary. Two incidents this module answers for:
 *
 *   - the byte-identical mirror copy wiped socket-registry's repo-local tail
 *     three times, unmasking ~298 lint findings each time, because the lint
 *     runner re-emits the JSON tail as CLI ignore args — hence the splice;
 *   - the v1.0.14 fanout stitched v1.0.13 tails onto the NEW fetcher in 17
 *     members because splicing was CONTENT-gated: any placed file merely
 *     mentioning the sentinel token (the fetcher carried it in a doc comment)
 *     was spliced — hence the PATH gate: only the designated segment files
 *     listed here may be sentinel-spliced, and no other bundle-shipped file may
 *     contain the raw token (the producer's stray-carrier class check).
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
// (the fleet-canonical-splice unit sweep enforces both directions).
export const FLEET_CANONICAL_SPLICE_FILES: readonly string[] = [
  '.config/fleet/oxlintrc.json',
]

/**
 * True when `relPath` (repo-relative, either separator) is a designated
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

/**
 * Compute the placement result for a designated segment file: the canonical
 * source's bytes through its end sentinel, followed by the target's bytes
 * after its own end sentinel — the repo-local tail, preserved byte-for-byte.
 * A target with no tail round-trips to exactly the source bytes. When either
 * side lacks the end sentinel the source wins whole — the plain mirror-copy
 * behavior, which also seeds a first placement.
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
  return source.slice(0, sourceBoundary) + target.slice(targetBoundary)
}
