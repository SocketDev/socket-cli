---
description: Audit GitHub Actions repo settings + allowlist against the fleet baseline. Read-only by default; additive fixes via the runner's --conform, destructive changes manual in Settings → Actions.
---

Audit GitHub Actions permissions + allowlist for `$ARGUMENTS` (one or more `<owner/repo>` args).

If no arguments given, audit the whole fleet with `--fleet` — the runner derives the repo list from the single-source roster at `.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json`. Never expand a hand-maintained slug list here: one drifted for a week on a typo.

## Process

1. Invoke the `auditing-gha` skill runner:

   node .claude/skills/fleet/auditing-gha/run.mts <owner/repo>...

   Or fleet-wide, from the roster:

   node .claude/skills/fleet/auditing-gha/run.mts --fleet

2. The runner exits non-zero if any repo fails the baseline. Read the per-repo findings on stdout.

3. For each failing repo, summarize to the user:
   - **What's wrong**: the specific settings drift (allowed_actions wrong mode, github_owned_allowed/verified_allowed flipped on, allowlist missing canonical patterns).
   - **How to fix**: baseline drift → the runner's `--conform` (additive-only, extras-preserving — it unions the allowlist and tightens the two toggles, never prunes); anything destructive → the exact Settings → Actions toggles, in the order the user would flip them in the web UI.

4. **Write only when asked, and only additively.** Run `--conform` when the user asks for the fix; it needs admin scope. Destructive changes stay with the user in the web UI. Note: that covers pruning extras, disabling Actions, and handing a repo back to org policy.

5. After conforming or after the user reports manual changes, re-run the audit to confirm green.

## Rules

- Surface findings in the order: required failures first (policy mode, blanket-allows, missing canonical patterns), then info (extras beyond canonical).
- Don't suggest pruning extras unless you can verify they have no workflow consumer — `rg <pattern> .github/workflows/` is cheap and conclusive.
- If the runner fails to fetch settings for a repo, ask whether the user has admin scope on that repo's token — the endpoint requires it.
- If the runner reports "Repo not found on GitHub", the roster entry itself is wrong — fix the entry it names, and never wave it off as a permissions issue. A skipped repo reads as conformed.

## Anti-patterns

- Hand-rolling `gh api -X PUT` commands. The selected-actions endpoint replaces the whole list, so an ad-hoc PUT can silently drop a repo's extra pins — the runner's `--conform` does the additive union safely.
- Adding a new entry to the canonical list to make one repo's audit pass. New canonical entries must come from a shared socket-registry workflow change — they cascade fleet-wide.
- Treating extras as failures. A repo may legitimately allow a one-off action that doesn't appear in any other fleet repo's workflows.

## Example call sites

    /audit-gha-settings
    /audit-gha-settings SocketDev/socket-btm
    /audit-gha-settings SocketDev/socket-btm SocketDev/socket-cli
