/**
 * @file Socket.yml types + parser, replacing the archived
 *   `@socketsecurity/config` package
 *   (https://github.com/SocketDev/socket-config-js). The original dependency
 *   shipped ajv + pony-cause to validate a small, stable schema. Inlining the
 *   surface here keeps the same wire format (v1 → v2 migration included)
 *   without dragging in a ~300 KB validator. Validation is intentionally
 *   lighter: we accept the YAML and coerce the required shape; malformed input
 *   throws `SocketValidationError`.
 */

import { parse as yamlParse } from 'yaml'

type SocketYmlGitHub = {
  authenticatedProjectReports?: boolean | undefined
  dependencyOverviewEnabled?: boolean | undefined
  enabled?: boolean | undefined
  ignoreUsers?: string[] | undefined
  projectReportsEnabled?: boolean | undefined
  pullRequestAlertsEnabled?: boolean | undefined
}

export type SocketYml = {
  githubApp: SocketYmlGitHub
  issueRules: { [issueName: string]: boolean }
  projectIgnorePaths: string[]
  version: 2
}

type SocketYmlV1Shape = {
  beta?: boolean | undefined
  enabled?: boolean | undefined
  ignore?: string[] | undefined
  issues?: { [issueName: string]: boolean } | undefined
  projectReportsEnabled?: boolean | undefined
  pullRequestAlertsEnabled?: boolean | undefined
}

class SocketValidationError extends Error {
  data: unknown
  validationErrors: string[]

  constructor(
    message: string,
    validationErrors: string[],
    parsedContent: unknown,
  ) {
    super(message)
    this.name = 'SocketValidationError'
    this.data = parsedContent
    this.validationErrors = validationErrors
  }
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function asBooleanRecord(value: unknown): { [k: string]: boolean } {
  if (!isPlainObject(value)) {
    return {}
  }
  const out: { [k: string]: boolean } = {}
  for (const key of Object.keys(value)) {
    if (typeof value[key] === 'boolean') {
      out[key] = value[key] as boolean
    }
  }
  return out
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((v): v is string => typeof v === 'string')
}

function buildGithub(value: unknown): SocketYmlGitHub {
  if (!isPlainObject(value)) {
    return {}
  }
  const out: SocketYmlGitHub = {}
  const ats = asBoolean(value['authenticatedProjectReports'])
  if (ats !== undefined) {
    out.authenticatedProjectReports = ats
  }
  const dep = asBoolean(value['dependencyOverviewEnabled'])
  if (dep !== undefined) {
    out.dependencyOverviewEnabled = dep
  }
  const enabled = asBoolean(value['enabled'])
  if (enabled !== undefined) {
    out.enabled = enabled
  }
  const ignoreUsers = value['ignoreUsers']
  if (Array.isArray(ignoreUsers)) {
    out.ignoreUsers = asStringArray(ignoreUsers)
  }
  const prr = asBoolean(value['projectReportsEnabled'])
  if (prr !== undefined) {
    out.projectReportsEnabled = prr
  }
  const pra = asBoolean(value['pullRequestAlertsEnabled'])
  if (pra !== undefined) {
    out.pullRequestAlertsEnabled = pra
  }
  return out
}

export function getDefaultConfig(): SocketYml {
  return {
    githubApp: {},
    issueRules: {},
    projectIgnorePaths: [],
    version: 2,
  }
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function looksLikeV1(content: Record<string, unknown>): boolean {
  // V1 had no `version` field. If `version` is present, treat as v2+.
  if ('version' in content) {
    return false
  }
  // V1 distinguishing keys.
  return (
    'ignore' in content ||
    'issues' in content ||
    'beta' in content ||
    'enabled' in content ||
    'projectReportsEnabled' in content ||
    'pullRequestAlertsEnabled' in content
  )
}

function migrateV1(content: SocketYmlV1Shape): SocketYml {
  const github: SocketYmlGitHub = {}
  if ('enabled' in content && typeof content.enabled === 'boolean') {
    github.enabled = content.enabled
  }
  if (
    'pullRequestAlertsEnabled' in content &&
    typeof content.pullRequestAlertsEnabled === 'boolean'
  ) {
    github.pullRequestAlertsEnabled = content.pullRequestAlertsEnabled
  }
  if (
    'projectReportsEnabled' in content &&
    typeof content.projectReportsEnabled === 'boolean'
  ) {
    github.projectReportsEnabled = content.projectReportsEnabled
  }
  return {
    githubApp: github,
    issueRules: content.issues ?? {},
    projectIgnorePaths: content.ignore ?? [],
    version: 2,
  }
}

/**
 * Parse a socket.yml file body. Accepts both v2 (current) and v1 (pre-`version:
 * 2`) layouts; v1 is migrated to v2 in-place.
 *
 * Throws SocketValidationError on missing `version` (v2) or unrecognized
 * top-level shape (v1 + v2 both fail).
 */
export function parseSocketConfig(fileContent: string): SocketYml {
  let parsed: unknown
  try {
    parsed = yamlParse(fileContent)
  } catch (e) {
    throw new SocketValidationError(
      'Error when parsing socket.yml config',
      [String((e as Error).message ?? e)],
      fileContent,
    )
  }
  if (!isPlainObject(parsed)) {
    throw new SocketValidationError(
      'socket.yml must be a mapping at top level',
      ['top-level value is not an object'],
      parsed,
    )
  }
  if (looksLikeV1(parsed)) {
    return migrateV1(parsed as SocketYmlV1Shape)
  }
  if (parsed['version'] !== 2 && parsed['version'] !== '2') {
    throw new SocketValidationError(
      'socket.yml: unsupported or missing `version` (expected 2)',
      [`version=${JSON.stringify(parsed['version'])}`],
      parsed,
    )
  }
  return {
    githubApp: buildGithub(parsed['githubApp']),
    issueRules: asBooleanRecord(parsed['issueRules']),
    projectIgnorePaths: asStringArray(parsed['projectIgnorePaths']),
    version: 2,
  }
}
