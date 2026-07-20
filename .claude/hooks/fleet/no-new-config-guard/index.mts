#!/usr/bin/env node
// Claude Code PreToolUse hook — no-new-config-guard.
//
// BLOCKS creating a NEW config-DATA file (.json / .yaml / .yml / .toml) under a
// `.config/` directory. Per-repo config flows through ONE per-member settings
// file — `.config/socket-wheelhouse.json` (the "wheelhouse settings", schema
// `scripts/fleet/socket-wheelhouse-schema.mts`) — as a section that each script
// reads via the schema. New single-purpose config files (contrast.json,
// docker-prebakes.json, wheelhouse-settings.json, …) fragment that config,
// drift, and blur the fleet/repo tier — add a section to the wheelhouse settings
// and extend its schema instead.
//
// Only CREATION is blocked; editing an existing config is always fine. Only
// config DATA (.json/.yaml/.yml/.toml) — tooling CODE configs (`*.config.mts`,
// oxlint-plugin sources, vitest configs) are exempt. The wheelhouse settings +
// its schema are allowlisted.
//
// Bypass: `Allow new-config bypass` typed verbatim in a recent user turn (for a
// genuinely-needed new fleet-wide config with no home in the settings).
//
// Fails open on hook bugs (exit 0 + stderr log).

import { existsSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isEphemeralPath } from '../_shared/ephemeral-path.mts'
import { isFleetTarget } from '../_shared/fleet-context.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

// The sanctioned per-member config home + its schema. Everything else new under
// `.config/` is blocked. `.socket-wheelhouse.json` (root dotfile alternative)
// is matched by basename too.
const ALLOWED_BASENAMES: ReadonlySet<string> = new Set([
  'socket-wheelhouse.json',
  'socket-wheelhouse-schema.json',
  '.socket-wheelhouse.json',
])

// Config-DATA extensions. Code configs (`.mts`/`.mjs`/`.ts`) are tooling, exempt.
const CONFIG_DATA_EXT = /\.(?:json|ya?ml|toml)$/

export function isNewConfigViolation(absPath: string): boolean {
  if (isEphemeralPath(absPath)) {
    return false
  }
  const norm = normalizePath(absPath)
  // Only config DATA under a `.config/` directory (at any depth).
  if (!CONFIG_DATA_EXT.test(norm) || !norm.includes('/.config/')) {
    return false
  }
  return !ALLOWED_BASENAMES.has(path.basename(norm))
}

export function emitBlock(filePath: string): string {
  return (
    [
      '[no-new-config-guard] Blocked: new standalone config file.',
      `  File: ${filePath}`,
      '',
      '  Per-repo config flows through the ONE per-member settings file:',
      '    .config/socket-wheelhouse.json  (schema: scripts/fleet/socket-wheelhouse-schema.mts)',
      '  Add a section there + extend the schema; each script reads its part via',
      '  the schema. Do NOT create a new single-purpose config file — they',
      '  fragment config, drift, and blur the fleet/repo tier.',
    ].join('\n') + '\n'
  )
}

export const check = editGuard((filePath, content, payload) => {
  void content
  if (!isNewConfigViolation(filePath)) {
    return undefined
  }
  if (!isFleetTarget(payload)) {
    return undefined
  }
  // Only block CREATION — editing an existing config file is fine.
  if (existsSync(filePath)) {
    return undefined
  }
  return block(emitBlock(filePath))
})

export const hook = defineHook({
  bypass: ['new-config'],
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
