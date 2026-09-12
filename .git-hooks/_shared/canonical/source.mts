/**
 * @file Authorize producer origins and member-specific committed template
 *   sources.
 */
import { findWheelhouseRoot } from '../../../.claude/hooks/fleet/_shared/wheelhouse-root.mts'
import fleetRosterJson from '../../../.claude/skills/fleet/cascading-commits/lib/fleet-repos.json' with { type: 'json' }
import { SOCKET_GITHUB_ORGS } from '../../../scripts/fleet/constants/socket-scopes.mts'
import { isFleetPackProducerSlug } from '../../../scripts/fleet/member/fleet-membership.mts'
import {
  canonicalGitText,
  canonicalPathIsSafe,
  readCanonicalGit,
  readCanonicalTreeEntry,
} from './git.mts'
import type { CanonicalGitRead } from './git.mts'

function canonicalMemberSlug(root: string): string | undefined {
  const remote = canonicalGitText(root, ['remote', 'get-url', 'origin'])?.trim()
  // Accept the three GitHub transports, retaining the organization segment.
  const match =
    remote &&
    /^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/iu.exec(
      remote,
    )
  if (!match) {
    return undefined
  }
  const member = fleetRosterJson.repos.find(
    repo => repo.name.toLowerCase() === match[2]!.toLowerCase(),
  )
  if (!member) {
    return undefined
  }
  const owners =
    'owner' in member && typeof member.owner === 'string'
      ? [member.owner]
      : SOCKET_GITHUB_ORGS
  return owners.some(owner => owner.toLowerCase() === match[1]!.toLowerCase())
    ? member.name
    : undefined
}
export function canonicalOriginAllowed(root: string): boolean {
  return canonicalMemberSlug(root) !== undefined
}
export function canonicalProducerAllowed(root: string): boolean {
  return isFleetPackProducerSlug(canonicalMemberSlug(root))
}
export function findCanonicalProducer(memberRoot: string): string | undefined {
  const root = findWheelhouseRoot({ startDir: memberRoot })
  return root && canonicalProducerAllowed(root) ? root : undefined
}

function memberConfig(
  member: string,
  readGit: CanonicalGitRead,
): Record<string, unknown> | undefined {
  const source = canonicalGitText(
    member,
    ['show', 'HEAD:.config/repo/socket-wheelhouse.json'],
    readGit,
  )
  try {
    const parsed: unknown =
      source === undefined ? undefined : JSON.parse(source)
    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function memberLayers(member: string, readGit: CanonicalGitRead): string[] {
  const slug = canonicalMemberSlug(member)
  if (!slug) {
    return []
  }
  const config = memberConfig(member, readGit)
  if (!config || config['repoName'] !== slug) {
    return []
  }
  const kind = objectValue(config['repo'])['type']
  const capabilities = Object.entries(objectValue(config['capabilities']))
    .filter(([, scopes]) => Array.isArray(scopes) && scopes.length > 0)
    .map(([name]) => name)
  const layers = [`template/overrides/${slug}`]
  const release = objectValue(config['release'])
  if (release['github'] !== false) {
    layers.push('template/base/conditional/github-release')
  }
  for (let i = 0, { length } = capabilities; i < length; i += 1) {
    const capability = capabilities[i]!
    if (/^[a-z][a-z0-9-]*$/u.test(capability)) {
      layers.push(`template/base/conditional/${capability}`)
    }
  }
  if (kind === 'mono' || kind === 'solo') {
    layers.push(`template/${kind}`)
  }
  layers.push('template/base/universal')
  return layers
}

export function canonicalSourceAllowed(
  member: string,
  producer: string,
  commit: string,
  source: string,
  target: string,
  readGit: CanonicalGitRead = readCanonicalGit,
): boolean {
  if (!canonicalPathIsSafe(source) || !canonicalPathIsSafe(target)) {
    return false
  }
  for (const layer of memberLayers(member, readGit)) {
    const candidate = `${layer}/${target}`
    if (readCanonicalTreeEntry(producer, commit, candidate, readGit)) {
      return source === candidate
    }
  }
  return false
}

export function canonicalEligibleSources(
  member: string,
  file: string,
  readGit: CanonicalGitRead = readCanonicalGit,
): string[] {
  return canonicalPathIsSafe(file)
    ? memberLayers(member, readGit).map(layer => `${layer}/${file}`)
    : []
}
