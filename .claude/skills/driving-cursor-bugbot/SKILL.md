---
name: driving-cursor-bugbot
description: Drives the Cursor Bugbot review-and-fix loop on a PR. Inventories open Bugbot threads, classifies each (real bug / false positive / already fixed), fixes the real ones, replies on the inline thread (never as a detached PR comment), updates the PR title/body if scope shifted, and pushes. Use when reviewing a PR you just authored, after `gh pr create`, or after a new Bugbot pass on an existing PR.
user-invocable: true
allowed-tools: Read, Edit, Write, Grep, Glob, AskUserQuestion, Bash(gh:*), Bash(git:*), Bash(pnpm run:*), Bash(rg:*), Bash(grep:*)
---

# driving-cursor-bugbot

Drives the Cursor Bugbot fix-and-respond loop end-to-end. The canonical flow every PR author should run after Bugbot posts findings.

## Why a skill

Cursor Bugbot's review surface is easy to mis-handle:

- **Replies must thread on the inline review-comment**, not as a detached PR comment. A detached `gh pr comment` doesn't mark the thread resolved and the bot doesn't see it as a response.
- **Findings stale after fixes land.** Bugbot reviews a specific commit SHA. When you push a fix, the comment still references the old commit; the thread stays open until you reply marking it resolved.
- **Stale findings vs. live bugs vs. false positives** all read the same on the API surface. Triaging needs a process, not vibes.
- **Scope creep on PRs**. CLAUDE.md mandates "When adding commits to an OPEN PR, update the PR title and description to match the new scope." Easy to forget when you're heads-down fixing Bugbot findings.

This skill makes all of the above mechanical.

## Modes

| Invocation | What it does |
|---|---|
| `/driving-cursor-bugbot <PR#>` | Full audit-and-fix on one PR (default). |
| `/driving-cursor-bugbot check <PR#>` | List Bugbot findings, classify them — don't fix or reply. |
| `/driving-cursor-bugbot reply <comment-id> <state>` | Single reply where `<state>` is `fixed` / `false-positive` / `wont-fix`. Auto-resolves on `fixed` / `false-positive`; leaves open for `wont-fix`. |
| `/driving-cursor-bugbot resolve <PR#>` | Sweep open Bugbot threads with author replies and resolve them. |
| `/driving-cursor-bugbot scope <PR#>` | Re-evaluate the PR title and body against the actual commits and rewrite when out of step. |

## Phases

| # | Phase | Outcome |
|---|---|---|
| 1 | Inventory | List Bugbot findings via `gh api .../pulls/<PR#>/comments`. Capture `id`, `path`, `line`, body. |
| 2 | Classify | Sort each finding into `real` / `already-fixed` / `false-positive` / `wont-fix`. |
| 3 | Fix | Implement fixes for `real` findings. Propagate to canonical (`socket-repo-template/template/`) when the file is fleet-shared. One commit per finding. |
| 4 | Reply + resolve | Reply on each inline thread (NOT detached); resolve on `fixed` / `already-fixed` / `false-positive`; leave `wont-fix` open. |
| 5 | Title + body realignment | Per CLAUDE.md, update PR title / body when scope shifted. Use `gh pr edit`. |
| 6 | Push | `git push`. Bugbot re-reviews; loop back to phase 1 if new findings. |

API surface, GraphQL queries, and reply templates in [`reference.md`](reference.md).

## Classification rubric

| Bucket | Meaning | Action |
|---|---|---|
| `real` | Live bug, reproducible against current PR HEAD. | Fix the code, push, reply with the fix commit SHA. |
| `already-fixed` | Bugbot reviewed an old commit; later commit on the same PR fixed it. | Reply citing the existing fix commit SHA. No new code. |
| `false-positive` | Bugbot misread the code (hash length miscount, regex backtracking false-flag, JSDoc-example mistaken for runtime code). Often confirmed by `Bugbot Autofix` reply on the same thread. | Reply explaining why; cite a counter-example or the autofix verdict. |
| `wont-fix` | Real but out of scope (would re-open resolved arguments, blocked on upstream change, intentional design choice). | Reply with rationale + link to follow-up issue. Don't auto-close — reviewer decides. |

To check `already-fixed`: read `git log` on the PR branch since the comment's `commit_id` and look for a commit that touches the file at that line.

## Hard requirements

- **Reply on the inline thread**, never a detached PR comment. (`gh api .../pulls/<PR#>/comments/<id>/replies`, not `gh pr comment`.)
- **Reply first, resolve second.** Resolving without a written reply leaves future readers blind.
- **One commit per `real` finding.** Don't bundle. Conventional Commits: `fix(<scope>): address Bugbot finding on <file>:<line>`.
- **Push after each fix; reply with the new commit SHA.** The reply cites the SHA, so the SHA must already be pushed.
- **Propagate canonical fixes.** When the file lives under `.claude/hooks/`, `.claude/skills/`, or `.git-hooks/`, fix at `socket-repo-template/template/` first, then sync to consumers — drifting fleet copies is the larger bug.

## When to use

- **After `gh pr create`** — Bugbot reviews most PRs within ~1 minute.
- **After pushing a Bugbot-related fix** — confirms the new HEAD didn't introduce new findings.
- **Before merging** — sweep open Bugbot threads. CLAUDE.md merge protocol depends on threads being resolved (replied to, not necessarily approved).

## Success criteria

- Every Bugbot finding has a reply on its inline thread.
- Every `real` finding has a corresponding fix commit on the PR branch.
- Every reply that closes the matter (`fixed` / `already-fixed` / `false-positive`) is followed by `resolveReviewThread`. `wont-fix` threads stay open.
- PR title and body match the actual commits.
- PR branch is pushed.
