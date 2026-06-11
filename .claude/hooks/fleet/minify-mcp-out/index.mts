#!/usr/bin/env node
// Claude Code PostToolUse hook — minify-mcp-out.
//
// Applies lossless minification stages (minify / strip-lines /
// whitespace) to MCP-tool output text and returns the result via
// `hookSpecificOutput.updatedMCPToolOutput` — the only documented
// rewrite channel for PostToolUse, verified empirically.
//
// Scope:
//   - PostToolUse only.
//   - tool_name starts with `mcp__` (Claude Code's MCP tool naming
//     convention: mcp__<server>__<tool>).
//   - Other tool names (built-in: Read/Bash/Edit/etc.) pass through
//     untouched — those have no PostToolUse rewrite channel; use the
//     wire-level proxy (socket-token-minifier) instead.
//
// The hook fails OPEN on its own errors (exit 0 with no output) so a
// bad deploy can't break tool result delivery.
//
// Stages here are inlined (not imported from packages/socket-token-
// minifier/) because this hook cascades into every fleet repo via
// sync-scaffolding, while packages/socket-token-minifier/ lives only
// in wheelhouse. The stage logic is small enough that inlining is
// cleaner than orchestrating a workspace dependency that downstream
// repos don't have.

import process from 'node:process'

interface Payload {
  hook_event_name?: string | undefined
  tool_name?: string | undefined
  tool_response?: unknown | undefined
  // Plus session_id, cwd, etc. — we don't care.
}

// ---------- Inlined stages (synced with packages/socket-token-minifier/src/stages/) ----------

export function minify(text: string): string {
  const trimmed = text.trimStart()
  if (trimmed.length === 0) {
    return text
  }
  const first = trimmed.charCodeAt(0)
  if (first !== 0x7b && first !== 0x5b) {
    return text
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  return JSON.stringify(parsed)
}

const LINE_PREFIX_RE = /^[ \t]*\d+\t/gm
export function stripLines(text: string): string {
  return text.replace(LINE_PREFIX_RE, '')
}

const BLANK_RUN_RE = /\n(?:[ \t]*\n){2,}/g
export function whitespace(text: string): string {
  return text.replace(BLANK_RUN_RE, '\n\n')
}

export function applyStages(text: string): string {
  return whitespace(stripLines(minify(text)))
}

// ---------- Tool-response walker ----------

/**
 * Walk an MCP tool_response value and compress text content in place. Returns
 * the same structure with strings minified. Non-text content (images,
 * structured data we don't recognize) passes through unchanged.
 *
 * Shapes we handle:
 *
 * - String → minified string.
 * - { type: "text", text: string } → minified text.
 * - { content: <recurse> }
 * - { type: "text", text: string }[] (typical MCP shape).
 * - Other → passes through.
 */
export function compressMCPOutput(value: unknown): unknown {
  if (typeof value === 'string') {
    return applyStages(value)
  }
  if (Array.isArray(value)) {
    return value.map(compressMCPOutput)
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = { ...obj }
    if (typeof obj['text'] === 'string') {
      out['text'] = applyStages(obj['text'])
    }
    if (obj['content'] !== undefined) {
      out['content'] = compressMCPOutput(obj['content'])
    }
    return out
  }
  return value
}

// ---------- Hook IO ----------

export function isMCPToolName(name: string | undefined): boolean {
  return typeof name === 'string' && name.startsWith('mcp__')
}

function main() {
  let stdin = ''
  process.stdin.on('data', chunk => {
    stdin += chunk
  })
  process.stdin.on('end', () => {
    try {
      let payload: Payload
      try {
        payload = JSON.parse(stdin) as Payload
      } catch {
        process.exit(0)
      }
      if (payload.hook_event_name !== 'PostToolUse') {
        process.exit(0)
      }
      if (!isMCPToolName(payload.tool_name)) {
        process.exit(0)
      }
      const original = payload.tool_response
      if (original === undefined) {
        process.exit(0)
      }
      const compressed = compressMCPOutput(original)
      const out = {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          updatedMCPToolOutput: compressed,
        },
      }
      process.stdout.write(JSON.stringify(out))
      process.exit(0)
    } catch {
      // Fail-open: silently exit 0 so Claude Code uses the original.
      process.exit(0)
    }
  })
  if (process.stdin.readable === false) {
    process.exit(0)
  }
}

// Entrypoint-guarded: run main() only when invoked directly, NOT when the test
// imports this module for its pure helpers (else main() blocks on stdin at
// import and the test file never terminates).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
