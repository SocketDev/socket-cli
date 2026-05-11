# `.claude/hooks/_shared/`

Helper modules shared across multiple hooks under `.claude/hooks/`. **Not a deployable hook** — has no `index.mts` entry point and no Claude Code hook lifecycle wiring.

## What lives here

- **`bash-quote-mask.mts`** — Parses a Bash command string and reports the byte ranges that sit inside single-quoted, double-quoted, or heredoc bodies. Used by `no-experimental-strip-types-guard`, `token-guard`, and similar Bash-scanning hooks to skip false positives in literal strings (e.g. `echo "tip: --experimental-strip-types is..."` should not trigger).

## Adding to `_shared/`

A module belongs in `_shared/` when:

1. Two or more hooks under `.claude/hooks/*/index.mts` need the same parsing / matching / IO logic.
2. The logic is self-contained — no Claude Code hook lifecycle (`process.stdin`, exit codes, blocking semantics).
3. Test coverage lives in `_shared/test/` alongside the helper.

If only one hook uses it, keep it inline in that hook's directory. If three or more hooks need it across `.claude/hooks/` AND `.git-hooks/`, escalate it to `_helpers.mts` (the cross-boundary shared module) instead.

## Not a hook

The `audit-claude` script and the sync-scaffolding `every-hook-has-test` check skip `_shared/` because it carries no `index.mts`. Future contributors who add an `index.mts` here are mis-using the directory — the file should live in a sibling `<hook-name>/` directory instead.
