/**
 * @file Canonical fleet GitHub Actions allowlist — the single source of truth.
 *   The auditing-gha skill (run.mts) PUTs this set to every fleet repo's
 *   selected-actions settings, and the gha-allowlist-matches-template-uses
 *   fleet check enforces both directions between this set and the template's
 *   workflow surface: every cascaded `uses:` must match a pattern — a miss
 *   plan-fails every strict-allowlist repo as a startup_failure — and every
 *   pattern must have a named consumer, local or declared below. Data only,
 *   no imports and no side effects, so any consumer can import it freely.
 */

// Every entry is referenced by at least one workflow or composite in this
// repo's template tree, or carries a named external consumer in
// EXTERNALLY_CONSUMED_PATTERNS below. Removing an entry breaks its consumer
// at plan time; adding one requires a real consumer plus an auditing-gha
// --conform pass across the fleet roster so repo settings pick it up.
// Both requirements are enforced by
// scripts/fleet/check/gha-allowlist-matches-template-uses.mts.
//
// Third-party patterns — dtolnay/, hendrikmuhs/, HaaLeo/, pnpm/action-setup,
// softprops/, Swatinem/ — were removed in favor of hand-rolled composites
// under .github/actions/fleet/. Anything new third-party should be ported to
// a composite rather than added to this list. A repo whose own workflows need
// more, like decmpfs's rust and docker set, carries repo-level superset
// entries; conform preserves them and never prunes.
//
// 2026-07-24 pruning, org-wide code-search verified: actions/setup-python@*,
// depot/build-push-action@*, and github/codeql-action/upload-sarif@* had no
// consumer in any fleet-roster repo's workflows and were removed. Conform is
// additive-only, so existing repo settings kept their entries; re-add here
// with a named consumer if a workflow needs one again.
//
// Sorted alphabetically.
export const CANONICAL_PATTERNS: readonly string[] = [
  'actions/cache/restore@*',
  'actions/cache/save@*',
  'actions/cache@*',
  'actions/checkout@*',
  // Consumer: the gh-aw weekly-update lock workflow's SOCKET_PR
  // app-token wiring — every strict-allowlist repo mints its PR token
  // through this action, and omitting it plan-fails the whole run.
  'actions/create-github-app-token@*',
  'actions/deploy-pages@*',
  'actions/download-artifact@*',
  'actions/github-script@*',
  'actions/setup-go@*',
  'actions/setup-node@*',
  'actions/upload-artifact@*',
  'actions/upload-pages-artifact@*',
  'depot/setup-action@*',
  'github/gh-aw-actions/*',
]

// Canonical patterns whose only consumers are fleet members' OWN workflows —
// files that live in member repos, not in this repo's template tree, so the
// gha-allowlist-matches-template-uses check cannot see them locally. Each
// entry names a concrete consumer as `owner/repo path` so the claim stays
// auditable; consumers verified via org-wide code search on 2026-07-24. The
// check fails a declaration that goes stale — a pattern listed here that the
// template tree now references, or one that is no longer canonical.
export const EXTERNALLY_CONSUMED_PATTERNS: Readonly<Record<string, string>> = {
  'actions/deploy-pages@*': 'SocketDev/meander .github/workflows/pages.yml',
  'actions/upload-pages-artifact@*':
    'SocketDev/meander .github/workflows/pages.yml',
}
