# commit-message-format-guard

PreToolUse hook that blocks `git commit -m <msg>` invocations whose message doesn't follow [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/), or that include AI-attribution markers.

## Why

A `git log` is the canonical history of a repo. Two failure modes pollute it:

1. **Format drift** — free-form titles ("update stuff", "fix typo", "WIP") make CHANGELOG generation impossible and obscure intent.
2. **AI attribution** — "Generated with Claude", `Co-Authored-By: Claude`, robot-emoji tag lines, and `<noreply@anthropic.com>` footers leak the authorship model into history.

The fleet bans both. This hook is the commit-time gate; `commit-pr-reminder` is the Stop-time draft check (defense in depth).

## What it catches

Block examples:

- `git commit -m "update stuff"` — no type, blocked.
- `git commit -m "feat:"` — empty description, blocked.
- `git commit -m "FEAT: parser"` — uppercase type, blocked.
- `git commit -m "feature(parser): X"` — `feature` not in the allowed list, blocked.
- `git commit -m "fix: bug

  Co-Authored-By: Claude"` — AI-attribution footer, blocked.

- `git commit -m "feat: thing

  🤖 Generated with Claude"` — robot-emoji tag, blocked.

Allow examples:

- `git commit -m "feat(parser): add ability to parse arrays"`
- `git commit -m "fix: array parsing issue when multiple spaces"`
- `git commit -m "chore!: drop support for Node 14"`
- `git commit -m "refactor(api)!: drop legacy /v1 routes"`

## Allowed types

`feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`.

## How to bypass

Per the fleet's `Allow <X> bypass` convention:

- `Allow commit-format bypass` — type/format issue (e.g. bringing in a fixup commit with a pre-existing message).
- `Allow ai-attribution bypass` — for the AI-attribution check specifically. Use sparingly — only when a commit legitimately documents the forbidden strings (e.g. a CLAUDE.md edit that quotes them).

Type the canonical phrase verbatim in a recent user message; the hook then allows the next matching commit.

## How to disable in tests

Set `SOCKET_COMMIT_MESSAGE_FORMAT_GUARD_DISABLED=1` to short-circuit the hook entirely. Used only by the hook's own test suite — never set in operator config.

## Test

```sh
pnpm test
```
