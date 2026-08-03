---
name: auditing-gha
description: Audit Actions permissions/allowlists against the fleet baseline; --conform fixes drift.
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash(gh:*), Bash(node:*), Bash(jq:*)
model: claude-haiku-4-5
context: fork
metadata:
  internal: true
---

# auditing-gha

Diff a fleet repo's GitHub Actions repository-level settings against the canonical baseline. The default run is a read-only audit; `--conform` writes the additive baseline — union the allowlist with the canonical set, tighten the two blanket-allow toggles, never prune. Destructive changes stay manual.

## When to use

- **"action X is not allowed to be used" CI failure**: the allowlist is missing an entry, or the policy got flipped from `selected` to `local_only`.
- **Onboarding a new fleet repo**: before the first CI run, confirm the new repo matches the baseline so the first push doesn't hit policy errors.
- **Periodic fleet health check**: drift accumulates. Somebody adds a workflow that needs a new action and silently flips `verified_allowed: true` to make it work instead of adding the explicit pattern.

## What the baseline checks

| Setting (per repo)                 | Baseline                   | Why                                                                                                                                                                                                                                                               |
| ---------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                          | `true`                     | Per-repo override is on. **Note**: `enabled: false` does NOT mean Actions are off — it means the per-repo override is unset and org policy is the source of truth. To get drift-detection on a repo, opt in to per-repo settings + mirror the canonical baseline. |
| `allowed_actions`                  | `'selected'`               | "Allow enterprise, and select non-enterprise, actions and reusable workflows" — the only mode where the explicit allowlist is the source of truth.                                                                                                                |
| `github_owned_allowed`             | `false`                    | Don't blanket-allow `actions/*`. The canonical patterns list already names every github-owned action we need; unlisted ones must be explicit.                                                                                                                     |
| `verified_allowed`                 | `false`                    | Marketplace "verified creator" is not implicit allow — every action must be on the canonical patterns list.                                                                                                                                                       |
| `patterns_allowed ⊇ canonical set` | Each fleet pattern present | Every canonical entry has a named consumer, a template workflow/composite or a declared fleet-member workflow, enforced by the `gha-allowlist-matches-template-uses` fleet check; missing one breaks its consumer at plan time.                                 |

The **canonical patterns** live in [`canonical-patterns.mts`](canonical-patterns.mts) next to this skill. Every fleet repo must have all of these. That file is the single source of truth: the audit and `--conform` import it, and the `gha-allowlist-matches-template-uses` fleet check enforces it against the template's workflow surface in both directions, so this document intentionally does not carry a copy that can drift.

Extras beyond the canonical set are tolerated — reported as info, not failure. A repo may pin a one-off action, but each extra should map to a real consumer; orphans should be pruned.

**Third-party actions are NOT on the allowlist.** Anything outside `actions/`, `github/`, and `depot/` should be ported to a hand-rolled composite under `SocketDev/socket-registry/.github/actions/` rather than added here. The current set of socket-registry composite replacements:

| Third-party                       | socket-registry composite  |
| --------------------------------- | -------------------------- |
| `dtolnay/rust-toolchain`          | `setup-rust-toolchain`     |
| `hendrikmuhs/ccache-action`       | `setup-ccache`             |
| `HaaLeo/publish-vscode-extension` | `publish-vscode-extension` |
| `mlugg/setup-zig`                 | `setup-zig`                |
| `pnpm/action-setup`               | `setup-pnpm`               |
| `softprops/action-gh-release`     | `create-gh-release`        |
| `Swatinem/rust-cache`             | `setup-rust-cache`         |

Note: `enabled: false` from the per-repo API does NOT mean Actions are disabled. It means the per-repo override is unset and org-level policy is in effect. The skill explains this in its output.

## How to invoke

    node .claude/skills/fleet/auditing-gha/run.mts SocketDev/socket-btm SocketDev/socket-cli

Or across the whole fleet, derived at run time from the single-source roster [`fleet-repos.json`](../cascading-fleet/lib/fleet-repos.json) — never a hand-maintained slug list, which is how a typo once dropped a repo from the fleet pass for a week:

    node .claude/skills/fleet/auditing-gha/run.mts --fleet

A repo argument that does not exist on GitHub is a loud per-repo failure naming the roster surface to fix, distinct from an admin-scope or org-policy fetch failure — a skipped repo reads as conformed.

For machine-readable output (one finding per repo):

    node .claude/skills/fleet/auditing-gha/run.mts --json SocketDev/socket-btm | jq

## How to fix the findings

Each finding line names the exact toggle to flip. Additive fixes are automated; destructive ones stay a human action.

1.  **`--conform` (alias `--fix`) - the sanctioned write path** for baseline drift. It is additive-only and extras-preserving: sets `allowed_actions=selected`, tightens `github_owned_allowed` and `verified_allowed` to `false`, and PUTs the UNION of the repo's current patterns + the canonical set — a repo's extra pins survive, only missing canonical patterns are added, nothing is ever pruned. Needs admin scope. A repo whose per-repo override is unset is skipped with an error: org policy governs there, and conform never creates an override behind the operator's back.

        node .claude/skills/fleet/auditing-gha/run.mts --conform --fleet

2.  **Web UI — for destructive changes**: pruning orphaned extras, disabling Actions, or handing a repo back to org policy affects every workflow on the repo and stays manual: Repo → Settings → Actions → General. The settings map 1:1 with the audit findings:
    - "Allow enterprise, and select non-enterprise, actions and reusable workflows" → flips `allowed_actions` to `selected`.
    - Uncheck "Allow actions created by GitHub" → `github_owned_allowed: false`.
    - Uncheck "Allow Marketplace actions by verified creators" → `verified_allowed: false`.
    - "Allow specified actions and reusable workflows" textarea: paste the canonical patterns list (one per line). Existing extras can stay; remove only ones with no consumer.

## Anti-patterns

- **Hand-rolling `gh api` PUTs against the selected-actions endpoint.** The endpoint has whole-list replace semantics: a PUT that omits the repo's existing extras silently drops them. `--conform` exists to do the union + toggle-tighten safely; use it instead of ad-hoc PUT commands.
- **Pruning allowlist extras from a script.** Conform is additive by design — removing an entry breaks whatever consumer pinned it. Prune manually, after `rg <pattern> .github/workflows/` shows the extra has no consumer.
- **Adding an action to the allowlist to make a one-off workflow happy.** First ask: should the workflow use a shared socket-registry workflow that already references an approved action? Adding entries to the canonical set means cascading them to every consumer org. A real commitment.
- **Treating the audit as a security review.** It checks policy state, not workflow content. A workflow that uses an allowed action insecurely (e.g. `pull_request_target` + `actions/checkout` of untrusted ref) is invisible to this audit; that's `pull-request-target-guard`'s job.

## Companion: `greening-ci`

If a CI failure shows `action <X> is not allowed by enterprise admin` or `not allowed to be used in this repository`, that's an allowlist gap. Run this audit, close the gap with `--conform` when it's a missing canonical pattern, then re-run `/green-ci` to confirm the build goes green.
