/**
 * @file The `janus` CLI runner for the multi-Janus MCP shim. Shells the `janus`
 *   binary with `JANUS_ROOT=<workspace>/.janus` so each call targets the chosen
 *   repo's queue, and maps the shim's tool calls onto `janus`
 *   create/next/show/ls/status subcommands (all support `--json`). Lossless
 *   passthrough — the shim adds workspace routing, not semantics. Deleted when
 *   upstream `janus mcp --workspace` lands.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import type { Workspace } from './janus-multi-workspace.mts'

// Resolved `janus` binary. PATH lookup (Homebrew installs to /opt/homebrew/bin;
// cargo to ~/.cargo/bin) — let spawn resolve it so we don't hard-code a path.
const JANUS_BIN = 'janus'

export interface RunResult {
  ok: boolean
  // Raw stdout (JSON text when the subcommand was given --json, else plain).
  stdout: string
  // stderr, surfaced on failure so the MCP error names the real cause.
  stderr: string
}

// Run one `janus` subcommand against a workspace's `.janus/` root. Never throws
// — a non-zero exit / spawn error is reported via `ok:false` + stderr so the
// MCP layer turns it into a tool error rather than crashing the server.
export function runJanus(workspace: Workspace, args: readonly string[]): RunResult {
  const r = spawnSync(JANUS_BIN, [...args], {
    cwd: workspace.repoPath,
    env: { ...process.env, JANUS_ROOT: workspace.janusRoot },
    timeout: 30_000,
  })
  // lib spawnSync: numeric `status` on a clean run; a string code (e.g.
  // 'ENOENT') or null when the spawn itself failed.
  const ok = r.status === 0
  return {
    ok,
    stderr: String(r.stderr ?? '').trim(),
    stdout: String(r.stdout ?? '').trim(),
  }
}

// --- Tool → janus-subcommand mappings ------------------------------------
//
// Each returns the argv (sans `janus`) for runJanus. Kept pure + tiny so the
// MCP handler stays a thin dispatch. `--json` is requested wherever the
// subcommand supports it, so the shim returns machine-readable output.

export function createTicketArgs(input: {
  title: string
  description?: string | undefined
  ticketType?: string | undefined
  priority?: number | undefined
  externalRef?: string | undefined
}): string[] {
  const args = ['create', input.title]
  if (input.description) {
    args.push('--description', input.description)
  }
  if (input.ticketType) {
    args.push('--type', input.ticketType)
  }
  if (typeof input.priority === 'number') {
    args.push('--priority', String(input.priority))
  }
  if (input.externalRef) {
    args.push('--external-ref', input.externalRef)
  }
  return args
}

export function nextTicketArgs(limit?: number | undefined): string[] {
  const args = ['next', '--json']
  if (typeof limit === 'number' && limit > 0) {
    args.push('--limit', String(limit))
  }
  return args
}

export function listTicketsArgs(): string[] {
  return ['ls', '--json']
}

export function showTicketArgs(id: string): string[] {
  return ['show', id, '--json']
}

export function updateStatusArgs(id: string, status: string): string[] {
  return ['status', id, status, '--json']
}
