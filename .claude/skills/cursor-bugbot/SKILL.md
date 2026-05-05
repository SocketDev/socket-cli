---
name: cursor-bugbot
description: Drive the Cursor Bugbot review-and-fix loop on a PR. Inventories open Bugbot threads, classifies each (real bug / false positive / already fixed), fixes the real ones, replies on the inline thread (never as a detached PR comment), updates the PR title/body if scope shifted, and pushes. Use when reviewing a PR you just authored, after `gh pr create`, or after a new Bugbot pass on an existing PR.
user-invocable: true
allowed-tools: Read, Edit, Write, Grep, Glob, AskUserQuestion, Bash(gh:*), Bash(git:*), Bash(pnpm run:*), Bash(rg:*), Bash(grep:*)
---

# cursor-bugbot

Drive the Cursor Bugbot fix-and-respond loop end-to-end. This is the canonical flow every PR author should run after Bugbot posts findings.

## Modes

- `/cursor-bugbot <PR#>` — full audit-and-fix on one PR (default).
- `/cursor-bugbot check <PR#>` — list Bugbot findings, classify them, but don't fix or reply.
- `/cursor-bugbot reply <comment-id> <state>` — single-comment reply where `<state>` is `fixed`, `false-positive`, or `wont-fix`.
- `/cursor-bugbot scope <PR#>` — re-evaluate the PR title and body against the actual commits and rewrite them when out of step.

## Why a skill

Cursor Bugbot's review surface is easy to mis-handle:

- **Replies must thread on the inline review-comment**, not as a detached PR comment. A detached `gh pr comment` doesn't mark the thread resolved and the bot doesn't see it as a response. The right call is `gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies -X POST -f body=…`.
- **Findings stale after fixes land.** Bugbot reviews a specific commit SHA. When you push a fix, the comment still references the old commit; the thread stays open until you reply marking it resolved.
- **Stale findings vs. live bugs vs. false positives** all read the same on the API surface. Triaging needs a process, not vibes.
- **Scope creep on PRs**. CLAUDE.md mandates "When adding commits to an OPEN PR, update the PR title and description to match the new scope." Easy to forget when you're heads-down fixing Bugbot findings.

This skill makes all of the above mechanical.

## Process

### Phase 1 — Inventory

```bash
gh api "repos/{owner}/{repo}/pulls/<PR#>/comments" \
  --jq '.[] | select(.user.login | test("cursor|bugbot"; "i")) | {id, path, line, body: (.body | split("\n")[0])}'
```

Lists Bugbot findings as one-liners. Each finding has:

- `id` — comment ID (used for replies and resolution)
- `path` — file the finding is on
- `line` — line number on that file
- `body` — first line is the title (`### Title`)
- `body` (full) — `Description` block, severity (Low/Medium/High), and rule (when triggered by a learned rule)

For each finding, fetch the full body to read the description:

```bash
gh api "repos/{owner}/{repo}/pulls/comments/<id>" \
  --jq '{path, line, body: (.body | split("<!-- BUGBOT")[0])}'
```

The `<!-- BUGBOT` marker separates the human-readable finding from the bot's metadata. Strip everything after it for clean reading.

### Phase 2 — Classify

Sort each finding into one of four buckets:

| Bucket | Meaning | Action |
|---|---|---|
| **real** | Live bug; reproducible against current PR HEAD. | Fix the code, push, reply with the fix commit SHA. |
| **already-fixed** | Bugbot reviewed an old commit; the bug was fixed by a later commit on the same PR. | Reply with the fix commit SHA referencing the existing fix. No new code change. |
| **false-positive** | Bugbot misread the code. Common patterns: hash length miscount, regex backtracking false-flag, JSDoc-example mistaken for runtime code. Often confirmed by a `Bugbot Autofix` reply on the same thread saying "false positive." | Reply explaining why it's a false positive. Cite a counter-example or the autofix verdict. |
| **wont-fix** | Real but out of scope (would re-open already-resolved arguments, blocked on upstream change, intentional design choice the PR makes). | Reply with the rationale and link to a follow-up issue if applicable. Do not auto-close the thread; reviewer decides. |

To check `already-fixed`: read `git log` on the PR branch since the comment's `commit_id` and look for a commit that touches the file at that line.

### Phase 3 — Fix the real ones

For each `real` finding:

1. Read the file at the indicated line.
2. Implement the fix.
3. **Propagate to canonical** when the file lives under `.claude/hooks/`, `.claude/skills/`, or `.git-hooks/` — the same file probably exists in `socket-repo-template/template/` and 8+ other fleet repos. Fix it once at canonical, then sync to all consumers. (See `.claude/skills/_shared/canonical-sync.md` for the standard sync pattern.)
4. Stage + commit the fix with a message that names the finding (e.g., `fix(hooks): address Cursor Bugbot finding on scanSocketApiKeys lineNumber`).
5. Note the new commit SHA — the reply needs it.

### Phase 4 — Reply on each thread

**Critical**: replies go on the inline review-comment thread, not as a detached PR comment. The CLI form:

```bash
gh api "repos/{owner}/{repo}/pulls/<PR#>/comments/<comment-id>/replies" \
  -X POST -f body="…"
```

Reply templates:

- **Real, fixed**: `Fixed in <commit-sha>. <one-sentence what changed>. <propagation note if any>.`
  - Example: `Fixed in a63d29105. Restored the Linear team-key + linear.app URL blocking from the deleted .sh hook as scanLinearRefs() in _helpers.mts. Synced from canonical socket-repo-template.`

- **Already fixed**: `Already fixed in <commit-sha> (current PR HEAD). <one-sentence what changed>.`

- **False positive**: `False positive — <one-sentence why>. <evidence: counter-example, Autofix reply ID, etc.>.`
  - Example: `False positive — confirmed by Bugbot Autofix in the sibling thread. The hash is exactly 128 hex chars: \`echo -n '<hash>' | wc -c\` returns 128.`

- **Won't fix**: `Out of scope for this PR — <rationale>. Tracking as <issue/PR ref> if a follow-up is appropriate.`

Keep replies short. Bugbot doesn't read them, but the human reviewer does.

### Phase 5 — Update PR title + body if scope shifted

CLAUDE.md rule: "When adding commits to an OPEN PR, update the PR title and description to match the new scope."

After fixing Bugbot findings the scope often expands:

- Original PR: `chore(hooks): sync .claude/hooks fleet`
- After fixes: now also covers Linear-ref blocker restoration, errorMessage helper adoption, scanSocketApiKeys lineNumber bug, async safeDelete migration

Re-read the PR commits and rewrite title/body when warranted:

```bash
gh pr view <PR#> --json title,body
gh log origin/main..HEAD --oneline  # what's actually in the PR now
gh pr edit <PR#> --title "…" --body "…"
```

Conventional-commit-style PR titles: `<type>(<scope>): <description>`. When fixes broaden scope, add the new scope to the parens (`chore(hooks, helpers)` instead of `chore(hooks)`).

### Phase 6 — Push

Push the fix commits to the PR branch:

```bash
git push
```

Bugbot will re-review the new HEAD automatically. New findings → loop back to Phase 1. No new findings → the existing threads' resolution status will reflect your replies (Phase 4).

## Constraints

- **Reply on the inline thread**, never a detached PR comment. The hook for this is `gh api .../pulls/<PR#>/comments/<comment-id>/replies`, not `gh pr comment`.
- **Thread the conversation**: when Bugbot Autofix has already responded on a finding (often labeling it false positive or auto-fixing it), reference the sibling reply ID in your response. Reviewers triage threads top-to-bottom; redundant traffic dilutes signal.
- **Match the scope of your actions to what was actually requested.** Bugbot findings are advisory — fix the real ones, reject the false positives, don't be afraid to push back. "Bugbot says X" is not a mandate to do X.
- **Propagate canonical fixes.** When a Bugbot finding is on a file that's synced fleet-wide (hooks, skills, helpers), fix the canonical at `socket-repo-template/template/` first, then sync to all consumers in the same logical change. Drifting fleet copies is the larger bug.

## When to use

- **After `gh pr create`** — Bugbot reviews most PRs within ~1 minute of creation.
- **After pushing a Bugbot-related fix** — re-running the skill confirms the new HEAD didn't introduce new findings and lets you reply to the resolved threads.
- **Before merging** — sweep open Bugbot threads as a final gate. The CLAUDE.md merge protocol depends on Bugbot threads being resolved (replied to, not necessarily approved).

## Success criteria

- Every Bugbot finding on the PR has a reply on its inline thread.
- Every `real` finding has a corresponding fix commit on the PR branch.
- The PR title and body match the actual commits.
- The PR branch is pushed.

## Anti-patterns

- ❌ Replying via `gh pr comment` (detached). Doesn't thread, doesn't notify the reviewer.
- ❌ Force-rewriting a Bugbot's finding by editing the comment via `--method PATCH`. The bot may re-post.
- ❌ Closing Bugbot threads via the GitHub UI without a written reply. Future you (or the reviewer) won't know what happened.
- ❌ Fixing a Bugbot finding by deleting the offending code without understanding *why* the code was there. Bugbot doesn't know about your domain; the human reviewer does.
- ❌ Treating "Bugbot Autofix determined this is a false positive" as a definitive verdict without checking. The autofix bot is right ~95% of the time but verifying takes 10 seconds.
