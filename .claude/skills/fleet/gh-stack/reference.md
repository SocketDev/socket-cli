# gh-stack command and recovery reference

Read this file when creating a stack, changing a middle layer, recovering from
an error, or drafting preview feedback. The extension is evolving; prefer
`gh stack <command> --help` when installed behavior differs from this reference.

## Mental model

```text
main
└── data-model       PR base: main
    └── api          PR base: data-model
        └── ui       PR base: api
```

The bottom is closest to trunk. The top is furthest away. `up` moves away from
trunk; `down` moves toward it. A change needed by multiple layers belongs in the
lowest layer that owns that concern.

## Non-interactive command table

<details>
<summary><b>Agent-safe command table</b>: init, add, view, submit, push, sync, prune, rebase and its continue/abort, navigation, checkout, link, unstack, feedback</summary>

| Goal | Agent-safe command |
| --- | --- |
| Create a stack's bottom layer | `gh stack init --base <trunk> <bottom>` |
| Adopt existing branches | `gh stack init --base <trunk> <bottom> ... <top>` |
| Add a top layer | `gh stack add <branch>` |
| Inspect state | `gh stack view --json` |
| Create or update PRs | `gh stack submit --auto --remote <remote>` |
| Push without creating PRs | `gh stack push --remote <remote>` |
| Fetch, rebase, push, and sync | `gh stack sync --remote <remote>` |
| Prune merged local branches | `gh stack sync --prune --remote <remote>` |
| Rebase all layers | `gh stack rebase --remote <remote>` |
| Rebase current layer upward | `gh stack rebase --upstack --remote <remote>` |
| Continue a conflict | `gh stack rebase --continue` |
| Abort a conflict | `gh stack rebase --abort` |
| Navigate | `gh stack up`, `down`, `top`, `bottom`, or `trunk` |
| Check out known state | `gh stack checkout <branch-or-pr-number>` |
| Link existing branches or PRs | `gh stack link --base <trunk> --remote <remote> <bottom> ... <top>` |
| Remove local tracking only | `gh stack unstack --local` |
| Open the feedback form | `gh stack feedback "<title>"` |

</details>

Never run these agent-side because they open a prompt or TUI:

- `gh stack modify`
- `gh stack switch`
- `gh stack view` without `--json`
- `gh stack checkout` without an argument
- `gh stack submit` without `--auto`
- `gh stack init` or `gh stack add` without explicit branch names

`gh stack unstack` without `--local` also changes GitHub state. Use it only
after showing the effect and receiving explicit approval.

## Create a stack

<details>
<summary><b>Full create sequence</b>: status and remote checks, <code>gh stack init</code>, then a commit per layer before <code>gh stack add</code> creates the next, ending in <code>submit --auto</code> and <code>view --json</code></summary>

```bash
git status --short --branch
git remote -v
gh stack init --base main data-model

# Build and commit the foundation first.
git add packages/example/src/model.ts packages/example/test/model.test.ts
git commit -m "feat(example): add the data model"

# Only then create the dependent API layer.
gh stack add api
git add packages/example/src/api.ts packages/example/test/api.test.ts
git commit -m "feat(example): add the API layer"

# Add the UI after its API dependency is committed.
gh stack add ui
git add packages/example/src/ui.ts packages/example/test/ui.test.ts
git commit -m "feat(example): add the UI layer"

gh stack submit --auto --remote origin
gh stack view --json
```

</details>

Pass multiple branches to `init` only when adopting an existing, already
ordered branch chain. For new work, create and commit one layer before adding
the next so each child starts from the correct parent tip.

Before `submit`, verify that each branch contains only its intended delta:

```bash
git log --oneline --decorate --graph --all
git diff <parent-branch>...<layer-branch> --stat
```

New PRs are drafts unless `--open` is supplied. Use `--open` only when the user
wants every submitted layer ready for review.

## Change a middle layer

```bash
gh stack checkout api

# Edit, test, and stage only the API concern.
git add packages/example/src/api.ts packages/example/test/api.test.ts
git commit -m "fix(example): validate API input"

gh stack rebase --upstack --remote origin
gh stack submit --auto --remote origin
gh stack view --json
```

Do not put the API fix on the UI branch merely because that branch was already
checked out. It would pollute the UI PR and leave the API PR incomplete.

## Sync and prune

Use `gh stack sync --remote origin` for routine synchronization. It fetches,
fast-forwards trunk, cascade-rebases layers, pushes branches atomically, and
reconciles PR state.

Use `--prune` only after checking that merged branches have no uncommitted or
unpushed work. A successful command can still report `Sync aborted` when local
and remote stack structures diverge; treat that message as a failure requiring
human direction.

## Conflict recovery

For exit code 3:

```bash
git status --short
rg -n '^(<<<<<<<|=======|>>>>>>>)' <reported-files>

# Resolve the files, then stage only those files.
git add <resolved-files>
gh stack rebase --continue
```

Repeat if another layer conflicts. If ownership or intent is unclear:

```bash
gh stack rebase --abort
```

Confirm that every branch returned to its pre-rebase SHA. Do not use a bare
force-push as conflict recovery.

## Exit codes

| Code | Meaning | Response |
| --- | --- | --- |
| 0 | Command completed | Inspect output and JSON state before continuing. |
| 1 | Generic Git or push failure | Read stderr; preserve the working tree. |
| 2 | Not in a stack or object not found | Inspect state; initialize only if intended. |
| 3 | Rebase conflict | Resolve and continue, or abort. |
| 4 | GitHub API failure | Check authentication and retry once. |
| 5 | Invalid arguments or stack position | Correct the invocation or navigate to the top. |
| 6 | Branch belongs to multiple stacks | Check out an unambiguous branch. |
| 7 | Rebase already in progress | Continue or abort the existing rebase. |
| 8 | Stack state is locked | Ensure no other gh-stack process is active, then retry. |
| 9 | Stacked PRs unavailable | Stop; the repository is not enabled for the preview. |

## Preview feedback template

<details>
<summary><b>Report skeleton</b>: Summary, Expected, Actual, Reproduction, Environment, Recovery, with credentials never pasted in</summary>

```markdown
## Summary

One sentence describing the gh-stack behavior that blocked or surprised us.

## Expected

What should have happened.

## Actual

What happened, including the exact sanitized error and exit code.

## Reproduction

1. Repository shape and stack order using generic branch names.
2. Exact commands in order.
3. The smallest input needed to reproduce.

## Environment

- OS:
- Git:
- GitHub CLI:
- gh-stack:
- Authentication method: keyring (never include credentials)

## Recovery

Whether abort/continue restored the stack and any state that remained changed.
```

</details>

Search and post in GitHub's
[gh-stack discussions](https://github.com/github/gh-stack/discussions), using
the Feedback category for bugs or workflow problems and Q&A for usage questions.
The built-in `gh stack feedback "<title>"` command opens that feedback flow.

## Current product boundaries

- Stacks are linear; one branch cannot have multiple child layers in one stack.
- The target repository must be enrolled in the private preview.
- `submit --auto` derives PR text from commits and branch names. Edit PR text
  afterward when a clearer public explanation is needed.
- Merging a stack is a GitHub UI operation; do not invent a CLI merge flow.
- Concurrent worktrees can contend over branches and remote stack state. Keep
  one operator and one dedicated checkout per stack.

Primary references:

- [GitHub Stacked PRs](https://github.github.com/gh-stack/)
- [CLI command reference](https://github.github.com/gh-stack/reference/cli/)
- [Feedback discussions](https://github.com/github/gh-stack/discussions/categories/feedback)
