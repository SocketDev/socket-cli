import { isObject } from '@socketsecurity/lib-stable/objects/predicates'
export const FIREWALL_REBIND_ORIGIN = 'https://registry.npmjs.org'

export function firewallRebindTarget(raw: string): URL {
  const target = new URL(raw, FIREWALL_REBIND_ORIGIN)
  if (
    target.origin !== FIREWALL_REBIND_ORIGIN ||
    target.username ||
    target.password ||
    target.hash ||
    target.search
  ) {
    throw new Error('Unsupported vlt registry URL')
  }
  return target
}

export function rewriteFirewallRegistryMetadata(
  value: unknown,
  register: (target: URL) => string,
): void {
  if (!isObject(value) || Array.isArray(value)) {
    throw new Error('Invalid vlt registry metadata')
  }
  const object = value
  const dist = object['dist']
  if (isObject(dist) && !Array.isArray(dist)) {
    const distribution = dist
    if (typeof distribution['tarball'] !== 'string') {
      throw new Error('Invalid vlt tarball URL')
    }
    const target = firewallRebindTarget(distribution['tarball'])
    if (!target.pathname.endsWith('.tgz')) {
      throw new Error('Unsupported vlt tarball URL')
    }
    distribution['tarball'] = register(target)
  }
  const versions = object['versions']
  if (
    versions !== null &&
    typeof versions === 'object' &&
    !Array.isArray(versions)
  ) {
    const entries = Object.values(versions)
    for (let index = 0, length = entries.length; index < length; index++) {
      rewriteFirewallRegistryMetadata(entries[index], register)
    }
  }
}
