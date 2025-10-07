/**
 * Requirements configuration utilities for Socket CLI.
 * Manages API permissions and quota requirements for commands.
 *
 * Key Functions:
 * - getRequirements: Load requirements configuration from SDK
 * - getRequirementsKey: Convert command path to SDK method name
 *
 * Configuration:
 * - Loads from @socketsecurity/sdk/requirements.json
 * - Maps CLI command paths to SDK method names
 * - Used for permission validation and help text
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let _requirements:
  | Readonly<{
      api: Record<
        string,
        {
          quota: number
          permissions: string[]
        }
      >
    }>
  | undefined

export function getRequirements() {
  if (_requirements === undefined) {
    _requirements = /*@__PURE__*/ require('@socketsecurity/sdk/requirements.json')
  }
  return _requirements!
}

/**
 * Map CLI command paths to SDK method names.
 * Value is always an array of SDK method names (even for single methods).
 * Multiple methods will have their requirements combined (quota summed, permissions unioned).
 */
const CLI_TO_SDK_METHOD_MAP = new Map<string, string[]>([
  ['analytics', ['getOrgAnalytics']],
  ['audit-log', ['getAuditLogEvents']],
  ['fix', ['createScanFromFilepaths', 'batchPackageFetch']],
  ['login', ['getApi']],
  ['npm', ['batchPackageFetch']],
  ['npx', ['batchPackageFetch']],
  ['optimize', ['batchPackageFetch']],
  ['organization:dependencies', ['searchDependencies']],
  ['organization:list', ['getOrganizations']],
  ['organization:quota', ['getQuota']],
  ['organization:policy:license', ['getOrgLicensePolicy']],
  ['organization:policy:security', ['getOrgSecurityPolicy']],
  ['package:score', ['getScoreByNpmPackage']],
  ['package:shallow', ['getIssuesByNpmPackage']],
  ['repository:create', ['createOrgRepo']],
  ['repository:del', ['deleteOrgRepo']],
  ['repository:list', ['getOrgRepoList']],
  ['repository:update', ['updateOrgRepo']],
  ['repository:view', ['getOrgRepo']],
  ['scan:create', ['createOrgFullScan']],
  ['scan:del', ['deleteOrgFullScan']],
  ['scan:diff', ['createOrgDiffScanFromIds']],
  ['scan:github', ['createOrgFullScan']],
  ['scan:list', ['getOrgFullScanList']],
  ['scan:metadata', ['getOrgFullScanMetadata']],
  ['scan:reach', ['streamOrgFullScan']],
  ['scan:report', ['getOrgFullScanMetadata', 'getOrgSecurityPolicy']],
  ['scan:view', ['getOrgFullScanBuffered']],
  ['shallow', ['getIssuesByNpmPackage']],
  ['threat-feed', ['getApi']],
])

/**
 * Convert command path to SDK method name(s) for requirements lookup.
 * Returns array of SDK method names, or wraps unknown key in array.
 */
export function getRequirementsKey(cmdPath: string): string[] {
  const cliKey = cmdPath.replace(/^socket[: ]/, '').replace(/ +/g, ':')
  return CLI_TO_SDK_METHOD_MAP.get(cliKey) || [cliKey]
}
