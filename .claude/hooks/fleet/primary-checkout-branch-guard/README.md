# primary-checkout-branch-guard

PreToolUse Bash hook that **blocks** branch creation or switching in the
**primary checkout** — `git checkout/switch <branch>`, `git checkout -b`,
`git switch -c`. Branch work belongs in a `git worktree`.

## Why

Multiple Claude sessions (parallel agents, terminals, worktrees) can share one
`.git/`. Moving HEAD in the primary checkout — cutting a branch or switching to
one — yanks the working tree out from under any sibling session operating in
that same directory. The CLAUDE.md "Parallel Claude sessions" rule already
forbade this, but shipped no enforcer: an agent created a `fix/...` branch in
the primary checkout while two sibling worktree sessions were live. The fix had
to land via cherry-pick. This guard stops the branch from being cut there at
all.

## What it catches

A `git` command, run in the primary checkout, that:

- creates + switches: `git checkout -b|-B <name>`, `git switch -c|-C <name>`
- switches existing: `git switch <name>`, `git checkout <branch>`

## What it allows

- file restore: `git checkout -- <file>`, `git checkout .`
- the same branch ops inside a **linked worktree** (the sanctioned place)
- `git checkout` / `git switch` with no branch argument

Primary-vs-worktree is decided by `git rev-parse --git-dir`: a linked worktree
resolves under `.git/worktrees/<name>`; the primary resolves to the repo's own
`.git`.

## Bypass

Type **`Allow primary-branch bypass`** in a recent message.

## Recipe (the right way)

```bash
git worktree add ../<repo>-<topic> -b <branch>
cd ../<repo>-<topic>
```
