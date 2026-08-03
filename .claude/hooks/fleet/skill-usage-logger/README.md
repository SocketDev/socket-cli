# skill-usage-logger

PreToolUse hook that logs every `Skill` tool invocation to a per-project
usage log. Aggregated by `scripts/audit-skill-usage.mts` to surface which
fleet skills are load-bearing vs. dead weight.

## Why

The Salesforce _how engineering became agentic_ post calls out skill-
reuse telemetry as a direct quality driver: teams that track which
skills get reused across migrations identify high-leverage patterns
(promote them to lint rules / hooks) and dead-weight skills (drop them
before they rot).

The fleet has ~30 skills in `template/.claude/skills/fleet/`. Without
telemetry, the operator can only guess which skills earn their keep.
This hook captures the data.

## What it logs

For every Skill tool call, appends a single line to
`~/.claude/projects/<project>/.skill-usage.log`:

    <ISO-timestamp>\t<skill-name>\t<cwd>

- `ISO-timestamp` — UTC `YYYY-MM-DDTHH:MM:SS.sssZ`
- `skill-name` — the `skill` argument the Skill tool was invoked with
- `cwd` — `process.cwd()` at hook time (proxy for "which repo")

Tab-separated so `audit-skill-usage.mts` can `split('\t')` without
worrying about embedded spaces or commas. Newline at end.

## What it does NOT do

- Block — fails open on every error path. Never costs the user a
  Skill call.
- Phone home — the log file lives on local disk only. The aggregator
  surveys the same disk.
- Capture arguments — only the skill name is recorded. Per-call args
  may contain user content; out of scope for usage telemetry.

## Bypass

None — the hook is read-only telemetry. If you want to disable it
in a specific session, `unset SOCKET_SKILL_USAGE_LOG` (it defaults
to the canonical path; setting it empty disables the write).

## Failure modes

- HOME unset → no log file path → skip silently.
- Log file not writable → skip silently.
- Payload not parseable → skip silently.
- Tool isn't `Skill` → skip silently (no fast path needed; the no-op
  is cheap enough).

All exit code 0. The hook is invisible when working; the audit script
is the consumer.

## Aggregation

`scripts/audit-skill-usage.mts` reads every
`~/.claude/projects/*/.skill-usage.log`, groups by skill name, emits
a histogram + per-skill freshness (last-seen date). Skills with zero
invocations in the last 30 days are candidates for removal per
CLAUDE.md _Compound lessons_ — if nobody uses it, it isn't earning
its CLAUDE.md cite.
