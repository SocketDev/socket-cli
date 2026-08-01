#!/usr/bin/env node
// Claude Code PreToolUse hook — no-fleet-fork-guard.
//
// Blocks Edit/Write/MultiEdit AND Bash writes that target a fleet-canonical
// file path inside a downstream fleet repo. The fleet rule ("Never fork
// fleet-canonical files locally") says these files MUST be edited in
// socket-wheelhouse/template/... and cascaded out via sync-scaffolding —
// never branched locally in a downstream repo. Local forks turn into "drift
// to preserve" hacks that block fleet-wide improvements from reaching the
// forked repo. The Bash arm covers `cp`/`mv`/`install` destinations, `tee`
// targets, and `>`/`>>`/`&>`/`&>>` redirects — the same write shapes an Edit
// tool guard can't see, closing the gap where a canonical path was writable
// via `cp`/`tee`/a redirect with no guard at all.
//
// The decision engine lives in `_shared/fleet-fork.mts` — shared with the
// cross-CLI adapters (scripts/fleet/cross-cli/fleet-fork-detect.mts) so
// Codex/Kimi tool calls enforce the identical rule. This file is the Claude
// Code wiring: defineHook + runHook around the shared `check` (Edit/Write/
// MultiEdit) and `bashCheck` (Bash) verdicts, combined so either shape's
// block wins.
//
// The bypass phrase: `Allow fleet-fork bypass`.
//
// Why a hook on top of the CLAUDE.md rule + memory: the rule
// documents the policy, the memory keeps the assistant honest across
// sessions, the hook is the actual enforcement at edit time. Catches
// the failure mode where Claude reaches for a "quick fix" in a
// downstream repo's canonical file (typically because the local
// version has a known bug and the user is in a hurry to land
// something else). The block flips the workflow back to
// "fix-in-template, cascade out" where it belongs.

import { bashCheck, check as editCheck } from '../_shared/fleet-fork.mts'
import { defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

export async function check(payload: ToolCallPayload): Promise<GuardResult> {
  return (await editCheck(payload)) ?? (await bashCheck(payload))
}

export const hook = defineHook({
  bypass: ['fleet-fork'],
  bypassMode: 'manual',
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash', 'Edit', 'MultiEdit', 'Write'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
