# drift-check-reminder

Stop hook that nudges when an assistant turn edits a fleet-canonical surface (CLAUDE.md, hooks/, external-tools.json, .github/actions/, lockstep.json, cache-versions.json, .gitmodules) without mentioning a cascade / drift check / sync.

## Why

Fleet repos drift fast when one repo bumps a shared resource and the others aren't updated. CLAUDE.md's "Drift watch" rule requires: edit in repo A, reconcile in repos B/C/D in the same PR or open a `chore(sync): cascade …` follow-up.

## What it catches

Assistant turn that:

1. Mentions a drift surface — `external-tools.json`, `template/CLAUDE.md`, `template/.claude/hooks/`, `.github/actions/`, `lockstep.json`, `setup-and-install`, `cache-versions.json`, `.gitmodules`.
2. AND uses an edit verb (`updated`, `edited`, `bumped`, `added`, `removed`, `landed`, etc.).
3. AND does NOT mention `cascade` / `sync` / `drift` / `fleet` / `other repos` / `downstream` / `chore(sync)` / `re-cascade`.

## Bypass

- `SOCKET_DRIFT_CHECK_REMINDER_DISABLED=1` — turn off entirely.

## Test

```sh
pnpm test
```
