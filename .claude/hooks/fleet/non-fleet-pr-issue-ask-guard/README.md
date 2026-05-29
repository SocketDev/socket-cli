# non-fleet-pr-issue-ask-guard

PreToolUse hook that blocks `gh pr create` / `gh issue create` / `gh release create` calls targeting a repository NOT in the fleet roster, unless the user has typed the canonical bypass phrase.

## Rule

Public-facing artifacts (PRs, issues, releases) on non-fleet repos go out under the user's gh identity. They're permanent on the upstream side once posted — closing one with an "opened in error" comment doesn't fully un-publish it (the email notification fires, the issue number is consumed, the upstream maintainers see the noise).

The fleet rule: **never submit to a non-fleet repo without explicit per-action confirmation**. Captured plan text + batched "do all N tasks" directives are NOT standing authorization to post under your identity.

## Detection

Fires on Bash commands containing `gh pr create`, `gh issue create`, or `gh release create`. Resolves the target repo via:

1. `--repo <owner>/<name>` flag when present.
2. Otherwise, `git remote get-url origin` from the resolved git cwd (matching the priority order used by `no-non-fleet-push-guard`: `-C <dir>`, leading `cd <dir> &&`, then process.cwd()).

Blocks when the resolved slug is not in the fleet roster (`_shared/fleet-repos.mts::isFleetRepo`).

## Bypass

Type `Allow non-fleet-publish bypass` verbatim in a recent user turn. Per the fleet bypass-phrase convention. Single-action: a phrase from a previous turn doesn't carry forward indefinitely — the hook reads the active session's transcript.

## Why a hook

A captured-plan task that says "file an upstream issue" isn't permission to run `gh issue create` against that repo. 2026-05-28 incident: working through a deferred-tasks list, I ran `gh issue create --repo oxc-project/oxc ...` from a captured plan without re-confirming. The user said "don't create an issue" but the bg `gh` call had already completed; the issue was live until closed post-hoc.

This hook makes the rule enforceable at edit time — the bg call blocks before the API request fires.

## Fail-open

The hook fails open on its own bugs (exit 0 + stderr log) so a bad deploy can't brick the session.
