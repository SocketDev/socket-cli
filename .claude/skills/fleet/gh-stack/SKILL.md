---
name: gh-stack
description: Runs gh stack for dependent PRs and preview feedback.
user-invocable: true
allowed-tools: AskUserQuestion, Bash(gh:*), Bash(git:*), Read
model: sonnet
context: fork
---

# gh-stack

Use GitHub's private-preview Stacked PRs feature to split one change into a
linear chain of focused pull requests. Each branch is one review layer and
targets the branch directly below it; the bottom branch targets trunk.

Keep one stack in one dedicated checkout. Branches and remote stack state can
collide across worktrees, so never operate on the same stack concurrently.

## 1. Pass the preflight

Run every command and stop on the first failure:

```bash
git --version
gh --version
gh auth status
gh stack --version
```

Require:

- Git **2.20 or later**.
- GitHub CLI (`gh`) **2.0 or later**.
- An active, authenticated GitHub account. Fleet machines must report keyring
  storage; never move a token into an environment variable or command line.
- The `github/gh-stack` extension at the version pinned by
  `external-tools.json`. If missing or stale, install the pin with
  `gh extension install github/gh-stack --force --pin v<VERSION>`.
- Stacked PRs enabled for the target repository. This is a private-preview
  feature; exit code 9 means it is unavailable, so stop rather than falling
  back to ordinary PRs without the user's direction.

Before initializing a stack, make conflict handling non-interactive:

```bash
git config rerere.enabled true
```

Read [`reference.md`](reference.md) before the first stack operation in a
session. Re-check `gh stack <command> --help` before using a destructive or
unfamiliar command because the extension is still in preview.

## 2. Design the stack before editing

Write the branch chain from trunk to top. Put foundations low and dependents
high:

```text
main -> data-model -> api -> ui -> integration-tests
```

Each layer must be independently reviewable, have one concern, and pass its
relevant checks. Use a separate stack for unrelated work. Confirm the intended
trunk, remote, branch names, and layer boundaries before creating branches.

## 3. Use only non-interactive commands

Supply every argument that avoids a prompt or TUI:

```bash
gh stack init --base main data-model
# Commit the data-model layer, then add and commit each dependent layer.
gh stack add api
gh stack add ui
gh stack view --json
gh stack submit --auto --remote origin
```

Rules:

- Pass explicit branch names to `init`, `add`, and `checkout`.
- Use surgical `git add <paths>` plus normal `git commit`; never default to
  `gh stack add -A` or a repository-wide stage.
- Pass `--auto` to `submit` and `--remote <name>` when remote choice is not
  unambiguous.
- Never invoke interactive `modify`, `switch`, bare `view`, bare `checkout`, or
  a prompt-producing form of `submit` from an agent session.
- Immediately before `submit`, show and confirm the stack order, base branch,
  remote, and PR readiness. PR creation and pushes are public mutations.
- Verify every mutation with `gh stack view --json` and the repo's relevant
  checks. Do not infer success from exit code alone when output says a sync was
  aborted.

## 4. Update the correct layer

When review feedback belongs in a lower layer:

1. Navigate down or check out that branch explicitly.
2. Make and commit the smallest cohesive change there.
3. Run `gh stack rebase --upstack` so every dependent layer receives it.
4. Re-run affected checks, then `gh stack push --remote origin` or
   `gh stack submit --auto --remote origin`.
5. Verify the JSON view.

On a rebase conflict, resolve only the reported files, stage them surgically,
then run `gh stack rebase --continue`. If intent is unclear, run
`gh stack rebase --abort` and report the blocker. Never replace this recovery
with an ad hoc force-push.

## 5. Report private-preview problems well

Treat a repeatable gh-stack defect as useful preview feedback:

1. Check `gh stack <command> --help` and reproduce once with the smallest safe
   stack. Record the exact command, exit code, expected behavior, actual
   behavior, and recovery outcome.
2. Capture `git --version`, `gh --version`, `gh stack --version`, OS, and a
   sanitized `gh stack view --json` when available.
3. Search the [gh-stack discussions](https://github.com/github/gh-stack/discussions)
   and its Feedback category. Add to an existing report when it matches.
4. Draft a compact title and body using the template in `reference.md`. Remove
   private repository names, branch names, URLs, tokens, customer data, commit
   contents, and unrelated logs.
5. Show the exact public text and obtain explicit approval before posting.
6. After approval, run `gh stack feedback "<title>"` to open GitHub's feedback
   form, or post through an approved GitHub surface. Opening the form does not
   submit it; confirm the final body and submission state.

Do not silently work around a preview bug and lose the reproduction. Recover
the user's stack first, then preserve a sanitized report.

## Completion criterion

The stack order matches its dependency order; every layer is focused and
verified; local branches, PR bases, and GitHub's stack agree; no command waited
for interactive input; and any reproducible preview defect has a sanitized,
approved feedback draft or discussion link.
