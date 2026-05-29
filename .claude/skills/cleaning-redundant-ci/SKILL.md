---
name: cleaning-redundant-ci
description: Sweeps a fleet repo (or every fleet repo) for redundant CI surface. Three classes: orphan workflow YAML files (lint.yml / check.yml / type.yml / test.yml that the unified ci.yml replaced), GitHub-Dependabot auto-fix PRs that the fleet handles via /updating-security, and stale workflow run history in the Actions sidebar. Deletes the YAML files, disables Dependabot automated-security-fixes via gh api, and reports anything that needs a manual UI toggle. Once-and-never-again sweep meant to leave a repo clean.
user-invocable: true
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(gh:*), Bash(git:*), Bash(ls:*), Bash(rm:*), Bash(find:*), Bash(jq:*)
model: claude-haiku-4-5
context: fork
---

# cleaning-redundant-ci

Audit + clean redundant CI surface on a Socket fleet repo. Three
target classes:

1. **Orphan workflow YAML files**: `lint.yml`, `check.yml`, `type.yml`, `test.yml`. The fleet consolidated those into the shared `ci.yml` (via `SocketDev/socket-registry/.github/workflows/ci.yml`) long ago. Any per-repo file with those names is a leftover from pre-consolidation days. Delete them.

2. **GitHub-Dependabot automated security PRs**: the fleet pattern is to handle vulnerability fixes via `/updating-security` (pnpm `overrides:` for transitive deps), not via auto-PRs from Dependabot. The `dependabot.yml` no-op file (`open-pull-requests-limit: 0`) suppresses version-update PRs but does NOT suppress security PRs. Those flow from a separate repo-settings toggle (`automated-security-fixes`). Disable via `gh api -X DELETE /repos/{owner}/{repo}/automated-security-fixes`.

3. **Stale workflow run history**: when a workflow YAML gets deleted, the **runs** stay listed in the Actions sidebar forever (the workflow appears as a name with no associated file). Delete the workflow record via `gh api /repos/{owner}/{repo}/actions/workflows/{id} -X DELETE` to remove the sidebar entry.

## When to use

- **Onboarding a new fleet repo**: sweep once on first integration to clear any pre-fleet CI baggage.
- **After a CI consolidation cascade**: when the fleet retires a workflow shape (e.g. the lint/check/type/test → unified ci.yml migration), run this skill on every fleet repo to clean up the per-repo leftovers.
- **Periodic fleet-wide health check**: run quarterly to catch drift (someone adds a per-repo `lint.yml` to scratch an itch, forgetting the unified ci.yml already covers it).

## What it does NOT do

- **Touch the `dependabot.yml` file.** That file MUST exist (GitHub
  refuses to fully disable Dependabot without it) and the fleet
  convention is to ship it pre-configured with
  `open-pull-requests-limit: 0`. The skill leaves the file alone;
  only the `automated-security-fixes` toggle is acted on.
- **Touch `SocketDev/workflows`.** Don't edit org-level required workflows from this skill. The org config is the source of truth for what runs cross-repo, and silent edits are unsafe.
- **Delete legitimate per-repo workflows.** socket-btm's per-binary build dispatchers (`curl.yml`, `lief.yml`, etc.), ultrathink's `build-*.yml`, socket-packageurl-js's `pages.yml` /`valtown.yml`, socket-registry's `_local-not-for-reuse-*.yml` dogfood copies all stay. The skill only matches the four canonical orphan names.

## Phases

### Phase 1: inventory

```sh
# Orphan YAML files
ls .github/workflows/ | grep -E '^(lint|check|type|test)\.ya?ml$'

# Workflow records (live + stale)
gh api "repos/{owner}/{repo}/actions/workflows" --paginate \
  --jq '.workflows[] | "\(.id)\t\(.state)\t\(.name)\t\(.path)"'

# Dependabot automated-security-fixes state
gh api "repos/{owner}/{repo}/automated-security-fixes" --jq .enabled
```

Categorise each finding:

- **delete-file**: orphan YAML on disk
- **delete-record**: workflow record whose `.path` no longer exists in the repo OR whose name matches the orphan pattern
- **toggle-off**: `automated-security-fixes: true`

### Phase 2: file deletions (commit + push)

```sh
git rm .github/workflows/{lint,check,type,test}.yml 2>/dev/null
git commit -m "chore(ci): remove orphan {lint,check,type,test} workflows (consolidated into ci.yml)"
```

One commit per repo, conventional-commit subject. Push directly to
main per fleet policy (or fall back to PR if branch protection
requires).

### Phase 3: workflow record deletions (gh api)

For each delete-record finding:

```sh
gh api -X DELETE "repos/{owner}/{repo}/actions/workflows/{id}"
```

GitHub returns 204 on success. The record disappears from the
Actions sidebar. Runs associated with the workflow remain in their
own URLs but stop showing in the per-workflow filter.

Skip workflow records that match `dynamic/dependabot/...`. Those are GitHub-managed and can't be deleted via API. They'll stop appearing on their own once Dependabot has nothing to do (after Phase 4).

### Phase 4: disable Dependabot automated-security-fixes

```sh
gh api -X DELETE "repos/{owner}/{repo}/automated-security-fixes"
```

204 = disabled. Going forward, security advisories are visible in
the Security tab (via the `vulnerability-alerts` setting, which
stays on) but won't open auto-PRs. The fleet's `/updating-security`
skill is the canonical path for resolving them.

### Phase 5: report

For each repo: list what was deleted, what was disabled, and what needs manual UI action (rare; most things this skill touches are API-actionable).

## Fleet-wide invocation

```sh
# One repo
/cleaning-redundant-ci socket-foo

# All fleet repos (reads template/.claude/skills/cascading-fleet/lib/fleet-repos.json)
/cleaning-redundant-ci --all
```

The fleet-roster path is the canonical list. Same file the cascade mechanism uses. Don't hard-code a repo list inside this skill.

## Safety

- **Read-only inventory first.** Print findings before any deletion.
- **Per-repo confirmation** in interactive mode; `--yes` to skip.
- **Direct push to main, fall back to PR** per fleet policy. Never
  force-push.
- **Never edit `dependabot.yml`.** Only the `automated-security-fixes` toggle. The .yml is structurally required.
- **Never touch `SocketDev/workflows`.** Org-required workflows are out of scope.

## Why a skill, not a hook

This is operator-invoked maintenance, not edit-time enforcement. Hooks are the wrong shape: there's no `gh commit` or `gh push` event that should trigger a fleet-wide CI audit. Skills are user-callable, run on demand, and produce a one-shot report.
