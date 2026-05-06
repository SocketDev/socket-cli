# Multi-agent backends

Shared policy for skills that delegate work to multiple AI CLIs (codex, claude, opencode, kimi, …). Any skill that calls out to another agent should follow this contract so the user gets a uniform experience across skills.

## Goals

- **Graceful detection.** Skills don't hard-fail when a preferred backend isn't installed. They fall back through a documented preference order, then skip the pass with a recorded note if nothing usable is available.
- **Consistent attribution.** When a backend produces output, the skill labels the section / report / commit message with the backend name (`Codex Verification`, not just `Verification`) so the reader knows which model said what.
- **No silent provider routing.** Hybrid backends like `opencode` (which dispatch to other providers internally per their own config) are only used when **explicitly** selected, never auto-picked. Direct backends (codex, claude, kimi) are preferred so model attribution stays accurate.

## Backend registry

| Backend  | CLI binary | Hybrid? | Default role preference                                  |
|----------|------------|---------|----------------------------------------------------------|
| codex    | `codex`    | no      | discovery, discovery-secondary, remediation              |
| claude   | `claude`   | no      | verify                                                   |
| kimi     | `kimi`     | no      | any role (fallback)                                      |
| opencode | `opencode` | **yes** | only when `--pass <role>=opencode` explicitly chosen      |

Adding a new backend = one entry in the registry: `{ name, bin, hybrid, run(promptFile, outFile) -> { argv, outMode } }`. No other call site changes.

## Detection policy

Detect availability via `command -v <bin>` at runtime, never hardcode "claude is always there." A skill that wants Codex but only has Kimi should run on Kimi (fallback), not bail out.

```
For each role:
  preferred = explicit override (--pass role=backend) or first match in role.preferenceOrder
  if preferred is hybrid AND not explicitly selected -> skip preferred, try next
  if preferred is installed -> use it
  if no backend installed for this role -> skip the pass with a note in the output
```

Document skips inline in whatever output the skill produces (`> Skipped pass: <role> — no available backend`) so the reader sees the gap.

## Env-var conventions

| Var | Default | Purpose |
|---|---|---|
| `CODEX_MODEL` | `gpt-5.4` | Codex model when codex is the active backend |
| `CODEX_REASONING` | `xhigh` | Codex reasoning effort |
| `CLAUDE_MODEL` | `opus` | Claude model when claude is the active backend |
| `KIMI_MODEL` | `kimi-latest` | Kimi model when kimi is the active backend |

Don't invent per-skill env var names — reuse these. Skills that need a non-default model for a specific run accept a `--model` flag rather than introducing new env vars.

## Canonical implementation

`.claude/skills/reviewing-code/run.mts` is the reference implementation. New skills that need multi-agent delegation should import the same registry shape and detection function (or copy the small block until extraction is worth doing) — don't roll a parallel pattern.

## When NOT to use

- Skills that only need *one* agent (the current Claude session driving the user). No detection needed; just do the work.
- Skills that need a specific model unconditionally (e.g. a benchmark that compares two models — those use direct API calls, not the CLI registry).
- Per-repo fix scripts that rely on a single tool (`pnpm`, `git`, `cargo`). Tooling, not agents.
