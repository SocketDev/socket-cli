/**
 * @file One-reference path resolvers for the team-activity monitor. All
 *   operator data lives under a single umbrella
 *   `~/.socket/_wheelhouse/hooks/…`, resolved via the canonical
 *   `getSocketAppDir('wheelhouse')` helper — never a hand-rolled home join.
 *   Watch config + state + MCP input files sit under `team-activity/`; per-user
 *   voice cards under `voice/`. Mantra: 1 path, 1 reference.
 */

import os from 'node:os'
import path from 'node:path'

import { getSocketAppDir } from '@socketsecurity/lib-stable/paths/socket'

// `~/.socket/_wheelhouse/hooks` — the umbrella for fleet-automation runtime data.
export function wheelhouseHooksDir(): string {
  return path.join(getSocketAppDir('wheelhouse'), 'hooks')
}

// `…/hooks/team-activity` — watch configs, state, and MCP input files.
export function teamActivityDir(): string {
  return path.join(wheelhouseHooksDir(), 'team-activity')
}

// The default config path for a named watch (the wizard writes here).
export function configPathFor(name: string): string {
  return path.join(teamActivityDir(), `${name}.json`)
}

// Script-owned sibling state file for a given config path.
export function statePathFor(configPath: string): string {
  return `${configPath}.state.json`
}

// `…/hooks/voice` — per-user voice/tone/leadership cards (Phase 3).
export function voiceDir(): string {
  return path.join(wheelhouseHooksDir(), 'voice')
}

// The voice card path for a GitHub login.
export function voiceCardPath(login: string): string {
  return path.join(voiceDir(), `${login}.md`)
}

// Expand a leading `~/` so a config value carries no hardcoded home prefix.
export function expandHome(p: string): string {
  return p.startsWith('~/') ? `${os.homedir()}/${p.slice(2)}` : p
}
