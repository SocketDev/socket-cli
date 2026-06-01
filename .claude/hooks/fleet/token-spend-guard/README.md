# token-spend-guard

PreToolUse hook that reminds (non-fatal `exit 2`) when a **known-mechanical** Bash command runs on a **premium model or high reasoning effort**. Enforces the "Token spend: match model + effort to the job" rule.

## What it catches

A command whose shape is unambiguously mechanical — wheelhouse cascade (`pnpm run sync`, `chore(wheelhouse): cascade` commit), whole-tree lint autofix (`oxlint --fix .` / `fix --all`), or format sweep (`oxfmt --write .`) — while:

- the model (read from the transcript's most-recent assistant `model` field) is an Opus, **or**
- `$CLAUDE_EFFORT` is `high` / `xhigh` / `max`.

Each dimension is flagged and bypassed independently. `low`/`medium` effort and Sonnet/Haiku never trigger — they're already the cheap/fast tier.

## Why

Mechanical work is dumb-bit propagation; a cheap/fast model at low/medium effort handles it fine. Spending premium model + high-effort tokens on cascades and autofix sweeps is wasted money. The premium tier is for design, ambiguous debugging, and security review. The trigger set is deliberately narrow so the guard never nags during real work — a false trigger would train reflex-bypassing, which defeats the rule.

## Bypass

- `Allow model bypass` (keep the premium model for this task) — also accepts `Allow model-spend bypass`.
- `Allow effort bypass` (keep high effort for this task).
- `SOCKET_TOKEN_SPEND_GUARD_DISABLED=1` (disable entirely).

## Test

```sh
pnpm test
```
