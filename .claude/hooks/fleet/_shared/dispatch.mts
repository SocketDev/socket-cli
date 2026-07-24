#!/usr/bin/env node
/**
 * @file Per-event hook dispatcher. settings.json points each event at this ONE
 *   command instead of N separate hook commands, so a tool call pays one node
 *   start + one `@socketsecurity/lib-stable` import for the whole set instead
 *   of one per guard. It reads the payload once, re-exposes it via env so each
 *   in-process guard's `readStdin` returns the same bytes (no fd race), parses
 *   `tool_name`, and imports every guard the manifest registers for the event —
 *   filtered by matcher for PreToolUse. Each guard's top-level `runGuard`
 *   applies its verdict to the shared `process.exitCode`; a block (2) is
 *   preserved across the rest. A guard import that throws is swallowed (fail
 *   open). Only contract-conformant guards (no `process.exit`, no top-level
 *   side effect beyond `runGuard`) belong in the manifest;
 *   `gen/hook-dispatch.mts` enforces that and leaves any non-conformant guard
 *   registered as its own command.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { guardBlocked } from './guard.mts'
import { readStdin } from './transcript.mts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOOKS_DIR = path.join(HERE, '..', '..')
const MANIFEST_PATH = path.join(HERE, 'dispatch-manifest.json')

export interface DispatchHook {
  readonly path: string
  // Cheap keywords: skip importing this guard unless one appears in the raw
  // payload — a guard that can't match shouldn't even be compiled. Absent =>
  // always run.
  readonly triggers?: readonly string[] | undefined
}
export interface DispatchGroup {
  readonly matcher: string
  readonly hooks: ReadonlyArray<string | DispatchHook>
}
export type DispatchManifest = Record<string, readonly DispatchGroup[]>

export function matcherMatches(matcher: string, tool: string): boolean {
  if (!matcher) {
    return true
  }
  const ms = matcher.split('|')
  for (let i = 0, { length } = ms; i < length; i += 1) {
    const m = ms[i]!
    if (m === tool) {
      return true
    }
  }
  return false
}

export function readManifest(): DispatchManifest {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as DispatchManifest
  } catch {
    return {}
  }
}

async function main(): Promise<void> {
  const event = process.argv[2] ?? ''
  if (!event) {
    return
  }
  let raw: string
  try {
    raw = await readStdin()
  } catch {
    return
  }
  // Re-expose the once-read payload so each imported guard's readStdin returns
  // it instead of racing for the already-consumed fd.
  process.env['CLAUDE_HOOK_STDIN'] = raw
  let tool = ''
  try {
    tool =
      (JSON.parse(raw) as { tool_name?: string | undefined }).tool_name ?? ''
  } catch {}
  const groups = readManifest()[event] ?? []
  for (let i = 0, { length } = groups; i < length; i += 1) {
    const group = groups[i]!
    if (!matcherMatches(group.matcher, tool)) {
      continue
    }
    for (let j = 0, glen = group.hooks.length; j < glen; j += 1) {
      const entry = group.hooks[j]!
      const rel = typeof entry === 'string' ? entry : entry.path
      const triggers = typeof entry === 'string' ? undefined : entry.triggers
      // Pre-flight: a guard with triggers whose keywords are absent from the
      // payload can only no-match — skip importing (compiling) it entirely.
      if (
        triggers &&
        triggers.length > 0 &&
        !triggers.some(t => raw.includes(t))
      ) {
        continue
      }
      try {
        // eslint-disable-next-line no-await-in-loop -- guards run sequentially so
        // exitCode accumulates deterministically; parallel import would race it.
        // oxlint-disable-next-line socket/no-module-eval-side-effects -- this is the LIVE runtime dynamic-dispatch entrypoint (run via settings.json `node _shared/dispatch.mts <Event>`), NOT a snapshot bundle member; the variable-path import is its whole purpose. The snapshot bundle is built from _dispatch/dispatch-entry.mts, which is static.
        await import(path.join(HOOKS_DIR, rel))
      } catch {
        // Fail open: a broken guard never blocks the tool call.
      }
      // Early-exit once any guard blocked — covers a PreToolUse exitCode-2 block
      // AND a Stop stdout-JSON block (which keeps exitCode 0). Running the rest
      // is wasted work, and a second Stop block would emit a second JSON object.
      if (process.exitCode === 2 || guardBlocked()) {
        return
      }
    }
  }
}

// socket-lint: allow top-level-await -- runnable ESM entrypoint (run directly via settings.json), never part of the CJS _dispatch/ bundle (that path is built from _dispatch/dispatch-entry.mts).
// oxlint-disable-next-line socket/no-module-eval-side-effects -- runnable entrypoint script (run directly via settings.json), NOT a snapshot bundle member; top-level await is correct here. The snapshot-bootable path is the static _dispatch/ bundle, built from _dispatch/dispatch-entry.mts.
await main()
