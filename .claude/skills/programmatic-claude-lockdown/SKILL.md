---
name: programmatic-claude-lockdown
description: Reference for locking down programmatic Claude invocations (the `claude` CLI in workflows/scripts, the `@anthropic-ai/claude-agent-sdk` `query()` in code). Loads on demand when writing or reviewing any callsite that runs Claude programmatically. Source: https://code.claude.com/docs/en/agent-sdk/permissions.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Programmatic Claude lockdown

**Rule:** every programmatic Claude callsite sets four flags. Skip any one and a future edit silently widens the surface.

## The four flags

| Layer | SDK option | CLI flag | What it does |
|---|---|---|---|
| Definition | `tools` | `--tools` | Base set the model is told about. Tools not listed are invisible — no `tool_use` block possible. |
| Auto-approve | `allowedTools` | `--allowedTools` | Step 4. Listed tools run without invoking `canUseTool`. |
| Deny | `disallowedTools` | `--disallowedTools` | Step 2. Wins even against `bypassPermissions`. Defense-in-depth. |
| Mode | `permissionMode: 'dontAsk'` | `--permission-mode dontAsk` | Step 3. Unmatched tools denied without falling through to a missing `canUseTool`. |

The official permission flow (1) hooks → (2) deny rules → (3) permission mode → (4) allow rules → (5) `canUseTool`. In `dontAsk` mode step 5 is skipped — denied. The doc states verbatim: *"`allowedTools` and `disallowedTools` ... control whether a tool call is approved, not whether the tool is available."* Availability is `tools`.

## Recipe — read-only agent (audit, classify, summarize)

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'

query({
  prompt: '...',
  options: {
    tools: ['Read', 'Grep', 'Glob'],
    allowedTools: ['Read', 'Grep', 'Glob'],
    disallowedTools: ['Agent', 'Bash', 'Edit', 'NotebookEdit', 'Task', 'WebFetch', 'WebSearch', 'Write'],
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

## Recipe — agent that needs Bash (e.g. `/updating`: pnpm + git + jq)

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

- ❌ `permissionMode: 'default'` in headless contexts — falls through to a missing `canUseTool`. Behavior undefined.
- ❌ `permissionMode: 'bypassPermissions'` / `allowDangerouslySkipPermissions: true`.
- ❌ Omitting `tools` — SDK default is the full claude_code preset.
- ❌ `Agent` / `Task` permitted — sub-agents inherit modes and can escape per-subagent restrictions when the parent is `bypassPermissions`/`acceptEdits`/`auto`.

## Reference implementation

`socket-lib/tools/prim/src/disambiguate.mts` — canonical SDK-form callsite. The file header documents each flag against the eval-flow step it enforces.

`socket-lib/tools/prim/test/disambiguate.test.mts` — source-text guards that fail the build if `BASE_TOOLS` widens, if `tools: BASE_TOOLS` is unwired, if `permissionMode` drifts from `'dontAsk'`, or if `bypassPermissions` / `allowDangerouslySkipPermissions: true` ever appears. Mirror this pattern in any new callsite.

## Existing fleet callsites

- `socket-registry/.github/workflows/weekly-update.yml` — two `claude --print` invocations (run `/updating` skill, fix test failures). Bash recipe above.
- `socket-lib/tools/prim/src/disambiguate.mts` — read-only recipe above (`query()` SDK form).
