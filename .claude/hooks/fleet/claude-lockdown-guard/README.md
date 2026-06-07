# claude-lockdown-guard

PreToolUse (Bash) hook. Blocks a shell command that invokes the `claude` CLI or
`codex` in a programmatic / headless way without the required lockdown flags.

## Why

The fleet rule (CLAUDE.md "Programmatic Claude calls",
`.claude/skills/fleet/locking-down-claude/SKILL.md`): a headless
agent that runs Claude or Codex non-interactively must pin down its tools and
permissions, otherwise it can be steered into a destructive or
over-permissioned action. Never `default` permission mode in headless contexts,
never `bypassPermissions`, never a full-access Codex sandbox.

## Triggers

- A headless `claude` call (`-p` / `--print`) that is missing any of
  `--allowedTools`, `--disallowedTools`, or a non-`default` /
  non-`bypassPermissions` `--permission-mode`, or that passes
  `--dangerously-skip-permissions`.
- A `codex exec` call that passes `--dangerously-bypass-approvals-and-sandbox`,
  uses `--sandbox danger-full-access`, or omits `--sandbox` /
  `--ask-for-approval` (`-a`).

Interactive `claude` (no `-p`/`--print`) and bare `codex` (no `exec`) pass.
Ambiguous commands fail open.

## Bypass

- Type `Allow programmatic-claude-lockdown bypass` in a recent message.
