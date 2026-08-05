# PR care and feeding — the batch pipeline

`scripts/fleet/pr-care/cli.mts` is the deterministic executor for tending a
stack of open PRs: bot-feedback collection and collapse, base updates, commit
squashing, pinned-lease pushes, and CI polling. It encodes the laws below so
they are code, not session memory. Judgment stays out, per
`code-first-then-ai`: the tool never decides whether a bot finding is real,
never writes reply prose, and never resolves a rebase conflict — it reports
those for the operator or an AI pass.

## Subcommands

All take `--repo <owner/name>`; branch surgery also takes `--checkout <dir>`.

- `list` — my open PRs with merge state and bot-comment counts.
- `bots <n>` — bot feedback across all three surfaces (review comments,
  reviews, issue comments), classified `triage` / `duplicate` /
  `human-decision`. Exit 1 when anything needs triage.
- `reply <n> --comment-id <id> --body-file <f>` — post a thread reply. The
  prose is the caller's.
- `collapse <n> --comment-id <id> [--review-node <nid>]` — the FULL collapse
  for a handled finding: resolve the review thread AND minimize the bot's
  top-level review body. A resolved thread with an expanded summary is
  half-done.
- `collapse-duplicates <n>` — minimize staging-twin bot comments as
  DUPLICATE. The only judgment-free collapse.
- `rebase [<n> …]` — base-update every listed (default: all my open) PR by
  LOCAL rebase onto `origin/<base>` plus a pinned-lease push. Conflicts abort
  and report as skips.
- `squash <n>` — collapse the branch to ONE signed commit on
  `origin/<base>`, message = PR title. Prints the pinned-lease push to run.
- `checks [<n> …] [--wait]` — check states per PR; `--wait` polls to
  conclusion on a bounded budget. Exit 1 on any red.

## The laws it encodes

- **Server-side rebase is unreliable.** `gh pr update-branch --rebase` 5xx'd
  across a whole 17-PR batch; the local rebase in a worktree is the path of
  record.
- **Rebase and push never chain.** A rebase can pause on a conflict; anything
  chained after it acts on a half-rebased tree. The pipeline runs them as
  separate steps and aborts on conflict.
- **Force-fetch the tracking ref before computing a lease.** PR branches get
  force-pushed upstream; a stale tracking ref makes `--force-with-lease`
  pin a lie. Every push uses the freshly fetched sha, pinned per branch.
- **Squash commits are signed.** `commit-tree 'HEAD^{tree}' -S -p <base>`
  mints the single commit; `update-ref` moves the branch without touching the
  worktree because the tree is byte-identical.
- **A branch living in a worktree rebases in place.** Everything else cycles
  through one scratch worktree, removed afterward.
- **GraphQL by node id, through an input file.** Repo names never enter the
  command string or the query: resolve the PR node id over REST, then
  `node(id: $id)` queries and id-only mutations via `--input <tempfile>`.
- **Security-bot alerts are never auto-minimized.** License and supply-chain
  Warns carry decisions only a human can make; the sole sanctioned
  auto-collapse is a staging bot duplicating its production twin.
- **Refspecs are built in code.** `$BR:refs/…` in zsh reads `:r` as a history
  modifier and silently mangles the ref; the pipeline never interpolates a
  branch into a shell refspec.
- **Authorization phrases are human-only.** Force pushes and non-fleet pushes
  sit behind guards; the tool runs in the operator's session where the typed
  grants live and never relays or invents one.
