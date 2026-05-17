---
name: auditing-gha-settings
description: Audits a repo's GitHub Actions permissions + allowlist against the fleet baseline. Reports drift only — fixes are manual in Settings → Actions because flipping these silently is unsafe. Use when a CI failure looks like "action X is not allowed to be used", when onboarding a new fleet repo, or as a periodic fleet-wide health check.
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash(gh:*), Bash(node:*), Bash(jq:*)
---

# auditing-gha-settings

Diff a fleet repo's GitHub Actions repository-level settings against the canonical baseline. Read-only — surfaces what to change, doesn't change it.

## When to use

- **"action X is not allowed to be used" CI failure** — the allowlist is missing an entry, or the policy got flipped from `selected` to `local_only`.
- **Onboarding a new fleet repo** — before the first CI run, confirm the new repo matches the baseline so the first push doesn't hit policy errors.
- **Periodic fleet health check** — drift accumulates; somebody adds a workflow that needs a new action and silently flips `verified_allowed: true` to make it work instead of adding the explicit pattern.

## What the baseline checks

| Setting (per repo)                  | Baseline                           | Why                                                                                                                                                  |
| ----------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                           | `true`                             | Per-repo override is on. **Note**: `enabled: false` does NOT mean Actions are off — it means the per-repo override is unset and org policy is the source of truth. To get drift-detection on a repo, opt in to per-repo settings + mirror the canonical baseline. |
| `allowed_actions`                   | `'selected'`                       | "Allow enterprise, and select non-enterprise, actions and reusable workflows" — the only mode where the explicit allowlist is the source of truth. |
| `github_owned_allowed`              | `false`                            | Don't blanket-allow `actions/*`. The canonical patterns list already names every github-owned action we need; unlisted ones must be explicit.        |
| `verified_allowed`                  | `false`                            | Marketplace "verified creator" is not implicit allow — every action must be on the canonical patterns list.                                          |
| `patterns_allowed ⊇ canonical set` | Each fleet pattern present         | Each canonical entry is referenced by at least one socket-registry shared workflow; missing one breaks every consumer.                              |

The **canonical patterns** (every fleet repo must have all of these):

- `actions/cache/restore@*`
- `actions/cache/save@*`
- `actions/cache@*`
- `actions/checkout@*`
- `actions/deploy-pages@*`
- `actions/download-artifact@*`
- `actions/github-script@*`
- `actions/setup-go@*`
- `actions/setup-node@*`
- `actions/setup-python@*`
- `actions/upload-artifact@*`
- `actions/upload-pages-artifact@*`
- `depot/build-push-action@*`
- `depot/setup-action@*`
- `github/codeql-action/upload-sarif@*`

Extras beyond the canonical set are tolerated (reported as info, not failure). A repo may legitimately pin a one-off action — but each extra should map to a real consumer; orphans should be pruned.

**Third-party actions are NOT on the allowlist.** Anything outside `actions/`, `github/`, and `depot/` should be ported to a hand-rolled composite under `SocketDev/socket-registry/.github/actions/` rather than added here. The current set of socket-registry composite replacements:

| Third-party | socket-registry composite |
| --- | --- |
| `dtolnay/rust-toolchain` | `setup-rust-toolchain` |
| `hendrikmuhs/ccache-action` | `setup-ccache` |
| `HaaLeo/publish-vscode-extension` | `publish-vscode-extension` |
| `mlugg/setup-zig` | `setup-zig` |
| `pnpm/action-setup` | `setup-pnpm` |
| `softprops/action-gh-release` | `create-gh-release` |
| `Swatinem/rust-cache` | `setup-rust-cache` |

Note: `enabled: false` from the per-repo API does NOT mean Actions are disabled — it means the per-repo override is unset and org-level policy is in effect. The skill explains this in its output.

## How to invoke

    node .claude/skills/auditing-gha-settings/run.mts SocketDev/socket-btm SocketDev/socket-cli

Or all-at-once with the canonical fleet list (manual today; the orchestrator skill prompt expands the list at call time):

    node .claude/skills/auditing-gha-settings/run.mts \
      SocketDev/socket-btm \
      SocketDev/socket-cli \
      SocketDev/socket-lib \
      SocketDev/socket-mcp \
      SocketDev/socket-packageurl-js \
      SocketDev/socket-registry \
      SocketDev/socket-sdk-js \
      SocketDev/socket-sdxgen \
      SocketDev/socket-stuie \
      SocketDev/socket-wheelhouse \
      SocketDev/ultrathink \
      SocketDev/vscode-socket-security

For machine-readable output (one finding per repo):

    node .claude/skills/auditing-gha-settings/run.mts --json SocketDev/socket-btm | jq

## How to fix the findings

Each finding line names the exact toggle to flip. The fix is **manual**: the runner does not write — flipping these silently is a credible attack vector and should always be a human action.

Two paths:

1. **Web UI (preferred)** — Repo → Settings → Actions → General. The settings map 1:1 with the audit findings:
   - "Allow enterprise, and select non-enterprise, actions and reusable workflows" → flips `allowed_actions` to `selected`.
   - Uncheck "Allow actions created by GitHub" → `github_owned_allowed: false`.
   - Uncheck "Allow Marketplace actions by verified creators" → `verified_allowed: false`.
   - "Allow specified actions and reusable workflows" textarea — paste the canonical patterns list (one per line). Existing extras can stay; remove only ones with no consumer.

2. **`gh api` PUT (admin-scoped tokens only)** — surfaced for completeness; prefer the UI:

       gh api -X PUT repos/<owner>/<repo>/actions/permissions \
         -F enabled=true -F allowed_actions=selected
       gh api -X PUT repos/<owner>/<repo>/actions/permissions/selected-actions \
         -F github_owned_allowed=false -F verified_allowed=false \
         -f patterns_allowed[]='actions/cache/restore@*' \
         -f patterns_allowed[]='actions/cache/save@*' \
         # ...one -f per canonical pattern...

   The whole-list replace semantics on the selected-actions endpoint mean **omitting a repo's existing extras drops them** — preserve them when relevant.

## Anti-patterns

- **Auto-PUT-ing the baseline from a script.** Don't. The settings affect every workflow on the repo and a wrong setting silently weakens supply-chain posture. The user runs the audit, the user fixes.
- **Adding an action to the allowlist to make a one-off workflow happy.** First ask: should the workflow use a shared socket-registry workflow that already references an approved action? Adding entries to the canonical set means cascading them to every consumer org — a real commitment.
- **Treating the audit as a security review.** It checks policy state, not workflow content. A workflow that uses an allowed action insecurely (e.g. `pull_request_target` + `actions/checkout` of untrusted ref) is invisible to this audit; that's `pull-request-target-guard`'s job.

## Companion: `greening-ci`

If a CI failure shows `action <X> is not allowed by enterprise admin` or `not allowed to be used in this repository`, that's an allowlist gap — run this audit, fix the gap manually, then re-run `/green-ci` to confirm the build goes green.
