/**
 * @file Canonical fleet GitHub Actions allowlist + reference parsing. Single
 *   source of truth for which `uses: <owner>/<repo>@<sha>` lines are permitted
 *   in fleet workflows. Every entry here MUST be referenced by at least one
 *   shared workflow under `socket-registry/.github/workflows/` or by a fleet
 *   repo's own workflows — removing one breaks every consumer that pins through
 *   those shared workflows. Adding one is a fleet-level decision that should
 *   cascade to every org's per-repo Actions allowlist. Third-party patterns
 *   (dtolnay/, hendrikmuhs/, HaaLeo/, pnpm/action-setup, softprops/, Swatinem/)
 *   were removed in favor of hand-rolled composites under
 *   SocketDev/socket-registry/.github/actions/. New third-party actions should
 *   be inlined as shell or ported to a composite there rather than added to
 *   this list — the `workflow-third-party-action-guard` hook enforces that at
 *   edit time. Shared by:
 *
 *   - .claude/skills/fleet/auditing-gha-settings/run.mts (audits org-level
 *     Actions permissions against this baseline).
 *   - .claude/hooks/fleet/workflow-third-party-action-guard/ (blocks Edit/Write
 *     of a workflow that introduces a non-allowlisted `uses:` line).
 */

/**
 * Canonical fleet-allowed `uses:` patterns. Each entry is an
 * `<owner>/<repo>[/<sub>]@*` wildcard — the version pin floats, but the
 * owner/repo MUST be in this set. Sorted alphabetically.
 */
export const CANONICAL_PATTERNS: readonly string[] = [
  'actions/cache/restore@*',
  'actions/cache/save@*',
  'actions/cache@*',
  'actions/checkout@*',
  'actions/deploy-pages@*',
  'actions/download-artifact@*',
  'actions/github-script@*',
  'actions/setup-go@*',
  'actions/setup-node@*',
  'actions/setup-python@*',
  'actions/upload-artifact@*',
  'actions/upload-pages-artifact@*',
  'depot/build-push-action@*',
  'depot/setup-action@*',
  'github/codeql-action/upload-sarif@*',
]

/**
 * Owner prefixes that are always permitted — first-party SocketDev orgs and
 * their reusable workflows / composite actions. Anything matching `^<prefix>/`
 * skips the allowlist check entirely. Keeps the CANONICAL_PATTERNS list small +
 * focused on third-party deps.
 */
export const FIRST_PARTY_OWNER_PREFIXES: readonly string[] = [
  'SocketDev/',
  'socketdev/',
]

/**
 * Returns true when `ref` matches a canonical wildcard or a first-party owner
 * prefix. `ref` is the `<owner>/<repo>[/<sub>]@<version>` form as it appears in
 * the workflow file (no trailing comment, no leading whitespace). Local refs
 * (`./.github/...`) and Docker refs (`docker://...`) return true — they're not
 * subject to the third-party allowlist.
 */
export function isAllowedActionRef(ref: string): boolean {
  if (!ref) {
    return true
  }
  // Local composite action (relative path).
  if (ref.startsWith('./') || ref.startsWith('../')) {
    return true
  }
  // Docker image (uses: docker://...).
  if (ref.startsWith('docker://')) {
    return true
  }
  // First-party owner prefix.
  for (let i = 0, { length } = FIRST_PARTY_OWNER_PREFIXES; i < length; i += 1) {
    if (ref.startsWith(FIRST_PARTY_OWNER_PREFIXES[i]!)) {
      return true
    }
  }
  // Strip the @<version> portion; match the bare `<owner>/<repo>[/<sub>]`
  // segment against the canonical patterns (which use `@*` wildcards).
  const atIdx = ref.indexOf('@')
  const bare = atIdx >= 0 ? ref.slice(0, atIdx) : ref
  for (let i = 0, { length } = CANONICAL_PATTERNS; i < length; i += 1) {
    const pat = CANONICAL_PATTERNS[i]!
    const patBare = pat.endsWith('@*') ? pat.slice(0, -2) : pat
    if (bare === patBare) {
      return true
    }
  }
  return false
}

export interface UsesRefMatch {
  /**
   * 1-indexed line number in the source text.
   */
  readonly line: number
  /**
   * The full `uses: <ref>` line text (trimmed).
   */
  readonly text: string
  /**
   * `<owner>/<repo>[/<sub>]@<version>` substring (the value of `uses:`).
   */
  readonly ref: string
}

// Matches a YAML `uses:` line with any ref shape. Captures the ref
// segment (everything after `uses: ` and before whitespace or `#`).
// Permissive enough to catch tag pins (`@v6`), branch pins (`@main`),
// short SHAs, full SHAs, and local refs (`./...`).
const USES_RE = /^\s*-?\s*uses:\s+(\S+)/

/**
 * Find every `uses:` line in `text` (a workflow YAML body) and return one entry
 * per line. The order matches source order. Lines marked `# socket-hook: allow
 * third-party-action` are excluded — they're a one-off opt-out for cases where
 * inlining isn't practical (e.g. a vendor-mandated action with a fleet
 * exception on file).
 */
export function extractActionRefs(text: string): UsesRefMatch[] {
  const out: UsesRefMatch[] = []
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.includes('# socket-hook: allow third-party-action')) {
      continue
    }
    const m = USES_RE.exec(line)
    if (!m) {
      continue
    }
    out.push({ line: i + 1, text: line.trim(), ref: m[1]! })
  }
  return out
}

/**
 * Diff two workflow texts and return every `uses:` ref that appears in
 * `newText` but not in `oldText`. Use this to gate Edit ops — a hook can read
 * `tool_input.old_string` + `tool_input.new_string` and only block on NEWLY
 * introduced third-party refs, leaving pre-existing non-allowlisted refs alone
 * (those are a separate cleanup pass).
 *
 * For Write ops where `oldText` is the empty string (new file) or undefined (no
 * prior content tracked), every ref in `newText` is considered "newly added".
 */
export function findNewlyAddedRefs(
  oldText: string | undefined,
  newText: string,
): UsesRefMatch[] {
  const oldRefs = new Set<string>()
  if (oldText) {
    for (const m of extractActionRefs(oldText)) {
      oldRefs.add(m.ref)
    }
  }
  const out: UsesRefMatch[] = []
  for (const m of extractActionRefs(newText)) {
    if (!oldRefs.has(m.ref)) {
      out.push(m)
    }
  }
  return out
}
