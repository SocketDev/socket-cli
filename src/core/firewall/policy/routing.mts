import {
  FIREWALL_DEFAULT_REGISTRIES,
  firewallRegistryHostnameMatches,
  resolveFirewallRegistry,
} from './registries.mts'
import {
  FIREWALL_ENTERPRISE_ECOSYSTEMS,
  FIREWALL_ENTERPRISE_INFRASTRUCTURE,
  FIREWALL_FREE_INFRASTRUCTURE,
} from './tiers.mts'
import type { FirewallRegistry } from './registries.mts'

export function canonicalizeFirewallHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '')
}

export function resolveFirewallPolicyRegistry(
  url: URL,
  config: {
    aliases: ReadonlySet<string>
    custom: readonly FirewallRegistry[]
    enterprise: boolean
  },
): FirewallRegistry | undefined {
  const opts = { __proto__: null, ...config } as typeof config
  const hostname = canonicalizeFirewallHostname(url.hostname)
  if (hostname === 'eu-central-1-1.aws.cloud2.influxdata.com') {
    return { host: url.host, prefix: '', kind: 'block' }
  }
  const registry = resolveFirewallRegistry(url, opts.custom)
  const custom = opts.custom.some(entry =>
    firewallRegistryHostnameMatches(
      new URL(`https://${entry.host}`).hostname,
      hostname,
    ),
  )
  if (custom) {
    return registry
  }
  if (FIREWALL_DEFAULT_REGISTRIES.has(hostname) && opts.aliases.has(hostname)) {
    return undefined
  }
  if (registry) {
    return registry
  }
  const allowed = opts.enterprise
    ? FIREWALL_ENTERPRISE_ECOSYSTEMS.has(hostname) ||
      FIREWALL_ENTERPRISE_INFRASTRUCTURE.has(hostname)
    : FIREWALL_FREE_INFRASTRUCTURE.has(hostname)
  return allowed ? { host: url.host, prefix: '', kind: 'bypass' } : undefined
}
