# new-hook-claude-md-guard

**Wheelhouse-only** PreToolUse hook. Blocks `Write` / `Edit` to a hook's `index.mts` unless `template/CLAUDE.md` contains an `(enforced by `.claude/hooks/<name>/`)` reference for that hook.

## Why

Fleet repos read `template/CLAUDE.md` as the source of truth for behavioral rules. A hook without a corresponding CLAUDE.md entry is policy that exists in code but not on paper — users get blocked by a rule they never read.

This hook closes that drift the moment it would land. Without the CLAUDE.md entry, the hook commit is refused.

## What it requires

Adding a new hook (`template/.claude/hooks/my-rule/index.mts`) must be accompanied by an entry in `template/CLAUDE.md`:

```markdown
🚨 Never do bad thing X — explanation here (enforced by `.claude/hooks/my-rule/`).
```

The pattern: **one minimal line, attached to the rule it enforces**, with the parenthetical hook reference in `(enforced by `.claude/hooks/<name>/`)` form. Don't add prose; the hook's README carries the detail.

Accepted variants:
- `` (enforced by `.claude/hooks/my-rule/`) `` — preferred
- `` (enforced by `.claude/hooks/my-rule`) `` — trailing slash optional
- `` enforced by `.claude/hooks/my-rule/` `` — without parens (less common but accepted)

## Why wheelhouse-only

Downstream fleet repos receive their CLAUDE.md and hook code via `sync-scaffolding`. They consume the canonical version; they shouldn't be re-policing the source-of-truth mapping. This hook lives in `template/.claude/hooks/new-hook-claude-md-guard/` but is **NOT** listed in `scripts/sync-scaffolding/manifest.mts`'s `IDENTICAL_FILES`, so the cascade skips it.

## Skipped paths

- `template/.claude/hooks/_shared/...` — helpers, not hooks
- `test/*.test.mts` — test files
- `new-hook-claude-md-guard` itself — chicken-and-egg
- Any hook listed in `WHEELHOUSE_ONLY_HOOKS` in index.mts

## Bypass

For follow-up commits on the same PR where the CLAUDE.md entry lands separately, type any of these in a user message:

- `Allow new-hook bypass`
- `Allow new hook bypass`
- `Allow newhook bypass`

Or set `SOCKET_NEW_HOOK_CLAUDE_MD_GUARD_DISABLED=1` to turn off entirely.

## Test

```sh
pnpm test
```
