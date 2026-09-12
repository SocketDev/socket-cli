import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { parseCratesUrlPath } from './cargo.mts'
import { parseRubyGemsUrlPath } from './gem.mts'
import { parseGoUrlPath } from './golang.mts'
import { parseMavenUrlPath } from './maven.mts'
import { parseNpmUrlPath } from './npm.mts'
import { parseNugetUrlPath } from './nuget.mts'
import { parsePypiUrlPath } from './pypi.mts'
import { firewallVersionSegments } from './parser-utils.mts'
import type { FirewallArtifact, FirewallEcosystem } from './types.mts'

export function firewallArtifactPurls(artifact: FirewallArtifact): string[] {
  const base = `pkg:${artifact.type}/${artifact.name}@${artifact.version}`
  if (artifact.type === 'gem' && artifact.qualifiers?.['platform']) {
    return [
      `${base}?${new URLSearchParams(artifact.qualifiers).toString()}`,
      `${base}?platform=ruby`,
    ]
  }
  return [base]
}

export function firewallPathHasUnsafeCharacters(path: string): boolean {
  return Array.from(path).some(character => {
    const code = character.charCodeAt(0)
    return (
      code <= 32 ||
      code === 127 ||
      character === '\\' ||
      character === '?' ||
      character === '#'
    )
  })
}

export function isFirewallArtifactPath(
  kind: FirewallEcosystem,
  pathname: string,
): boolean {
  let path: string
  try {
    path = decodeURIComponent(pathname)
  } catch {
    return true
  }
  if (
    normalizePath(path).includes('%') ||
    firewallPathHasUnsafeCharacters(path)
  ) {
    return true
  }
  switch (kind) {
    case 'npm':
      return (
        (normalizePath(path).includes('/-/') &&
          // Exclude only npm metadata endpoints from the artifact marker.
          !/^\/-\/(?:npm\/|ping(?:\/|$)|v1\/|user\/|whoami(?:\/|$)|all(?:\/|$)|stage(?:\/|$))/.test(
            normalizePath(path),
          )) ||
        /\.tgz(?:\/|$)/i.test(normalizePath(path))
      )
    case 'pypi':
      // Recognize Python distribution extensions and metadata sidecars.
      return /\.(?:tar\.bz2|tar\.gz|tgz|whl|zip)(?:\.metadata)?(?:\/|$)/i.test(
        normalizePath(path),
      )
    case 'golang':
      // Recognize versioned module metadata and archive requests.
      return /\/@v\/.*\.(?:info|mod|zip)(?:\/|$)/i.test(normalizePath(path))
    case 'maven':
      // Recognize Maven artifacts and checksum sidecars.
      return /\.(?:aar|jar|module|pom|war|zip)(?:\.|\/|$)/i.test(
        normalizePath(path),
      )
    case 'gem':
      // Recognize gem downloads and marshalled gem specifications.
      return /\.(?:gem|gemspec\.rz)(?:\/|$)/i.test(normalizePath(path))
    case 'cargo':
      // Recognize Cargo archive and API download paths.
      return /\.crate(?:\/|$)|\/crates\/.*\/download(?:\/|$)/i.test(
        normalizePath(path),
      )
    case 'nuget':
      return /\.nupkg(?:\/|$)/i.test(normalizePath(path))
  }
  throw new TypeError('Unsupported firewall ecosystem')
}

export function parseFirewallArtifact(
  kind: FirewallEcosystem,
  pathname: string,
): FirewallArtifact | undefined {
  if (firewallPathHasUnsafeCharacters(pathname)) {
    return undefined
  }
  let path = pathname
  if (kind === 'npm') {
    path = path.replace(/%2f/gi, '/')
  }
  // Accept only epoch and build separators after scoped npm slash decoding.
  if (/%(?!21|2[bB])/.test(normalizePath(path))) {
    return undefined
  }
  path = path.replace(/%21/g, '!').replace(/%2b/gi, '+')
  switch (kind) {
    case 'npm':
      return parseNpmUrlPath(path)
    case 'pypi':
      return parsePypiUrlPath(path)
    case 'golang': {
      const artifact = parseGoUrlPath(path)
      if (artifact) {
        artifact.name = artifact.name.replace(/!([a-z])/g, (match: string) =>
          match.slice(1).toUpperCase(),
        )
      }
      return artifact
    }
    case 'maven':
      return parseMavenUrlPath(
        normalizePath(path).startsWith('/maven2/') ? path : `/maven2${path}`,
      )
    case 'gem':
      return parseRubyGemsUrlPath(path)
    case 'cargo':
      return parseFirewallCargoArtifact(path)
    case 'nuget':
      return parseFirewallNugetArtifact(path)
  }
  return undefined
}

export function parseFirewallCargoArtifact(
  path: string,
): FirewallArtifact | undefined {
  const download = parseCratesUrlPath(path.replace(/^\/api\/v1\//, '/'))
  if (download) {
    return download
  }
  // Require the archive filename to repeat the crate name.
  const match = /^\/crates\/([a-zA-Z0-9_-]+)\/\1-(\d[^/]*)\.crate$/.exec(
    normalizePath(path),
  )
  return match
    ? parseCratesUrlPath(`/crates/${match[1]}/${match[2]}/download`)
    : undefined
}

export function parseFirewallNugetArtifact(
  path: string,
): FirewallArtifact | undefined {
  const flat = parseNugetUrlPath(path)
  if (flat) {
    return flat
  }
  const match = new RegExp(
    `^/packages/(?<name>[^/]+?)\\.${firewallVersionSegments.join('')}\\.nupkg$`,
  ).exec(normalizePath(path))
  return match?.groups
    ? {
        type: 'nuget',
        name: match.groups['name']!,
        version: match.groups['version'],
      }
    : undefined
}
