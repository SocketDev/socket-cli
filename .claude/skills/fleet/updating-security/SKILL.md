---
name: updating-security
description: Resolve open Dependabot security alerts by bumping, overriding, patching, or dismissing with evidence.
user-invocable: true
allowed-tools: Workflow, AskUserQuestion, Read, Edit, Grep, Glob, Bash(gh api:*), Bash(gh auth:*), Bash(pnpm:*), Bash(git:*), Bash(node:*), Bash(jq:*)
model: claude-sonnet-4-6
context: fork
---

# updating-security

Walk open Dependabot security alerts on the current repo and fix
them via the cheapest principled mechanism. Discovers the alert set
inline, then runs a `Workflow` that pipelines each alert through
classify → fix → validate → commit independently. Invoked directly
via `/update-security` or as Phase 5 of the `updating` umbrella.

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

Phase 1 (Discover) runs inline — one `gh api` call to build the work-list. The per-alert work (Phases 2–5) is independent fan-out where each alert classifies → fixes → validates → commits on its own timeline, so it runs as a **`Workflow`** `pipeline()`. Phases 6–8 (push / verify / report) run inline after the pipeline returns, because push and verify need the full committed set at once.

| #   | Phase                | Outcome                                                                                                                                                                                                                                                           |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Discover (inline)    | `gh api repos/{owner}/{repo}/dependabot/alerts?state=open`. Group by package + relationship (direct / transitive). This is the pipeline work-list.                                                                                                                |
| 2   | Classify (pipeline)  | Each alert → one of: `direct-fix` (bump the catalog / `package.json` pin), `override-fix` (pnpm override for transitive), `dismiss-with-reason`. Resolve the PIN TARGET = highest soaked release sharing `first_patched`'s major (see reference.md "Pin target"). |
| 3   | Apply fix (pipeline) | Direct: bump to the resolved exact pin. Transitive: add an EXACT pin to `overrides:` in **pnpm-workspace.yaml** (not `package.json`); `pnpm install`. Commit per alert.                                                                                           |
| 4   | Validate (pipeline)  | `pnpm run check --all` (interactive) or `pnpm run check --staged` (CI). Roll back this alert's commit if its check fails; the failed item drops out of the pipeline.                                                                                              |
| 5   | Push (inline)        | After the pipeline returns: per CLAUDE.md push policy, `git push origin <branch>`, fall back to PR on rejection. NEVER force-push.                                                                                                                                |
| 6   | Verify resolution    | `gh api .../dependabot/alerts` should show each fixed alert as `auto_dismissed` or `fixed`. Log remaining.                                                                                                                                                        |
| 7   | Report               | Per-alert table: alert # / pkg / severity / action taken / state. Roll the pipeline's per-item `RESULT_SCHEMA` rows into this table.                                                                                                                              |

### The per-alert pipeline: author a `Workflow`

The skill invoking `Workflow` is a sanctioned opt-in. Pass the discovered alert list as `args`. Author the script inline (don't pre-`Write` it). Shape:

```
pipeline(alerts, classify, applyAndValidate)
```

1. **`classify` stage** — one `agent()` per alert returning `CLASSIFY_SCHEMA`: `{ alertNumber, package, relationship: direct|transitive, action: direct-fix|override-fix|dismiss-with-reason|awaiting-soak, pinTarget, crossesMajor, dismissReason? }`. Resolve the pin deterministically with `npm view <pkg> time --json > /tmp/<pkg>-time.json` then `node scripts/fleet/resolve-security-pin.mts --first-patched <ver> --versions-file /tmp/<pkg>-time.json` — it returns `{ outcome: resolved|awaiting-soak|cross-major|no-candidate, pinTarget, reason }` (highest STABLE release in `first_patched`'s major that has cleared the 7-day soak; the semver work uses socket-lib's `versions/*` helpers, never hand-rolled). Map: `resolved` → `pinTarget` + `crossesMajor:false`; `awaiting-soak` → `action:awaiting-soak`; `cross-major` → `crossesMajor:true` + `pinTarget` (the cross-major candidate the benignity gate below judges); `no-candidate` → dismiss/escalate. The script does the math; the cross-major benignity call + dismissal reason stay your judgment.
2. **`applyAndValidate` stage** — receives the classification, applies the fix (`direct-fix` → bump pin; `override-fix` → `pnpm-workspace.yaml` `overrides:` + `pnpm install`; `dismiss-with-reason` → record the dismissal), commits `chore(security): …`, runs `pnpm run check`, and returns `RESULT_SCHEMA`: `{ alertNumber, package, severity, actionTaken, committed: boolean, state: fixed|awaiting-soak|dismissed|check-failed }`. A check failure rolls back that commit and the stage throws, dropping the item to `null` (filter before reporting).
3. **Major-cross gate** — when `crossesMajor` is true, the `applyAndValidate` stage first spawns a benignity-check `agent()` (the socket-lib `spawnAiAgent` equivalent) returning `{ verdict: BENIGN|BREAKING|UNAVAILABLE, why }`. `BENIGN` auto-applies with a Phase-7 notice; `BREAKING`/`UNAVAILABLE` skips the fix and flags the alert for `AskUserQuestion` signoff (interactive) or `awaiting-review` (non-interactive). Never auto-cross a major without a `BENIGN` verdict.

`awaiting-soak` alerts (patched version inside the 7-day window) return from `classify` with no fix stage work — the pipeline records them and moves on; the soak guard is never bypassed.

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
