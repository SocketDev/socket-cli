import type { FirewallArtifact } from './types.mts'
import { firewallUrlPath, firewallVersionSegments } from './parser-utils.mts'

const cratesUrl = new RegExp(
  [
    '^/crates/',
    '(?<name>[a-zA-Z0-9_-]+)',
    '/',
    ...firewallVersionSegments,
    '/download',
    '$',
  ].join(''),
)

export function parseCratesUrlPath(
  urlOrPath: string,
): FirewallArtifact | undefined {
  const pathname = firewallUrlPath(urlOrPath)

  const match = pathname.match(cratesUrl)
  if (!match?.groups) {
    return undefined
  }

  const { name, version } = match.groups

  return {
    name: name!,
    type: 'cargo',
    version,
  }
}
