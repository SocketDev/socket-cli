---
name: locking-down-claude
description: Reference for locking down programmatic Claude invocations (the `claude` CLI in workflows/scripts, the `@anthropic-ai/claude-agent-sdk` `query()` in code). Loads on demand when writing or reviewing any callsite that runs Claude programmatically. Source: https://code.claude.com/docs/en/agent-sdk/permissions.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# locking-down-claude

**Rule:** every programmatic Claude callsite sets four flags. Skip any one and a future edit silently widens the surface.

## First: prefer the lib helper — don't hand-roll the flags

🚨 For Node scripts / hooks, use **`spawnAiAgent` from `@socketsecurity/lib-stable/ai/spawn`** with a tier from the `AI_PROFILE` ladder in `@socketsecurity/lib-stable/ai/profiles`. It enforces the four flags at the type level (`SpawnAiAgentOptions` requires `tools` / `disallow` / `permissionMode`), translates them per-agent (claude / codex / gemini / opencode), and owns `--no-session-persistence`, `--add-dir`, and the 529-overload retry. Hand-rolling a `spawn('claude', [...flags])` is how the flag set drifts — and the `prefer-async-spawn` lint rule flags the raw spawn anyway.

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

`AI_PROFILE` is a capability ladder, least → most capable — pick the narrowest tier that works:

- `.read` — scan / classify. Read/Grep/Glob/WebFetch/WebSearch. No Edit/Write/Bash.
- `.edit` — in-place edits only. Read/Edit/Grep/Glob. No Write/MultiEdit/Bash (can't create files).
- `.create` — edit AND create files. Adds Write/MultiEdit. Still no Bash.
- `.full` — `.create` + Bash allowlisted to git/pnpm/node.

Every tier also denies `Agent` (no sub-agent escape). Spread a tier and override per call (`tools`/`disallow` to tighten further, `model`, `addDirs`). The raw SDK/CLI recipes below are the underlying contract — reach for them only when you genuinely can't use the helper (e.g. a workflow-YAML `run:` step with no Node).

## The four flags

| Layer        | SDK option                  | CLI flag                    | What it does                                                                                    |
| ------------ | --------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| Definition   | `tools`                     | `--tools`                   | Base set the model is told about. Tools not listed are invisible. No `tool_use` block possible. |
| Auto-approve | `allowedTools`              | `--allowedTools`            | Step 4. Listed tools run without invoking `canUseTool`.                                         |
| Deny         | `disallowedTools`           | `--disallowedTools`         | Step 2. Wins even against `bypassPermissions`. Defense-in-depth.                                |
| Mode         | `permissionMode: 'dontAsk'` | `--permission-mode dontAsk` | Step 3. Unmatched tools denied without falling through to a missing `canUseTool`.               |

The official permission flow (1) hooks → (2) deny rules → (3) permission mode → (4) allow rules → (5) `canUseTool`. In `dontAsk` mode step 5 is skipped (denied). The doc states verbatim: _"`allowedTools` and `disallowedTools` ... control whether a tool call is approved, not whether the tool is available."_ Availability is `tools`.

## Recipe: read-only agent (audit, classify, summarize)

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'

query({
  prompt: '...',
  options: {
    tools: ['Read', 'Grep', 'Glob'],
    allowedTools: ['Read', 'Grep', 'Glob'],
    disallowedTools: [
      'Agent',
      'Bash',
      'Edit',
      'NotebookEdit',
      'Task',
      'WebFetch',
      'WebSearch',
      'Write',
    ],
    permissionMode: 'dontAsk',
  },
})
```

CLI form for workflow YAML / shell scripts:

```yaml
claude --print \
--tools "Read" "Grep" "Glob" \
--allowedTools "Read" "Grep" "Glob" \
--disallowedTools "Agent" "Bash" "Edit" "NotebookEdit" "Task" "WebFetch" "WebSearch" "Write" \
--permission-mode dontAsk \
--model "$MODEL" \
--max-turns 25 \
"<prompt>"
```

## Recipe: agent that needs Bash (e.g. `/updating`: pnpm + git + jq)

Narrow `Bash(...)` patterns surgically. Block dangerous Bash patterns explicitly. Fleet rules: no `npx`/`pnpm dlx`/`yarn dlx`; no `curl`/`wget` exfil; no destructive `rm -rf`; no `sudo`. Build the deny list as shell vars so the `npx`/`dlx` denials can carry the `# zizmor:` exemption marker (the pre-commit `scanNpxDlx` hook treats those literal strings as the prohibited tools, not as exemptions, unless the line is tagged):

```yaml
DISALLOW_BASE='Agent Task NotebookEdit WebFetch WebSearch Bash(curl:*) Bash(wget:*) Bash(rm -rf*) Bash(sudo:*)'
DISALLOW_PKG_EXEC='Bash(npx:*) Bash(pnpm dlx:*) Bash(yarn dlx:*)'  # zizmor: documentation-prohibition
claude --print \
  --tools "Bash" "Read" "Write" "Edit" "Glob" "Grep" \
  --allowedTools "Bash(pnpm:*)" "Bash(git:*)" "Bash(jq:*)" "Read" "Write" "Edit" "Glob" "Grep" \
  --disallowedTools $DISALLOW_BASE $DISALLOW_PKG_EXEC \
  --permission-mode dontAsk \
  --model "$MODEL" --max-turns 25 \
  "<prompt>"
```

## Never

- ❌ `permissionMode: 'default'` in headless contexts; falls through to a missing `canUseTool`. Behavior undefined.
- ❌ `permissionMode: 'bypassPermissions'` / `allowDangerouslySkipPermissions: true`.
- ❌ Omitting `tools`; SDK default is the full claude_code preset.
- ❌ `Agent` / `Task` permitted; sub-agents inherit modes and can escape per-subagent restrictions when the parent is `bypassPermissions`/`acceptEdits`/`auto`.

## Enforcement

The four-flag lockdown is enforced at edit time by `.claude/hooks/fleet/claude-lockdown-guard/`, which blocks a Write/Edit that introduces a `claude` CLI / `ClaudeSDKClient` spawn missing any of `tools` / `allowedTools` / `disallowedTools` / `permissionMode: 'dontAsk'`, or that sets `default` / `bypassPermissions`. The cost-routing twin `scripts/fleet/check/ai-spawns-have-paired-effort.mts` (in `check --all`) fails when a programmatic AI spawn pins a model without pinning reasoning effort.

## Reference implementation

`socket-lib/tools/prim/src/disambiguate.mts`: canonical SDK-form callsite. The file header documents each flag against the eval-flow step it enforces.

`socket-lib/tools/prim/test/disambiguate.test.mts`: source-text guards that fail the build if `BASE_TOOLS` widens, if `tools: BASE_TOOLS` is unwired, if `permissionMode` drifts from `'dontAsk'`, or if `bypassPermissions` / `allowDangerouslySkipPermissions: true` ever appears. Mirror this pattern in any new callsite.

## Existing fleet callsites

- `scripts/fleet/weekly-update.mts`: the plain (non-gh-aw) weekly runner — drives the deterministic chain, then the optional advisory pass via `spawnAiAgent({ ...AI_PROFILE.full })` (the locked-down four-flag wrapper). The escape-hatch + local-dev entry; gh-aw stays the primary scheduled path.
- `socket-registry/.github/workflows/weekly-update.md`: the gh-aw reusable workflow (`engine: claude`, `max-ai-credits`, network allowlist, safe-output PR). Replaced the legacy `claude --print` reusable; its deterministic check-updates gate calls `weekly-update.mts --check-updates`.
- `socket-lib/tools/prim/src/disambiguate.mts`: read-only recipe above (`query()` SDK form).
