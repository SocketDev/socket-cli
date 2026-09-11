import type { FirewallArtifact } from './types.mts'
import { firewallUrlPath, firewallVersionSegments } from './parser-utils.mts'

const npmUrl = new RegExp(
  [
    '^/',
    '(?:@(?<namespace>(?!=%2[fF])[^/]+)(?:/|%2[fF]))?',
    '(?<name>[^/]+)',
    '/-/',
    '\\k<name>-',
    ...firewallVersionSegments,
    '\\.tgz$',
  ].join(''),
)

const artifactoryNpmUrl = new RegExp(
  [
    '^/',
    '(?:@(?<namespace>(?!=%2[fF])[^/]+)(?:/|%2[fF]))?',
    '(?<name>[^/]+)',
    '/-/',
    '@\\k<namespace>(?:/|%2[fF])\\k<name>-',
    ...firewallVersionSegments,
    '\\.tgz$',
  ].join(''),
)

export function parseNpmUrlPath(
  urlOrPath: string,
): FirewallArtifact | undefined {
  const pathname = firewallUrlPath(urlOrPath)

  const match = pathname.match(npmUrl) ?? pathname.match(artifactoryNpmUrl)
  if (!match?.groups) {
    return undefined
  }
  const { namespace, name, version } = match.groups

  return {
    name: namespace ? `@${namespace}/${name!}` : name!,
    type: 'npm',
    version,
  }
}
