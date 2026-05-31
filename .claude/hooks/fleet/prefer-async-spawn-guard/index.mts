#!/usr/bin/env node
// Claude Code PreToolUse hook — prefer-async-spawn-guard.
//
// Blocks Edit/Write tool calls that import from `node:child_process`
// (or bare `child_process`). The fleet routes every subprocess through
// `@socketsecurity/lib-stable/process/spawn/child`:
//
//   - async `spawn` over `spawnSync` (sync freezes the runner),
//   - a typed `SpawnError` + `isSpawnError` guard,
//   - an array-of-args contract that avoids `execSync`'s shell-injection
//     surface.
//
// Mirrors the commit-time `socket/prefer-async-spawn` +
// `socket/prefer-spawn-over-execsync` oxlint rules, catching the import at
// edit time so the agent never writes the wrong shape (the original
// incident: a script imported `{ spawnSync } from 'node:child_process'`,
// which the lint rule would only have caught at commit).
//
// Exit code 2 makes Claude Code refuse the tool call.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit"|"Write",
//     "tool_input": { "file_path": "...", "content"|"new_string": "..." } }
//
// Fails open on malformed payloads (exit 0 + stderr log).
//
// Disable via SOCKET_PREFER_ASYNC_SPAWN_GUARD_DISABLED.
// Bypass (per call): user types `Allow async-spawn bypass`.

import process from 'node:process'

import { bypassPhrasePresent } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_input?:
    | {
        readonly content?: string | undefined
        readonly file_path?: string | undefined
        readonly new_string?: string | undefined
      }
    | undefined
  readonly tool_name?: string | undefined
  readonly transcript_path?: string | undefined
}

interface Finding {
  readonly line: number
  readonly text: string
}

const BYPASS_PHRASE = 'Allow async-spawn bypass'

// `import ... from 'node:child_process'` / `'child_process'` (static import
// or re-export), and `require('node:child_process')`. Quote style and the
// `node:` prefix both tolerated. Matched per-line.
const CHILD_PROCESS_IMPORT_RE =
  /\b(?:import|export)\b[^\n]*\bfrom\s*['"](?:node:)?child_process['"]/
const CHILD_PROCESS_REQUIRE_RE =
  /\brequire\s*\(\s*['"](?:node:)?child_process['"]\s*\)/

/**
 * Files where importing `node:child_process` is legitimate: this hook's own
 * files, the oxlint rules that match the banned shapes, and the markdownlint
 * self-skip shim (a `.mjs` rule loaded by markdownlint-cli2, which can't await
 * the async lib wrapper, so its documented fallback is the sync builtin).
 */
export function isExemptPath(filePath: string): boolean {
  return (
    filePath.includes('/_internal/') ||
    filePath.includes('/dist/') ||
    filePath.includes('/build/') ||
    filePath.includes('/node_modules/') ||
    filePath.includes('/.claude/hooks/fleet/prefer-async-spawn-guard/') ||
    filePath.includes('/.config/oxlint-plugin/rules/prefer-async-spawn.') ||
    filePath.includes(
      '/.config/oxlint-plugin/rules/prefer-spawn-over-execsync.',
    ) ||
    filePath.includes('/.config/oxlint-plugin/test/prefer-async-spawn') ||
    filePath.includes(
      '/.config/oxlint-plugin/test/prefer-spawn-over-execsync',
    ) ||
    filePath.includes(
      '/.config/markdownlint-rules/_shared/wheelhouse-self-skip.',
    )
  )
}

export function findChildProcessImports(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    if (
      CHILD_PROCESS_IMPORT_RE.test(line) ||
      CHILD_PROCESS_REQUIRE_RE.test(line)
    ) {
      findings.push({ line: i + 1, text: line.trim() })
    }
  }
  return findings
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main(): Promise<void> {
  if (process.env['SOCKET_PREFER_ASYNC_SPAWN_GUARD_DISABLED']) {
    process.exit(0)
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(await readStdin()) as ToolInput
  } catch (e) {
    process.stderr.write(
      `prefer-async-spawn-guard: payload parse failed (${(e as Error).message})\n`,
    )
    process.exit(0)
  }

  const toolName = payload.tool_name
  if (toolName !== 'Edit' && toolName !== 'Write') {
    process.exit(0)
  }

  const filePath = payload.tool_input?.file_path ?? ''
  if (!filePath || isExemptPath(filePath)) {
    process.exit(0)
  }
  // Only police JS/TS source.
  if (!/\.(?:c|m)?[jt]sx?$/.test(filePath)) {
    process.exit(0)
  }

  const text =
    payload.tool_input?.content ?? payload.tool_input?.new_string ?? ''
  if (!text) {
    process.exit(0)
  }

  const findings = findChildProcessImports(text)
  if (findings.length === 0) {
    process.exit(0)
  }

  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    process.stderr.write(
      `prefer-async-spawn-guard: ${findings.length} child_process import(s) — bypassed via "${BYPASS_PHRASE}"\n`,
    )
    process.exit(0)
  }

  const lines = findings
    .map(f => `  ${filePath}:${f.line}  ${f.text}`)
    .join('\n')
  process.stderr.write(
    `prefer-async-spawn-guard: refusing to import from 'node:child_process'.\n` +
      `\n${lines}\n\n` +
      `Use the fleet wrapper instead:\n` +
      `  import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'\n` +
      `Prefer async \`spawn\`; reach for \`spawnSync\` only when sync semantics\n` +
      `are genuinely required (still from the lib, not the builtin).\n` +
      `Bypass: type "${BYPASS_PHRASE}".\n`,
  )
  process.exit(2)
}

main().catch(e => {
  process.stderr.write(`prefer-async-spawn-guard: skipped: ${String(e)}\n`)
})
