import type { FirewallRegistryKind } from './types.mts'

export interface FirewallRegistry {
  host: string
  prefix: string
  protocol?: string | undefined
  kind: FirewallRegistryKind
}

export const FIREWALL_DEFAULT_REGISTRIES = new Map<
  string,
  FirewallRegistryKind
>([
  ['*.pythonhosted.org', 'pypi'],
  ['api.nuget.org', 'nuget'],
  ['bootstrap.pypa.io', 'bypass'],
  ['central.maven.org', 'maven'],
  ['cmake.org', 'bypass'],
  ['codeload.github.com', 'bypass'],
  ['crates.io', 'cargo'],
  ['files.pythonhosted.org', 'pypi'],
  ['github.com', 'bypass'],
  ['globalcdn.nuget.org', 'nuget'],
  ['index.crates.io', 'wrap'],
  ['index.rubygems.org', 'gem'],
  ['maven.org', 'maven'],
  ['mirror.bazel.build', 'bypass'],
  ['proxy.golang.org', 'golang'],
  ['pypi.org', 'pypi'],
  ['pypi.python.org', 'pypi'],
  ['registry.npmjs.org', 'npm'],
  ['registry.yarnpkg.com', 'npm'],
  ['repo.maven.apache.org', 'maven'],
  ['repo.yarnpkg.com', 'wrap'],
  ['repo1.maven.org', 'maven'],
  ['rubygems.global.ssl.fastly.net', 'gem'],
  ['rubygems.org', 'gem'],
  ['sh.rustup.rs', 'bypass'],
  ['static.crates.io', 'cargo'],
  ['static.rust-lang.org', 'wrap'],
  ['sum.golang.org', 'golang'],
  ['yarnpkg.com', 'wrap'],
  ['ziglang.org', 'bypass'],
])

export function firewallRegistryHostMatches(
  pattern: string,
  host: string,
): boolean {
  const authority = new URL(`https://${pattern}`)
  const destination = new URL(`https://${host}`)
  return (
    firewallRegistryHostnameMatches(authority.hostname, destination.hostname) &&
    (!authority.port || authority.port === destination.port)
  )
}

export function firewallRegistryHostnameMatches(
  pattern: string,
  hostname: string,
): boolean {
  const normalized = hostname.toLowerCase().replace(/\.+$/, '')
  return (
    pattern === normalized ||
    (pattern.startsWith('*.') &&
      normalized.endsWith(pattern.slice(1)) &&
      normalized.length > pattern.length - 1)
  )
}

export function isFirewallRegistryHostname(hostname: string): boolean {
  return !hostname.includes('*') || /^\*\.[^*]+$/.test(hostname)
}

export function isFirewallRegistryKind(
  kind: string,
): kind is FirewallRegistryKind {
  return /^(?:block|bypass|cargo|gem|golang|maven|npm|nuget|pypi|wrap)$/.test(
    kind,
  )
}

export function parseFirewallRegistry(input: string): FirewallRegistry {
  const colon = input.indexOf(':')
  const kind = input.slice(0, colon)
  const address = input.slice(colon + 1)
  if (
    colon < 1 ||
    !isFirewallRegistryKind(kind) ||
    !address ||
    /[\\\s?#%]/.test(address) ||
    // Reject dot segments before URL normalization can hide them.
    /(?:^|\/)\.{1,2}(?:\/|$)/.test(address)
  ) {
    throw new TypeError(
      'Invalid firewall registry configuration. Use ecosystem:host/prefix.',
    )
  }
  const explicitProtocol = /^https?:\/\//.test(address)
  const url = new URL(explicitProtocol ? address : `https://${address}`)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hostname.endsWith('.') ||
    url.pathname.includes('//') ||
    !isFirewallRegistryHostname(url.hostname)
  ) {
    throw new TypeError(
      'Invalid firewall registry authority. Use a host without credentials or fragments.',
    )
  }
  return {
    host: url.host,
    prefix: url.pathname === '/' ? '' : url.pathname.replace(/\/$/, ''),
    protocol: explicitProtocol ? url.protocol : undefined,
    kind,
  }
}

export function resolveFirewallRegistry(
  url: URL,
  custom: readonly FirewallRegistry[],
): FirewallRegistry | undefined {
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '')
  const hostCandidates = custom.filter(entry =>
    firewallRegistryHostnameMatches(
      new URL(`https://${entry.host}`).hostname,
      hostname,
    ),
  )
  const hostMatches = hostCandidates.filter(entry =>
    firewallRegistryHostMatches(entry.host, url.host),
  )
  if (hostCandidates.length && !hostMatches.length) {
    return { host: url.host, prefix: '', kind: 'block' }
  }
  const specificity = Math.max(
    ...hostMatches.map(entry =>
      entry.host.startsWith('*.') ? entry.host.length : Number.MAX_SAFE_INTEGER,
    ),
  )
  const matching = hostMatches.filter(
    entry =>
      (entry.host.startsWith('*.')
        ? entry.host.length
        : Number.MAX_SAFE_INTEGER) === specificity,
  )
  if (matching.length) {
    const entry = matching
      .filter(
        candidate =>
          (!candidate.protocol || candidate.protocol === url.protocol) &&
          (!candidate.prefix ||
            url.pathname === candidate.prefix ||
            url.pathname.startsWith(`${candidate.prefix}/`)),
      )
      .toReversed()
      .toSorted((left, right) => right.prefix.length - left.prefix.length)[0]
    return entry ?? { host: url.host, prefix: '', kind: 'block' }
  }
  const kind =
    FIREWALL_DEFAULT_REGISTRIES.get(hostname) ??
    (hostname.endsWith('.pythonhosted.org') ? 'pypi' : undefined)
  return kind ? { host: url.host, prefix: '', kind } : undefined
}
