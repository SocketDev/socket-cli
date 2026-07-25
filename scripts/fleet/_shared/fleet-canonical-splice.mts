/**
 * @file Sentinel-scoped splice for fleet-mirror files that carry the
 *   `#fleet-canonical-end` sentinel — today only `.config/fleet/oxlintrc.json`.
 *   Everything from the start of the file THROUGH the end sentinel is
 *   fleet-owned and is replaced from the canonical source on placement; member
 *   content after the end sentinel — the repo-local `ignorePatterns` tail — is
 *   preserved byte-for-byte. The `#fleet-canonical-begin` marker is NOT a
 *   placement boundary: the head above it — rules, overrides, plugins, the
 *   default ignore prefix — is also canonical and must keep cascading, so the
 *   repo-owned surface is strictly the tail. Every placement path shares this
 *   one primitive — the sync-scaffolding check + copy fixer and the member-side
 *   release-bundle placement — so check and fix can never disagree on the
 *   boundary. Recurring incident this closes: the byte-identical mirror copy
 *   wiped socket-registry's repo-local tail three times, unmasking ~298 lint
 *   findings each time, because the lint runner re-emits the JSON tail as CLI
 *   ignore args.
 */

export const FLEET_CANONICAL_END_SENTINEL = '#fleet-canonical-end'

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
 * sentinel-scoped rather than a whole-file copy.
 */
export function hasFleetCanonicalEndSentinel(content: string): boolean {
  return content.includes(FLEET_CANONICAL_END_SENTINEL)
}

/**
 * Compute the placement result for a sentinel-bearing file: the canonical
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
