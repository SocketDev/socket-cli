# Locking down Claude CLI / SDK spawns

Every workflow, skill, or script that invokes the `claude` CLI or the
`@anthropic-ai/claude-agent-sdk` directly must set four lockdown flags. A
spawn missing any one of them silently widens the surface a future edit can
exploit.

## The four flags

| Layer        | SDK option                  | CLI flag                    | What it does |
| ------------ | ---------------------------- | ---------------------------- | ------------- |
| Definition   | `tools`                       | `--tools`                     | Base set the model is told about. Anything not listed is invisible — no `tool_use` block possible. |
| Auto-approve | `allowedTools`                | `--allowedTools`               | Listed tools run without invoking `canUseTool`. |
| Deny         | `disallowedTools`             | `--disallowedTools`            | Wins even against `bypassPermissions`. Defense in depth. |
| Mode         | `permissionMode: 'dontAsk'`   | `--permission-mode dontAsk`     | Unmatched tools are denied outright instead of falling through to a missing `canUseTool`. |

`permissionMode` must be `dontAsk`, `acceptEdits`, or `plan` — never
`default` (falls through to a missing `canUseTool`, undefined behavior) and
never `bypassPermissions` (skips every check).

## Prefer the lib helper over hand-rolling

For Node scripts and hooks, use `spawnAiAgent` from
`@socketsecurity/lib-stable/ai/spawn` with a tier from the `AI_PROFILE`
ladder (`@socketsecurity/lib-stable/ai/profiles`). It enforces the four
flags at the type level, translates them per-agent (claude / codex / gemini
/ opencode), and owns the retry + session-isolation plumbing a hand-rolled
`spawn('claude', [...])` would have to reimplement:

```ts
import { AI_PROFILE } from '@socketsecurity/lib-stable/ai/profiles'
import { spawnAiAgent } from '@socketsecurity/lib-stable/ai/spawn'

const { exitCode, stdout } = await spawnAiAgent({
  ...AI_PROFILE.read, // or .edit / .create / .full
  prompt: '…',
  cwd: repoRoot,
  timeoutMs: 10 * 60 * 1000,
})
```

`AI_PROFILE` tiers run least to most capable — pick the narrowest one that
works: `.read` (Read/Grep/Glob/WebFetch/WebSearch, no Edit/Write/Bash),
`.edit` (adds Edit, still no Write/Bash), `.create` (adds Write/MultiEdit,
still no Bash), `.full` (adds Bash allowlisted to git/pnpm/node). Every
tier denies `Agent` too, so a spawned agent can't escape through a
sub-agent.

## Why

A tool not in `tools` cannot be requested at all — that is the strongest
guarantee. `allowedTools` / `disallowedTools` only shape which requests get
auto-approved or auto-denied; they say nothing about availability.
`permissionMode: 'default'` leaves the fifth step of the permission chain
(`canUseTool`) to decide, and a headless call typically has none wired up,
so the outcome is undefined rather than denied. Reserving `bypassPermissions`
skips every check, which defeats the point of a lockdown entirely.

## Enforcement

`.claude/hooks/fleet/claude-lockdown-guard/` (PreToolUse, Edit/Write) blocks
introducing a `claude` CLI spawn or `ClaudeSDKClient` call that omits any of
`tools` / `allowedTools` / `disallowedTools` / `permissionMode: 'dontAsk'`,
or that sets `permissionMode` to `default` / `bypassPermissions`. The
cost-routing twin `scripts/fleet/check/ai-spawns-have-paired-effort.mts`
(in `check --all`) fails when a programmatic AI spawn pins a model without
pinning its reasoning effort.

The full recipe set (read-only agent, Bash-capable agent, workflow-YAML
form) lives in `.claude/skills/fleet/locking-down-claude/SKILL.md`.
