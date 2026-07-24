#!/usr/bin/env node
/**
 * @file `setup:kimi-user-config` — bridge the fleet-canonical Claude permission
 *   rules into Kimi Code CLI's user-owned `~/.kimi-code/config.toml`. Kimi has
 *   no project-level config for permissions/hooks, so this step merges only the
 *   fleet-managed `[[permission.rules]]` block and preserves all unrelated user
 *   settings. Idempotent: re-running splices the same marked block. Credentials
 *   never belong here. Usage: node
 *   scripts/fleet/setup/setup-kimi-user-config.mts.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { isMainModule } from '../_shared/is-main-module.mts'
import { resolveEcosystemOptions, skipResult } from './ecosystems.mts'

import type {
  EcosystemStepOptions,
  EcosystemStepResult,
} from './ecosystems.mts'

export interface KimiUserConfigOptions extends EcosystemStepOptions {
  readonly kimiConfigPath?: string | undefined
}

const FLEET_MARKERS = {
  begin: '# <fleet-canonical>',
  end: '# </fleet-canonical>',
} as const

const CLAUDE_MARKERS = {
  begin: '// <fleet-canonical>',
  end: '// </fleet-canonical>',
} as const

export interface PermissionRules {
  readonly allow: readonly string[]
  readonly ask: readonly string[]
  readonly deny: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Extract the fleet-canonical field object from `.claude/settings.json`.
 * Returns the subset of fields that live between the `// <fleet-canonical>`
 * and `// </fleet-canonical>` marker keys.
 */
export function extractFleetCanonicalFields(
  text: string,
): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(
      `Failed to parse .claude/settings.json: ${errorMessage(error)}`,
    )
  }
  if (!isRecord(parsed)) {
    throw new Error('.claude/settings.json must contain a JSON object')
  }

  const keys = Object.keys(parsed)
  const beginKey = CLAUDE_MARKERS.begin
  const endKey = CLAUDE_MARKERS.end
  const beginIdx = keys.indexOf(beginKey)
  const endIdx = keys.indexOf(endKey)
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    throw new Error(
      `Could not find ${beginKey} ... ${endKey} keys in .claude/settings.json`,
    )
  }

  const fields: Record<string, unknown> = {}
  for (let i = beginIdx + 1; i < endIdx; i += 1) {
    const key = keys[i]!
    fields[key] = parsed[key]
  }
  return fields
}

/**
 * Parse the canonical permission rules from the fleet-canonical fields.
 */
export function parseClaudePermissions(
  fields: Record<string, unknown>,
): PermissionRules {
  if (!isRecord(fields['permissions'])) {
    throw new Error('Fleet-canonical settings block has no permissions object')
  }
  const perms = fields['permissions']
  const read = (key: string): string[] => {
    const value = perms[key]
    if (value === undefined) {
      return []
    }
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
      throw new Error(`permissions.${key} must be an array of strings`)
    }
    return [...value]
  }
  return {
    allow: read('allow'),
    ask: read('ask'),
    deny: read('deny'),
  }
}

// PreToolUse hooks that route every edit-capable tool through the shared
// cross-cli fleet-fork detector — the Kimi analog of the Claude
// no-fleet-fork-guard (Kimi has no project config for hooks, so it rides the
// user config alongside the permission rules). Kimi's `[[hooks]]` accepts
// EXACTLY event/matcher/command/timeout; any extra field fails the config load.
// matcher is an exact tool-name, so one entry per edit-capable tool. The command
// runs from the session cwd: in a fleet repo the script resolves + enforces; in
// a non-fleet repo it is absent, and Kimi treats a failed hook as allow.
const KIMI_FLEET_FORK_HOOK_COMMAND =
  'node scripts/fleet/cross-cli/pretooluse-hook.mts'
const KIMI_FLEET_FORK_HOOK_MATCHERS: readonly string[] = [
  'Bash',
  'Edit',
  'MultiEdit',
  'Shell',
  'Write',
]

/**
 * Render the fleet-managed PreToolUse hook block as Kimi TOML lines (one
 * `[[hooks]]` table per edit-capable tool). Trailing blank line per entry;
 * caller trims before the close marker.
 */
export function renderKimiHooks(): string[] {
  const lines: string[] = []
  for (
    let i = 0, { length } = KIMI_FLEET_FORK_HOOK_MATCHERS;
    i < length;
    i += 1
  ) {
    lines.push(
      '[[hooks]]',
      'event = "PreToolUse"',
      `matcher = ${JSON.stringify(KIMI_FLEET_FORK_HOOK_MATCHERS[i]!)}`,
      `command = ${JSON.stringify(KIMI_FLEET_FORK_HOOK_COMMAND)}`,
      'timeout = 10',
      '',
    )
  }
  return lines
}

/**
 * Render the fleet-managed permission rules + PreToolUse fork hooks as a Kimi
 * TOML block, wrapped in the fleet-canonical markers.
 */
export function renderKimiPermissionRules(rules: PermissionRules): string {
  const lines: string[] = [FLEET_MARKERS.begin]
  const add = (decision: string, pattern: string) => {
    lines.push(
      '[[permission.rules]]',
      `decision = ${JSON.stringify(decision)}`,
      `pattern = ${JSON.stringify(pattern)}`,
      '',
    )
  }
  for (const pattern of rules.allow) {
    add('allow', pattern)
  }
  for (const pattern of rules.deny) {
    add('deny', pattern)
  }
  for (const pattern of rules.ask) {
    add('ask', pattern)
  }
  lines.push(...renderKimiHooks())
  // Trim trailing blank before the close marker.
  while (lines[lines.length - 1] === '') {
    lines.pop()
  }
  lines.push(FLEET_MARKERS.end)
  return lines.join('\n')
}

/**
 * Splice the fleet block into the existing TOML text. Removes any previous
 * fleet block and appends the new one at the end.
 */
export function mergeKimiUserConfig(
  currentText: string,
  rules: PermissionRules,
): string {
  const beginIdx = currentText.indexOf(FLEET_MARKERS.begin)
  const endIdx = currentText.indexOf(FLEET_MARKERS.end)
  let withoutFleet = currentText
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    withoutFleet =
      currentText.slice(0, beginIdx) +
      currentText.slice(endIdx + FLEET_MARKERS.end.length)
  }
  // Clean up leftover blank lines at EOF from the removed block.
  withoutFleet = withoutFleet.replace(/\n+$/, '')
  const fleetBlock = renderKimiPermissionRules(rules)
  if (withoutFleet.length === 0) {
    return `${fleetBlock}\n`
  }
  return `${withoutFleet}\n\n${fleetBlock}\n`
}

/**
 * Merge fleet permission rules into Kimi's user-owned config.toml.
 */
export async function setupKimiUserConfig(
  options?: KimiUserConfigOptions | undefined,
): Promise<EcosystemStepResult> {
  const opts = options ?? {}
  const { commandExists, logger, repoRoot } = resolveEcosystemOptions(opts)
  if (!(await commandExists('kimi'))) {
    return skipResult(logger, 'setup:kimi-user-config', 'kimi CLI not on PATH')
  }

  const settingsPath = path.join(repoRoot, '.claude', 'settings.json')
  const kimiConfigPath =
    opts.kimiConfigPath ??
    path.join(
      process.env['KIMI_CODE_HOME'] ?? path.join(os.homedir(), '.kimi-code'),
      'config.toml',
    )

  try {
    const settingsText = readFileSync(settingsPath, 'utf8')
    const fields = extractFleetCanonicalFields(settingsText)
    const rules = parseClaudePermissions(fields)

    const current = existsSync(kimiConfigPath)
      ? readFileSync(kimiConfigPath, 'utf8')
      : ''
    const next = mergeKimiUserConfig(current, rules)
    if (next !== current) {
      mkdirSync(path.dirname(kimiConfigPath), { recursive: true })
      writeFileSync(kimiConfigPath, next, { mode: 0o600 })
      chmodSync(kimiConfigPath, 0o600)
    }
  } catch (error) {
    logger.error(`setup:kimi-user-config — ${errorMessage(error)}`)
    return {
      ok: false,
      reason: 'Kimi user config setup failed',
      skipped: false,
    }
  }

  logger.success(
    'setup:kimi-user-config — Kimi permission rules synced from .claude/settings.json.',
  )
  return { ok: true, skipped: false }
}

if (isMainModule(import.meta.url)) {
  setupKimiUserConfig().then(
    result => {
      process.exitCode = result.ok ? 0 : 1
    },
    (error: unknown) => {
      process.stderr.write(`${errorMessage(error)}\n`)
      process.exitCode = 1
    },
  )
}
