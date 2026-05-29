# minify-mcp-output

A **Claude Code PostToolUse hook** that compresses MCP-tool output text
losslessly before it enters Claude's context. Pairs with the wire-level
proxy [`@socketsecurity/token-minifier`](../../packages/socket-token-minifier/)
for built-in tools (Read, Bash, Edit, etc.) — those have no PostToolUse
rewrite channel, so they only benefit from wire-level compression.

## Why this rule

MCP tools (declared via `.mcp.json`) can produce verbose output: JSON
arrays, nested objects, long text fields with whitespace and line
prefixes. Stage compression saves tokens **both** on the wire AND in
context (because Claude reads the compressed version going forward).

Built-in tool results don't go through this hook — Claude Code's hook
runtime accepts `updatedMCPToolOutput` only when `tool_name` starts
with `mcp__`. For built-in tools, use the proxy instead.

## Stages (identical to socket-token-minifier)

| Stage         | What it does                                            |
| ------------- | ------------------------------------------------------- |
| `minify`      | `JSON.stringify` without indent on JSON-shaped strings. |
| `strip-lines` | Removes `   42\t` cat -n style line prefixes.           |
| `whitespace`  | Collapses 3+ blank lines to a single blank line.        |

All are deterministic, information-preserving transforms. No semantic
compression, no ML, no Python.

## What's enforced

- Hook fires only on `PostToolUse`.
- Hook activates only when `tool_name` starts with `mcp__`.
- Stages applied to all text content in the MCP `tool_response`,
  including string-shaped responses, `{type:"text", text:"..."}` blocks,
  and arrays thereof.
- Non-text content (images, structured data) passes through unchanged.
- The hook fails **open** on any internal error (exit 0 with no output)
  so a bad deploy can't break tool delivery.

## What's not enforced

- Built-in tools (Read, Bash, Edit, Write, etc.) — Claude Code's
  runtime does not accept `updatedMCPToolOutput` for them. Use the
  proxy for wire-level compression.

## Wiring

In `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__.*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/fleet/minify-mcp-output/index.mts"
          }
        ]
      }
    ]
  }
}
```

The matcher `mcp__.*` is a belt-and-suspenders narrowing — the hook
itself also checks `tool_name` startsWith `mcp__` and exits 0 if it
doesn't match.

## Cross-fleet sync

This hook lives in
[`socket-wheelhouse`](https://github.com/SocketDev/socket-wheelhouse/tree/main/template/.claude/hooks/minify-mcp-output)
and is required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.

The compression-stage logic is intentionally **inlined** here rather
than imported from `packages/socket-token-minifier/` — that package
lives only in wheelhouse, while this hook cascades fleet-wide.
Inlining keeps the dependency-resolution graph trivial for downstream
repos.
