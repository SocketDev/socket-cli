# scan-label-in-commit-guard

`PreToolUse(Bash)` blocker that refuses `git commit` invocations
whose message body contains scan-report-internal labels (`B1`, `M9`,
`H3`, `L4`).

## Why

`/fleet:scanning-quality` and `/fleet:scanning-security` assign scratch-pad IDs
like `B5` ("Blocker #5") or `M9` ("Medium #9") to findings inside a
review session. The label has meaning **only within the report** —
a future reader of `git log` doesn't have the report and cannot
decode "fix B5" or "addresses M9".

The right shape inlines the actual finding text:

```
✗ fix(http-request): B5 download truncation race
✓ fix(http-request/download): settle on fileStream finish, not res end
```

## Detection

Case-sensitive `\b[BMHL]\d+\b` as a standalone word. The hook
extracts the message body from:

- `git commit -m "<msg>"` (single or repeated `-m`)
- `git commit --message=<msg>` / `--message <msg>`
- `git commit -F <file>` / `--file=<file>` / `--file <file>`

`git commit` without `-m`/`-F` opens the editor — those messages are
reviewed by the operator, so the hook doesn't fire.

Fenced code blocks (` ``` `) are stripped before scanning so
labels inside log output / quoted fixtures don't trigger the rule.

## What's not flagged

- Lowercase: `b1`, `m9` are not report labels
- 5+ digit IDs: `B12345` is too long to be a report label
- `GHSA-B1-xyz`-style identifiers (label is part of a larger token)
- Anything inside ` ``` ` fences

## Bypass

Type the canonical phrase verbatim in your next user turn:

```
Allow scan-label-in-commit bypass
```

Use when the label is genuinely meaningful in the message (e.g. citing
a real internal advisory ID that happens to match the shape).
