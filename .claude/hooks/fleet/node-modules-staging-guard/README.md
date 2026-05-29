# node-modules-staging-guard

PreToolUse Bash hook that blocks `git add -f` / `git add --force` for
paths containing `node_modules/` or `package-lock.json` under
`.claude/hooks/*/` or `.claude/skills/*/`.

## Why

`-f` overrides `.gitignore`. Past incident: an agent ran
`git add -f .claude/hooks/fleet/check-new-deps/node_modules/` to "fix" what
looked like a missing dir in a commit. The directory landed in 6 fleet
repos via cascade. Removing it required either a history rewrite
(`git filter-branch` / `git filter-repo`) + force-push, or living with
the bloat forever. Neither is acceptable.

Each hook + skill ships with a small `package.json` (devDeps only).
Consumers run their own `pnpm install` to materialize `node_modules`.
Committing the dir is never the right answer.

## What it blocks

| Pattern                                                            | Block? |
| ------------------------------------------------------------------ | ------ |
| `git add -f .claude/hooks/foo/node_modules/`                       | yes    |
| `git add --force packages/bar/node_modules/baz`                    | yes    |
| `git add -f .claude/hooks/foo/package-lock.json`                   | yes    |
| `git add -f some-other-gitignored-file`                            | no     |
| `git add .claude/hooks/foo/index.mts` (no `-f`)                    | no     |
| `git add node_modules/...` (no `-f` — gitignore catches it anyway) | no     |

## Bypass

Type the canonical phrase in a new message:

    Allow node-modules-staging bypass

Use sparingly. Legitimate force-stages of node_modules are vanishingly
rare; if you're tempted, you're probably about to do the bad thing.

## Detection

Tokenize the Bash command on whitespace + `&&` / `||` / `;` / `|`,
respect leading env-var assignments (`FOO=bar git add ...`), match
`git add ... -f` / `... --force`, then walk every path argument
checking for `/node_modules/` segments or
`.claude/{hooks,skills}/<name>/package-lock.json`.
