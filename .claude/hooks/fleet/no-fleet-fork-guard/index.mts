#!/usr/bin/env node
// Claude Code PreToolUse hook — no-fleet-fork-guard.
//
// Blocks Edit/Write tool calls that target a fleet-canonical file
// path inside a downstream fleet repo. The fleet rule
// ("Never fork fleet-canonical files locally") says these files
// MUST be edited in socket-wheelhouse/template/... and cascaded
// out via sync-scaffolding — never branched locally in a downstream
// repo. Local forks turn into "drift to preserve" hacks that block
// fleet-wide improvements from reaching the forked repo.
//
// The decision engine lives in `_shared/fleet-fork.mts` — shared with the
// cross-CLI adapters (scripts/fleet/cross-cli/fleet-fork-detect.mts) so
// Codex/Kimi tool calls enforce the identical rule. This file is the Claude
// Code wiring: defineHook + runHook around the shared `check`.
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

import { check } from '../_shared/fleet-fork.mts'
import { defineHook, runHook } from '../_shared/guard.mts'

export const hook = defineHook({
  bypass: ['fleet-fork'],
  bypassMode: 'manual',
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
