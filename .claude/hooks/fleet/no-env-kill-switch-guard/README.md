# no-env-kill-switch-guard

Claude Code `PreToolUse` (Edit/Write) hook that blocks adding an environment-variable kill switch to a fleet hook's `index.mts`.

## Why

Hooks are guardrails for AI-generated code. A per-hook `SOCKET_*_DISABLED` env var lets a session silently neuter a hook, which defeats the point and leaves no audit trail. The only sanctioned way to skip a hook is the `Allow <X> bypass` phrase: user-typed, transcript-scoped, auditable.

## What it catches

In a `.claude/hooks/{fleet,repo}/<name>/index.mts`:

| Shape | Example |
| --- | --- |
| `disabledEnvVar` config field | `disabledEnvVar: 'SOCKET_FOO_DISABLED'` |
| `process.env[...]` read of a `*_DISABLED` name | `process.env['SOCKET_FOO_DISABLED']` |
| dot-form read | `process.env.SOCKET_FOO_DISABLED` |
| a disable-by-env helper | `isHookDisabled('foo')` |

## Allowed

- Non-hook files. Only `.claude/hooks/**/index.mts` is policed.
- The documented break-glass env vars that are not hook kill switches (e.g. `SOCKET_PRE_COMMIT_ALLOW_UNSIGNED`, the `FLEET_SYNC` cascade marker). They do not match the `*_DISABLED` shape.
- This guard's own test fixtures.
- Bypass phrase `Allow env-kill-switch bypass` typed verbatim in a recent turn.

## Test

```sh
pnpm test
```
