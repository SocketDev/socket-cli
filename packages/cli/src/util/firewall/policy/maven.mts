import type { FirewallArtifact } from './types.mts'
import { firewallVersionSegments } from './parser-utils.mts'

const mavenUrl = new RegExp(
  [
    '^/maven2/',
    '(?<groupId>(?:[^/]+/)*[^/]+)',
    '/',
    '(?<artifactId>[^/]+)',
    '/',
    ...firewallVersionSegments,
    '/',
    '(?<filename>[^/]+)',
    '$',
  ].join(''),
)

export function parseMavenUrlPath(
  urlOrPath: string,
): FirewallArtifact | undefined {
  const pathname = urlOrPath.startsWith('http')
    ? new URL(urlOrPath).pathname
    : urlOrPath

  const match = pathname.match(mavenUrl)
  if (!match?.groups) {
    return undefined
  }

  const { groupId, artifactId, version, filename } = match.groups
  if (
    !filename?.startsWith(`${artifactId}-${version}.`) &&
    !filename?.startsWith(`${artifactId}-${version}-`)
  ) {
    return undefined
  }

  return {
    name: groupId
      ? `${groupId.replaceAll('/', '.')}/${artifactId!}`
      : artifactId!,
    type: 'maven',
    version,
  }
}
