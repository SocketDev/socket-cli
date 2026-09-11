import type { FirewallArtifact } from './types.mts'
import { firewallUrlPath, firewallVersionSegments } from './parser-utils.mts'

const goUrl = new RegExp(
  [
    '^/',
    '(?<modulePath>[^@]+)',
    '/@v/',
    'v',
    ...firewallVersionSegments,
    '\\.',
    '(?<ext>mod|zip|info)',
    '$',
  ].join(''),
)

export function parseGoUrlPath(
  urlOrPath: string,
): FirewallArtifact | undefined {
  const pathname = firewallUrlPath(urlOrPath)

  const match = pathname.match(goUrl)
  if (!match?.groups) {
    return undefined
  }

  const { modulePath, version } = match.groups

  return {
    name: modulePath!,
    type: 'golang',
    version: `v${version}`,
  }
}
