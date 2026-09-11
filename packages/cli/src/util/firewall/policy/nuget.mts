import type { FirewallArtifact } from './types.mts'
import { firewallUrlPath, firewallVersionSegments } from './parser-utils.mts'

const nugetUrl = new RegExp(
  [
    '^/v3-flatcontainer/',
    '(?<name>[^/]+)',
    '/',
    ...firewallVersionSegments,
    '/',
    '\\k<name>\\.\\k<version>',
    '\\.nupkg$',
  ].join(''),
)

export function parseNugetUrlPath(
  urlOrPath: string,
): FirewallArtifact | undefined {
  const pathname = firewallUrlPath(urlOrPath)

  const match = pathname.match(nugetUrl)
  if (!match?.groups) {
    return undefined
  }
  const { name, version } = match.groups

  return {
    name: name!,
    type: 'nuget',
    version,
  }
}
