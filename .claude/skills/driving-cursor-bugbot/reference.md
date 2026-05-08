# driving-cursor-bugbot reference

API surface, GraphQL queries, and reply templates for the `driving-cursor-bugbot` skill. The decision flow lives in [`SKILL.md`](SKILL.md).

## Phase 1 — Inventory

List Bugbot findings as one-liners:

```bash
gh api "repos/{owner}/{repo}/pulls/<PR#>/comments" \
  --jq '.[] | select(.user.login | test("cursor|bugbot"; "i")) | {id, path, line, body: (.body | split("\n")[0])}'
```

Each finding has:

- `id` — comment ID (used for replies + resolution).
- `path` — file the finding is on.
- `line` — line number on that file.
- `body` — first line is the title (`### Title`); full body has `Description`, severity (Low / Medium / High), and rule (when triggered by a learned rule).

Fetch the full body for one finding:

```bash
gh api "repos/{owner}/{repo}/pulls/comments/<id>" \
  --jq '{path, line, body: (.body | split("<!-- BUGBOT")[0])}'
```

The `<!-- BUGBOT` marker separates the human-readable finding from the bot's metadata; strip everything after for clean reading.

## Phase 4 — Replying on inline threads

**Critical**: replies go on the inline review-comment thread, not as a detached PR comment.

```bash
gh api "repos/{owner}/{repo}/pulls/<PR#>/comments/<comment-id>/replies" \
  -X POST -f body="…"
```

After replying, **resolve the thread** (the reply alone doesn't auto-resolve — resolution is a GraphQL mutation):

```bash
# Step 1: get the thread node ID (PRRT_…) for a given comment databaseId.
THREAD_ID=$(gh api graphql -f query='
query($pr: Int!, $owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 50) {
        nodes {
          id
          comments(first: 1) { nodes { databaseId } }
        }
      }
    }
  }
}' -f owner=<owner> -f repo=<repo> -F pr=<PR#> \
  --jq ".data.repository.pullRequest.reviewThreads.nodes[] | select(.comments.nodes[0].databaseId == <comment-id>) | .id")

# Step 2: resolve.
gh api graphql -f query='
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { id, isResolved }
  }
}' -f threadId="$THREAD_ID"
```

### When to resolve

- **`real`, fixed** — resolve after the fix commit lands and the reply is posted.
- **`already-fixed`** — resolve immediately after the reply (the fix already exists).
- **`false-positive`** — resolve immediately after the reply, *unless* the verdict is contested by the reviewer.
- **`wont-fix`** — do NOT resolve. The reviewer decides; leave it open as an open question.

## Reply templates

Keep replies short. Bugbot doesn't read them, but the human reviewer does.

- **Real, fixed**: `Fixed in <commit-sha>. <one-sentence what changed>. <propagation note if any>.`
  - Example: `Fixed in a63d29105. Restored the Linear team-key + linear.app URL blocking from the deleted .sh hook as scanLinearRefs() in _helpers.mts. Synced from canonical socket-repo-template.`

- **Already fixed**: `Already fixed in <commit-sha> (current PR HEAD). <one-sentence what changed>.`

- **False positive**: `False positive — <one-sentence why>. <evidence: counter-example, Autofix reply ID, etc.>.`
  - Example: `False positive — confirmed by Bugbot Autofix in the sibling thread. The hash is exactly 128 hex chars: \`echo -n '<hash>' | wc -c\` returns 128.`

- **Won't fix**: `Out of scope for this PR — <rationale>. Tracking as <issue/PR ref> if a follow-up is appropriate.`

## Phase 5 — Title + body realignment

After fixing Bugbot findings, scope often expands:

- Original PR: `chore(hooks): sync .claude/hooks fleet`
- After fixes: also covers Linear-ref blocker restoration, errorMessage helper adoption, scanSocketApiKeys lineNumber bug, async safeDelete migration.

Re-read the PR commits and rewrite title / body when warranted:

```bash
gh pr view <PR#> --json title,body
git log origin/main..HEAD --oneline  # what's actually in the PR now
gh pr edit <PR#> --title "…" --body "…"
```

Conventional-commit-style PR titles: `<type>(<scope>): <description>`. When fixes broaden scope, add the new scope to the parens (`chore(hooks, helpers)` instead of `chore(hooks)`).

## Anti-patterns

- ❌ Replying via `gh pr comment` (detached). Doesn't thread, doesn't notify the reviewer.
- ❌ Force-rewriting a Bugbot's finding by editing the comment via `--method PATCH`. The bot may re-post.
- ❌ Resolving a thread without a written reply. Future you (or the reviewer) won't know what happened. Reply first, resolve second.
- ❌ Closing Bugbot threads via the GitHub UI without a written reply.
- ❌ Fixing a Bugbot finding by deleting the offending code without understanding *why* the code was there. Bugbot doesn't know about your domain; the human reviewer does.
- ❌ Treating "Bugbot Autofix determined this is a false positive" as a definitive verdict without checking. The autofix bot is right ~95% of the time but verifying takes 10 seconds.
