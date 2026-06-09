# Multi-agent backends

Shared policy for skills that delegate work to multiple AI CLIs (codex, claude, opencode, kimi, …). Any skill that calls out to another agent should follow this contract so the user gets a uniform experience across skills.

> Looking for _when_ to hand work off to another agent (CLI subprocess vs. mid-conversation `Agent(subagent_type=…)`)? See [`docs/references/agent-delegation.md`](../../../docs/references/agent-delegation.md). This file covers the _how_ for the CLI-subprocess path.

## Goals

- **Graceful detection.** Skills don't hard-fail when a preferred backend isn't installed. They fall back through a documented preference order, then skip the pass with a recorded note if nothing usable is available.
- **Consistent attribution.** When a backend produces output, the skill labels the section / report / commit message with the backend name (`Codex Verification`, not just `Verification`) so the reader knows which model said what.
- **No silent provider routing.** Hybrid backends like `opencode` (which dispatch to other providers internally per their own config) are only used when **explicitly** selected, never auto-picked. Direct backends (codex, claude, kimi) are preferred so model attribution stays accurate.

## Backend registry

| Backend  | CLI binary | Hybrid? | Default role preference                              |
| -------- | ---------- | ------- | ---------------------------------------------------- |
| codex    | `codex`    | no      | discovery, discovery-secondary, remediation          |
| claude   | `claude`   | no      | verify                                               |
| kimi     | `kimi`     | no      | any role (fallback)                                  |
| opencode | `opencode` | **yes** | only when `--pass <role>=opencode` explicitly chosen |

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

| Var               | Default       | Purpose                                          |
| ----------------- | ------------- | ------------------------------------------------ |
| `CLAUDE_EFFORT`   | `high`        | Claude reasoning effort (claude `--effort`)      |
| `CLAUDE_MODEL`    | `opus`        | Claude model when claude is the active backend   |
| `CODEX_MODEL`     | `gpt-5.4`     | Codex model when codex is the active backend     |
| `CODEX_REASONING` | `xhigh`       | Codex reasoning effort                           |
| `KIMI_MODEL`      | `kimi-latest` | Kimi model when kimi is the active backend       |
| `OPENCODE_MODEL`  | (opencode config) | `provider/model` slug opencode routes to (Fireworks / Synthetic / …) |

Pair model with effort, never just model: a cheap model left on the session's default effort still burns reasoning tokens, and a premium model on `low` underthinks. Both codex (`CODEX_REASONING`) and claude (`CLAUDE_EFFORT`) carry an effort knob — set both axes when a backend supports it. Kimi has no effort flag, so it inherits its CLI default.

Don't invent per-skill env var names — reuse these. Skills that need a non-default model for a specific run accept a `--model` flag rather than introducing new env vars.

## Effort-capability matrix

Reasoning effort is NOT one flat vocabulary across backends — only map an effort onto a backend that actually accepts that level, or you'll pass an invalid value. The lib's `spawnAiAgent` translates the shared `AiEffort` (`@socketsecurity/lib/ai/types`) per-agent; this table is the source of truth for what each accepts.

| Backend  | Effort flag                        | Accepted levels                       | `max` handling          |
| -------- | ---------------------------------- | ------------------------------------- | ----------------------- |
| claude   | `--effort <level>`                 | low / medium / high / xhigh / max     | passes through          |
| codex    | `-c model_reasoning_effort=<level>`| minimal / low / medium / high / xhigh | clamped to `xhigh`      |
| gemini   | (none)                             | —                                     | ignored                 |
| kimi     | (none)                             | —                                     | ignored                 |
| opencode | (none — provider-internal)         | —                                     | ignored                 |

`AiEffort` = `low | medium | high | xhigh | max`. `minimal` is codex-only and outside `AiEffort`; `max` is claude-only, so `buildArgs` clamps it to codex's `xhigh` ceiling. A backend with no effort flag silently ignores the value — never gate behavior on a backend honoring effort it doesn't support. When you hand-roll a backend runner (not via `spawnAiAgent`), pick the effort default from this table's vocab for that backend, not a flat constant.

## Reaching Fireworks / Synthetic / other providers (via opencode)

Fireworks (`api.fireworks.ai/inference/v1`) and Synthetic (`api.synthetic.new/openai/v1`) are OpenAI-compatible HTTP endpoints, not standalone CLIs. The fleet reaches them two ways:

1. **Through `opencode`** (the hybrid backend). Set `OPENCODE_MODEL` to a `provider/model` slug and the opencode runner passes `--model <slug>`. opencode owns the provider auth + base-URL config; the slug just picks the model. This is the path that matches the local OpenCode setup.
2. **Directly from Node** via `@socketsecurity/lib/ai/spawn`'s HTTP backends (`fireworks` / `synthetic`) — for scripts/hooks that call a model programmatically without an interactive CLI. Same OpenAI-compatible wire format; the lib owns the base URL + `Authorization` header (token from env, never inline) + the `reasoning_effort` field.

**Provider/model slug catalog** (the shapes opencode + the lib accept):

| Provider     | Slug shape                                              | Notable models                                  |
| ------------ | ------------------------------------------------------- | ----------------------------------------------- |
| anthropic    | `anthropic/<model>`                                     | `claude-opus-4-8`, `claude-haiku-4-5`           |
| fireworks-ai | `fireworks-ai/accounts/fireworks/models/<id>`           | `glm-5p1` (Opus/Sonnet stand-in), `deepseek-v3p2` |
| synthetic    | `synthetic/hf:<org>/<model>`                            | `hf:moonshotai/Kimi-K2.5` (text/vision/UI), `hf:zai-org/GLM-5.1` |
| moonshotai   | `moonshotai/<model>` (or the `kimi` direct CLI)         | `Kimi-K2.5`, `Kimi-K2-Thinking`                 |

Model choice by job (the local convention): GLM-5.1 is a fast Opus/Sonnet stand-in for plan execution; Kimi K2.5 fits text/vision, UI work, and lower-complexity tasks; reserve Anthropic for planning + deep reasoning. Reasoning effort on the HTTP providers is per-model (the OpenAI `reasoning_effort` field where the model supports it) — only set it for a model that accepts it.

Tokens for these providers live in env / the keychain (`FIREWORKS_API_KEY`, `SYNTHETIC_API_KEY`), never inline — same token-hygiene rule as `SOCKET_API_KEY`.

## Canonical implementation

`.claude/skills/reviewing-code/run.mts` is the reference implementation. New skills that need multi-agent delegation should import the same registry shape and detection function (or copy the small block until extraction is worth doing) — don't roll a parallel pattern.

## When NOT to use

- Skills that only need _one_ agent (the current Claude session driving the user). No detection needed; just do the work.
- Skills that need a specific model unconditionally (e.g. a benchmark that compares two models — those use direct API calls, not the CLI registry).
- Per-repo fix scripts that rely on a single tool (`pnpm`, `git`, `cargo`). Tooling, not agents.
