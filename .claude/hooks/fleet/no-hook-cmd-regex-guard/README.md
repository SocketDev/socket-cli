# no-hook-cmd-regex-guard

PreToolUse Write/Edit guard that blocks introducing a regex which parses
a shell command into a `.claude/hooks/**` file. Enforces CLAUDE.md's
"prefer AST-based parsing over regex when a Bash-allowlist hook reasons
about command structure".

## Why

Regex over a command line is fragile: it misreads `&&` / `|` / `;`
chains, quoting, and `$(…)` substitution, and false-positives on a
literal like `"git push"` sitting inside a `grep` argument. The fleet's
`_shared/shell-command.mts` parser (shell-quote-backed) handles all of
that. A session that hand-rolls `/\bgit\s+push\b/.test(cmd)` is one
edit away from a guard that's bypassable or over-broad.

## What it flags

A regex literal whose body names a shell binary (`git`, `gh`, `npm`,
`pnpm`, `yarn`, `npx`, `node`, `docker`, `cargo`, `pip`, `uv`,
`taskkill`) adjacent to a whitespace/boundary metachar (`\b`, `\s`,
` +`, `^`, `|`) — the signature of matching a command line:

```
/\bgit\s+push\b/        ✗  → commandsFor(cmd, 'git').some(c => c.args.includes('push'))
/\bgh\s+pr\s+create\b/  ✗  → parse with shell-command.mts
/(?:^|\s)pnpm +run\b/    ✗
```

## What it does NOT flag

- A binary name without a boundary metachar (`/gitignore/` — a path).
- Non-command regexes (version strings, paths, prose).
- Files outside `.claude/hooks/`.
- This guard's own source + tests (they discuss the banned shape).
- The regex genuinely matches tool **stdout**, not a command line —
  bypass with `Allow command-regex bypass`.

## Note

This guard detects a CODE pattern — a regex literal in source — not a
shell command, so it is itself allowed to use regex.

## Cross-fleet sync

Lives in `socket-wheelhouse/template/.claude/hooks/fleet/` and is
byte-identical across every fleet repo. `scripts/sync-scaffolding.mts`
flags drift; `--fix` rewrites it.
