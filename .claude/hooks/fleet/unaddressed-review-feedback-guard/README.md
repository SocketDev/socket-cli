# unaddressed-review-feedback-guard

Stop guard. Blocks ending a turn when this session **opened or pushed** a PR
that still carries a review thread, bot or human, nobody has replied to.

## Why

Responding to review feedback is part of the PR open/review cycle, not an
optional follow-up. Sessions kept leaving bot and human review threads
un-answered and had to be told, turn after turn, to go respond. This makes
skipping the reply a block instead of a default.

It is the **respond** half of the review cycle. Its sibling
`bot-comment-collapse-guard` is the **collapse** half — but that one fires only
*after* the session already resolved threads. This guard fires earlier: the
session drove a PR yet left threads with no reply. The two chain together:
reply here, then resolve + minimize there. The review-bot classifier
(`isBotLogin`) is imported from `bot-comment-collapse-guard`, never forked, so
the two never drift on which logins count as bots.

## What fires it

All of these hold:

1. An **active-work signal** on a PR in this session's Bash calls — a
   `gh pr create`, a `git push`, or a `gh pr comment|review|edit|...`. A
   read-only `gh pr view` of a colleague's PR alone never triggers it.
2. A **concrete PR reference** the session touched — a PR URL, a
   `gh pr <verb> <n> --repo <owner>/<repo>`, or a `repos/<owner>/<repo>/pulls/<n>`
   REST path. A bare number with no resolvable owner/repo is skipped, since the
   live query needs both.
3. That PR's **live** state (`gh api graphql` — `reviewThreads` + `viewer`)
   shows a thread that is unresolved and whose LAST comment is not the
   authenticated operator's.

GitHub is the source of truth, never transcript claims: a thread the operator
already replied to or resolved passes silently. When the operator's login had
the last word, the thread is answered. The block message carries the exact
`addPullRequestReviewThreadReply` command per un-replied thread.

## What passes

- The operator already replied last, or resolved the thread.
- The session only read PRs (no active-work signal).
- gh / network / parse failure on any PR — that PR fails **open** (the guard
  never wedges a turn over GitHub availability).

## Bypass

A person authorizing the skip types, in a recent message:

```
Allow review-feedback bypass
```
