/*
 * @file Pure merge logic for hybrid `.claude/settings.json` files. The marked
 *   top-level region is fleet-owned; top-level settings after the closing
 *   marker are repository-owned. Repo hook commands remain nested under the
 *   fleet-owned `hooks` key because Claude accepts only one hooks object, so
 *   the merger preserves commands routed through `.claude/hooks/repo/`.
 */

import {
  baselineCommand,
  launcherCommand,
  launcherWiredEvents,
  rewriteDispatchCommands,
} from './dispatch-wiring.mts'

export const FLEET_SETTINGS_BEGIN = '// <fleet-canonical>'
export const FLEET_SETTINGS_END = '// </fleet-canonical>'

export interface ClaudeHookEntry {
  command?: string | undefined
  type?: string | undefined
  [key: string]: unknown
}

export interface ClaudeHookMatcher {
  hooks?: ClaudeHookEntry[] | undefined
  matcher?: string | undefined
  [key: string]: unknown
}

export interface ClaudeHooks {
  [event: string]: ClaudeHookMatcher[] | undefined
}

export interface ClaudeSettings {
  hooks?: ClaudeHooks | undefined
  [key: string]: unknown
}

export interface MergeClaudeSettingsOptions {
  fleetSettings: ClaudeSettings
  repoSettings?: ClaudeSettings | undefined
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function fleetSettingsKeys(settings: ClaudeSettings): string[] {
  const keys = Object.keys(settings)
  const start = keys.indexOf(FLEET_SETTINGS_BEGIN)
  const end = keys.indexOf(FLEET_SETTINGS_END)
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      'Invalid Claude settings fleet section: settings.json has missing or misordered <fleet-canonical> markers; expected one opening marker before one closing marker; fix the marker keys in the canonical template.',
    )
  }
  return keys.slice(start, end + 1)
}

export function isLegacyFleetCommentEnv(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const entries = Object.entries(value)
  if (entries.length !== 1 || entries[0]?.[0] !== '//') {
    return false
  }
  const comments = entries[0][1]
  return (
    Array.isArray(comments) &&
    comments.some(
      comment =>
        typeof comment === 'string' &&
        comment.includes('CLAUDE_CODE_NO_FLICKER'),
    )
  )
}

export function isRepoHookCommand(command: unknown): boolean {
  return typeof command === 'string' && command.includes('/.claude/hooks/repo/')
}

export function mergeClaudeSettings(
  options: MergeClaudeSettingsOptions,
): ClaudeSettings {
  const opts = { __proto__: null, ...options } as MergeClaudeSettingsOptions
  const { fleetSettings, repoSettings } = opts
  const fleetKeys = fleetSettingsKeys(fleetSettings)
  const fleetKeySet = new Set(fleetKeys)
  const merged: ClaudeSettings = {}

  for (const key of fleetKeys) {
    merged[key] = cloneJson(fleetSettings[key])
  }
  if (repoSettings !== undefined) {
    spliceRepoHookEntries(merged, repoSettings)
    // Preserve a host's per-machine launcher (V8 snapshot fast-path) wiring
    // across the merge. The template ships every dispatch slot as the baseline
    // (index.cjs), but a host that ran setup/hook-snapshot.mts wired some slots
    // to the launcher — the SAME fleet slot, just realized for this machine. A
    // blanket copy of the template fleet section would revert that fast path on
    // every cascade; re-apply the host's launcher form so the wiring is durable.
    // Correctness is unaffected either way: the launcher fails open to the
    // baseline, and hook-snapshot-is-active + setup cover a reaped launcher.
    const hostLauncherEvents = launcherWiredEvents(repoSettings)
    if (hostLauncherEvents.size > 0) {
      rewriteDispatchCommands(merged, event =>
        hostLauncherEvents.has(event)
          ? launcherCommand(event)
          : baselineCommand(event),
      )
    }
    for (const [key, value] of Object.entries(repoSettings)) {
      if (
        fleetKeySet.has(key) ||
        key === FLEET_SETTINGS_BEGIN ||
        key === FLEET_SETTINGS_END ||
        (key === 'env' && isLegacyFleetCommentEnv(value))
      ) {
        continue
      }
      merged[key] = cloneJson(value)
    }
  }
  return merged
}

export function projectFleetSettings(
  settings: ClaudeSettings,
  fleetSettings: ClaudeSettings,
): ClaudeSettings {
  const projected: ClaudeSettings = {}
  for (const key of fleetSettingsKeys(fleetSettings)) {
    if (Object.hasOwn(settings, key)) {
      projected[key] = cloneJson(settings[key])
    }
  }
  stripRepoHookEntries(projected)
  // Canonicalize the per-host dispatch form (launcher → baseline) so the
  // fleet-drift comparison is form-agnostic: a host that wired the snapshot
  // launcher runs the SAME fleet dispatch slot as the baseline template, so it
  // must NOT read as settings_merge_drift.
  rewriteDispatchCommands(projected, baselineCommand)
  return projected
}

export function spliceRepoHookEntries(
  destination: ClaudeSettings,
  source: ClaudeSettings,
): void {
  const sourceHooks = source.hooks
  if (sourceHooks === undefined) {
    return
  }
  for (const [event, matcherEntries] of Object.entries(sourceHooks)) {
    if (!Array.isArray(matcherEntries)) {
      continue
    }
    for (const matcherEntry of matcherEntries) {
      if (!Array.isArray(matcherEntry.hooks)) {
        continue
      }
      for (const hook of matcherEntry.hooks) {
        if (isRepoHookCommand(hook.command)) {
          spliceRepoHookEntry(destination, event, matcherEntry.matcher, hook)
        }
      }
    }
  }
}

export function spliceRepoHookEntry(
  settings: ClaudeSettings,
  event: string,
  matcher: string | undefined,
  hook: ClaudeHookEntry,
): void {
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {}
  }
  const eventEntries = settings.hooks[event] ?? []
  const matcherValue = matcher ?? ''
  let destination = eventEntries.find(
    entry => (entry.matcher ?? '') === matcherValue,
  )
  if (destination === undefined) {
    destination = matcherValue
      ? { hooks: [], matcher: matcherValue }
      : { hooks: [] }
    eventEntries.push(destination)
    settings.hooks[event] = eventEntries
  }
  if (!Array.isArray(destination.hooks)) {
    destination.hooks = []
  }
  const serialized = JSON.stringify(hook)
  if (destination.hooks.some(entry => JSON.stringify(entry) === serialized)) {
    return
  }
  destination.hooks.push(cloneJson(hook))
}

export function stripRepoHookEntries(settings: ClaudeSettings): void {
  const hooks = settings.hooks
  if (hooks === undefined) {
    return
  }
  for (const event of Object.keys(hooks)) {
    const matcherEntries = hooks[event] ?? []
    for (const matcherEntry of matcherEntries) {
      if (!Array.isArray(matcherEntry.hooks)) {
        continue
      }
      matcherEntry.hooks = matcherEntry.hooks.filter(
        hook => !isRepoHookCommand(hook.command),
      )
    }
    const remaining = matcherEntries.filter(
      matcherEntry =>
        !Array.isArray(matcherEntry.hooks) || matcherEntry.hooks.length > 0,
    )
    if (remaining.length > 0) {
      hooks[event] = remaining
    } else {
      delete hooks[event]
    }
  }
}
