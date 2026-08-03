/**
 * @file Config loader for the team-activity monitor. Reads one per-watch JSON
 *   file (path passed on the CLI, so the recurring loop stays a single arg),
 *   fills defaults for every optional field, and validates the required ones —
 *   failing LOUD (What / Where / Saw-vs-wanted / Fix) rather than scanning with
 *   a half-formed config. A malformed file is an error, never a silent no-op.
 */

import { readFileSync } from 'node:fs'

import type {
  LinearConfig,
  SlackConfig,
  TeamActivityConfig,
  WatchedComment,
} from './types.mts'

// A partial of the config as parsed from JSON — every field optional so a
// minimal file (just name/org/selfLogin) loads with defaults for the rest.
export interface PartialConfig {
  authors?: readonly string[] | undefined
  dupPairs?: ReadonlyArray<readonly number[]> | undefined
  githubTeamSlug?: string | undefined
  includeIssues?: boolean | undefined
  labels?: readonly string[] | undefined
  linear?: Partial<LinearConfig> | undefined
  name?: string | undefined
  org?: string | undefined
  repos?: readonly string[] | undefined
  selfLogin?: string | undefined
  skipBots?: boolean | undefined
  slack?: Partial<SlackConfig> | undefined
  staleAfterDays?: number | undefined
  watchedComments?: readonly WatchedComment[] | undefined
}

function normalizeLinear(
  partial: Partial<LinearConfig> | undefined,
): LinearConfig | undefined {
  if (!partial || !partial.team) {
    return undefined
  }
  return {
    deriveRoster: partial.deriveRoster ?? false,
    enrich: partial.enrich ?? true,
    linearToGithub: partial.linearToGithub ?? {},
    team: partial.team,
  }
}

function normalizeSlack(
  partial: Partial<SlackConfig> | undefined,
): SlackConfig | undefined {
  if (!partial || !partial.channel) {
    return undefined
  }
  return {
    channel: partial.channel,
    notifyStyle: partial.notifyStyle ?? 'reaction',
    read: partial.read ?? false,
  }
}

// Apply defaults over a parsed partial. Pure — no IO — so it is unit-testable.
export function withDefaults(partial: PartialConfig): TeamActivityConfig {
  const missing: string[] = []
  if (!partial.name) {
    missing.push('name')
  }
  if (!partial.org) {
    missing.push('org')
  }
  if (!partial.selfLogin) {
    missing.push('selfLogin')
  }
  if (missing.length) {
    throw new Error(
      `team-activity config is missing required field(s): ${missing.join(', ')}. ` +
        'Where: the watch config JSON. Saw: absent; wanted: name + org + selfLogin. ' +
        'Fix: add them (see the committed example config).',
    )
  }
  return {
    authors: partial.authors ?? [],
    dupPairs: partial.dupPairs ?? [],
    githubTeamSlug: partial.githubTeamSlug,
    includeIssues: partial.includeIssues ?? true,
    labels: partial.labels ?? [],
    linear: normalizeLinear(partial.linear),
    name: partial.name!,
    org: partial.org!,
    repos: partial.repos ?? [],
    selfLogin: partial.selfLogin!,
    skipBots: partial.skipBots ?? true,
    slack: normalizeSlack(partial.slack),
    staleAfterDays: partial.staleAfterDays,
    watchedComments: partial.watchedComments ?? [],
  }
}

// Read + validate a config file. Throws loud on unreadable/malformed JSON.
export function loadConfig(configPath: string): TeamActivityConfig {
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch (e) {
    throw new Error(
      `team-activity config unreadable at ${configPath}. ` +
        `Saw: ${(e as Error).message}; wanted: a readable JSON file. ` +
        'Fix: create it with the wizard or point at the right path.',
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(
      `team-activity config is not valid JSON at ${configPath}. ` +
        `Saw: ${(e as Error).message}; wanted: the shape in the example config. ` +
        'Fix: correct the JSON.',
    )
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(
      `team-activity config must be a JSON object at ${configPath}. ` +
        'Saw: a non-object; wanted: { name, org, selfLogin, … }. Fix: correct the file.',
    )
  }
  return withDefaults(parsed as PartialConfig)
}
