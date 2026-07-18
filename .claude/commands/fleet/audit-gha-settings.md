---
description: Audit GitHub Actions repo settings + allowlist against the fleet baseline. Read-only — reports what to flip; fixes are manual in Settings → Actions.
---

Audit GitHub Actions permissions + allowlist for `$ARGUMENTS` (one or more `<owner/repo>` args).

If no arguments given, audit the canonical fleet repo list:

- `SocketDev/socket-btm`
- `SocketDev/socket-cli`
- `SocketDev/socket-gemini-nano`
- `SocketDev/socket-lib`
- `SocketDev/socket-mcp`
- `SocketDev/socket-packageurl-js`
- `SocketDev/socket-registry`
- `SocketDev/socket-sdk-js`
- `SocketDev/socket-sdxgen`
- `SocketDev/socket-stuie`
- `SocketDev/socket-vscode`
- `SocketDev/socket-webext`
- `SocketDev/socket-wheelhouse`
- `SocketDev/ultrathink`

## Process

1. Invoke the `auditing-gha` skill runner:

   node .claude/skills/fleet/auditing-gha/run.mts <owner/repo>...

2. The runner exits non-zero if any repo fails the baseline. Read the per-repo findings on stdout.

3. For each failing repo, summarize to the user:
   - **What's wrong**: the specific settings drift (allowed_actions wrong mode, github_owned_allowed/verified_allowed flipped on, allowlist missing canonical patterns).
   - **How to fix**: the exact Settings → Actions toggles, in the order the user would flip them in the web UI.

4. **Do not auto-fix.** Settings → Actions changes affect every workflow on the repo and silently weaken supply-chain posture if wrong. The user flips the toggles.

5. After the user reports they've made the changes, re-run the audit to confirm green.

## Rules

- Surface findings in the order: required failures first (policy mode, blanket-allows, missing canonical patterns), then info (extras beyond canonical).
- Don't suggest pruning extras unless you can verify they have no workflow consumer — `rg <pattern> .github/workflows/` is cheap and conclusive.
- If the runner fails to fetch settings for a repo, ask whether the user has admin scope on that repo's token — the endpoint requires it.

## Anti-patterns

- Generating `gh api -X PUT` commands and running them. The skill is read-only by design.
- Adding a new entry to the canonical list to make one repo's audit pass. New canonical entries must come from a shared socket-registry workflow change — they cascade fleet-wide.
- Treating extras as failures. A repo may legitimately allow a one-off action that doesn't appear in any other fleet repo's workflows.

## Example call sites

    /audit-gha-settings
    /audit-gha-settings SocketDev/socket-btm
    /audit-gha-settings SocketDev/socket-btm SocketDev/socket-cli
