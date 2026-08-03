# claude-code-action-lockdown-guard

`PreToolUse(Edit | Write | MultiEdit)` blocker for `.github/workflows/*.yml`.
Refuses to wire `uses: anthropics/claude-code-action` on an untrusted trigger
without the lockdown that stops a prompt-injected issue/PR from steering the
agent into secret exfiltration.

## Why

The Microsoft Security writeup (2026-06-05) on `claude-code-action` showed the
dangerous shape: a workflow that fires on attacker-controlled content (issue
body, PR comment), holds repo secrets in the runner (`ANTHROPIC_API_KEY` /
`GITHUB_TOKEN`), and gives the agent tools that reach the network. That is the
**Agents Rule of Two** violated on all three legs at once, and a prompt-injected
issue becomes a credential-exfiltration primitive.

## What it requires

When a workflow wires `anthropics/claude-code-action` AND fires on an untrusted
trigger (`issues` / `issue_comment` / `pull_request` / `pull_request_target`),
the file must declare:

1. an explicit `permissions:` block (least-privilege `GITHUB_TOKEN`; the default
   inherited scope is broad — zizmor's `excessive-permissions` catches this at
   CI time, this catches it at edit time), and
2. the agent-surface lockdown `with:` inputs: `allowed_tools` +
   `disallowed_tools` + a non-default `permission_mode` — the same four-flag
   discipline `locking-down-claude` requires for headless `claude`.

A workflow gated only on `push` / `workflow_dispatch` / `schedule` processes no
untrusted input, so it is not blocked (the Rule of Two needs only one leg gated,
and "no untrusted input" is that leg).

## Coverage relative to zizmor + pull-request-target-guard

zizmor's `excessive-permissions` flags the missing `permissions:` block at CI
time. `pull-request-target-guard` flags the privileged-fork-checkout shape. This
hook adds the `claude-code-action`-specific surface: the action + untrusted
trigger + missing agent lockdown, surfaced at edit time before any of those run.

## Bypass

Type `Allow claude-action-lockdown bypass` verbatim in a recent user turn.

The rule lives in [`CLAUDE.md`](../../../CLAUDE.md) under "Prompt-injection +
agent-DoS"; full threat model in
[`docs/agents.md/fleet/prompt-injection.md`](../../../docs/agents.md/fleet/prompt-injection.md).
