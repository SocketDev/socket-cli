---
name: updating-security
description: Resolve open GitHub Dependabot security alerts on a fleet repo. Fetches alerts via `gh api`, applies fixes (direct dep bump, pnpm override for transitives, or principled dismissal for unfixable), validates with `pnpm run check`, commits per-alert, and reports remaining advisories. Sibling of `updating-lockstep` under the `updating` umbrella.
user-invocable: true
allowed-tools: AskUserQuestion, Read, Edit, Grep, Glob, Bash(gh api:*), Bash(gh auth:*), Bash(pnpm:*), Bash(git:*), Bash(node:*), Bash(jq:*)
---

# updating-security

Walk open Dependabot security alerts on the current repo and fix
them via the cheapest principled mechanism. Invoked directly via
`/update-security` or as Phase 5 of the `updating` umbrella.

## When to use

- A `gh dependabot alerts` listing shows open advisories.
- The GitHub web UI security tab is non-empty after a push (`gh`
  warns "Dependabot found N vulnerabilities" on push completion).
- As part of weekly maintenance (the `updating` umbrella invokes
  this automatically when alerts are present).

## What it does NOT do

- **Disable alerts at the repo level.** Suppressing the security
  tab via repo settings is a separate (heavier) decision; this
  skill resolves the underlying CVEs.
- **Touch `dependabot.yml`.** The fleet ships a no-op
  `dependabot.yml` (`open-pull-requests-limit: 0`) so Dependabot
  doesn't open version-update PRs; security alerts are independent
  and surface regardless.
- **Auto-dismiss without evidence.** Dismissals require a reason
  matching one of GitHub's documented values
  (`fix_started` / `inaccurate` / `no_bandwidth` / `not_used` /
  `tolerable_risk`) and a one-line justification. The skill asks
  before dismissing.

## Phases

| #   | Phase                | Outcome                                                                                                                                                                                                                                                           |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Discover             | `gh api repos/{owner}/{repo}/dependabot/alerts?state=open`. Group by package + relationship (direct / transitive).                                                                                                                                                |
| 2   | Classify             | Each alert → one of: `direct-fix` (bump the catalog / `package.json` pin), `override-fix` (pnpm override for transitive), `dismiss-with-reason`. Resolve the PIN TARGET = highest soaked release sharing `first_patched`'s major (see reference.md "Pin target"). |
| 3   | Apply direct fixes   | For each direct dep: bump to the resolved exact pin version; commit per alert.                                                                                                                                                                                    |
| 4   | Apply override fixes | For each transitive: add an EXACT pin to `overrides:` in **pnpm-workspace.yaml** (not `package.json`); `pnpm install`; commit per row.                                                                                                                            |
| 5   | Validate             | `pnpm run check --all` (interactive) or `pnpm run check --staged` (CI). Roll back any commit whose check fails.                                                                                                                                                   |
| 6   | Push                 | Per CLAUDE.md push policy: `git push origin <branch>`, fall back to PR on rejection. NEVER force-push.                                                                                                                                                            |
| 7   | Verify resolution    | After push lands, `gh api .../dependabot/alerts` should show each fixed alert as `auto_dismissed` or `fixed`. Log remaining.                                                                                                                                      |
| 8   | Report               | Per-alert table: alert # / pkg / severity / action taken / state.                                                                                                                                                                                                 |

## Hard requirements

- **Clean tree on entry**: same rule as `updating` umbrella.
- **One commit per alert**: `chore(security): bump <pkg> to <ver> (GHSA-XXXX)` or `chore(security): override <pkg> to <ver> (GHSA-XXXX)`. `<ver>` is an exact version, never a `^`/`>=`/`~` range.
- **Exact pins, highest-soaked-in-major**: pin to the highest release sharing `first_patched_version`'s major that's past the 7-day soak — never a range, never an auto major-cross. Crossing a major requires an AI benignity check (socket-lib `spawnAiAgent`) that returns BENIGN (ESM-only / Node-floor / dropped deep-imports), and is then auto-applied **with a notice in the Phase-8 report**; a BREAKING or unavailable verdict requires `AskUserQuestion` signoff. See reference.md "Pin target".
- **No `--no-verify`**: the soak / cooldown guard (`minimum-release-age-guard`) MUST be honored. If a patched version is inside the 7-day soak, the skill notes the alert as `awaiting-soak` and returns without modification.
- **Conventional Commits**: `chore(security): <action>` (per CLAUDE.md _Commits & PRs_).
- **Default-branch fallback**: never hard-code `main` (per CLAUDE.md _Default branch fallback_).
- **GitHub auth**: assumes `gh auth status` returns OK. Token must have `security_events:read` + `repo` scopes. Personal `gh` login satisfies both.

## Success criteria

- Every alert that has a `first_patched_version` is either fixed,
  awaiting-soak, or has an explicit dismissal request.
- Working tree clean after the commit chain.
- `pnpm run check` passes against the fix set.

**Safety:** every commit is atomic and the skill can be interrupted at any phase. Resume by re-running. Already-applied fixes show up as `auto_dismissed` and are skipped.

Full bash, alert-shape reference, dismissal-reason taxonomy, and
recovery procedures in [`reference.md`](reference.md).
