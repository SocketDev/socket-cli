import { fetchFirewallDecision } from './api.mts'
import {
  firewallArtifactPurls,
  isFirewallArtifactPath,
  parseFirewallArtifact,
} from './artifacts.mts'
import {
  firewallRegistryHostMatches,
  parseFirewallRegistry,
} from './registries.mts'
import {
  canonicalizeFirewallHostname,
  resolveFirewallPolicyRegistry,
} from './routing.mts'
import { FIREWALL_ENTERPRISE_ECOSYSTEMS } from './tiers.mts'
import type {
  FirewallAction,
  FirewallDecision,
  FirewallPolicy,
  FirewallPolicyOptions,
  FirewallTunneledEcosystem,
} from './types.mts'

export type {
  FirewallAction,
  FirewallDecision,
  FirewallPolicy,
  FirewallPolicyOptions,
  FirewallTunneledEcosystem,
} from './types.mts'

export function createFirewallPolicy(
  input: FirewallPolicyOptions = {},
): FirewallPolicy {
  const options = { ...input, upstreamCa: input.upstreamCa?.slice() }
  const custom = (options.customRegistries ?? []).map(parseFirewallRegistry)
  const enterprise = Boolean(
    options.apiToken && options.apiToken !== 'sfw_free',
  )
  const aliases = new Set(
    (options.localRegistryAliases ?? []).map(canonicalizeFirewallHostname),
  )
  const routing = { aliases, custom, enterprise }
  const tunneled = new Map<string, Set<string>>()
  const unknown =
    options.unknownHostAction ??
    (options.apiToken && options.apiToken !== 'sfw_free' ? 'block' : 'ignore')
  const capacity = options.cacheCapacity ?? 1024
  const timeout = options.timeoutMs ?? 30_000
  if (
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    !Number.isFinite(timeout) ||
    timeout <= 0
  ) {
    throw new RangeError(
      'Invalid firewall policy limits. Use positive cache capacity and timeout values.',
    )
  }
  const cache = new Map<
    string,
    { expires: number; decision: FirewallDecision }
  >()
  const pending = new Map<string, Promise<FirewallDecision>>()
  const controller = new AbortController()

  function actionDecision(
    action: FirewallAction,
    reason: string,
  ): FirewallDecision {
    if (action === 'warn') {
      options.onWarning?.(reason)
    }
    return { blocked: action === 'block', reasons: [reason] }
  }

  function resolveDestination(url: URL): 'inspect' | 'bypass' | 'block' {
    if (
      controller.signal.aborted ||
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return 'block'
    }
    const prefixed = custom.filter(
      entry =>
        firewallRegistryHostMatches(entry.host, url.host) && entry.prefix,
    )
    if (url.pathname === '/' && prefixed.length) {
      return 'inspect'
    }
    const registry = resolveFirewallPolicyRegistry(url, routing)
    if (!registry) {
      return resolveUnknownDestination(url)
    }
    return registry.kind === 'block'
      ? 'block'
      : registry.kind === 'bypass'
        ? 'bypass'
        : 'inspect'
  }

  function resolveUnknownDestination(url: URL): 'bypass' | 'block' {
    const recorded =
      !enterprise && unknown !== 'block' && recordTunneledEcosystem(url)
    if (unknown === 'warn' && !recorded) {
      options.onWarning?.(`Unconfigured firewall destination: ${url.host}`)
    }
    return unknown === 'block' ? 'block' : 'bypass'
  }

  async function checkPurl(purl: string): Promise<FirewallDecision> {
    const cached = cache.get(purl)
    if (cached && cached.expires > Date.now()) {
      cache.delete(purl)
      cache.set(purl, cached)
      return cached.decision
    }
    const existing = pending.get(purl)
    if (existing) {
      return existing
    }
    if (pending.size >= capacity) {
      return actionDecision(
        'block',
        'Firewall policy request capacity exceeded.',
      )
    }
    const promise = fetchFirewallDecision(
      purl,
      options,
      AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]),
    )
      .then(decision => {
        if (cache.size >= capacity) {
          const oldest = cache.keys().next().value
          if (oldest !== undefined) {
            cache.delete(oldest)
          }
        }
        cache.set(purl, { expires: Date.now() + 60_000, decision })
        for (const reason of decision.reasons ?? []) {
          if (reason.startsWith('warn:')) {
            options.onWarning?.(`${purl}: ${reason}`)
          }
        }
        return decision
      })
      .catch(error =>
        actionDecision(
          controller.signal.aborted ||
            (typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === 'ERR_FIREWALL_API_AUTH')
            ? 'block'
            : (options.failAction ?? 'block'),
          `Firewall policy could not evaluate ${purl}.`,
        ),
      )
      .finally(() => pending.delete(purl))
    pending.set(purl, promise)
    return promise
  }

  async function checkRequest(
    url: URL,
    method: string,
  ): Promise<FirewallDecision> {
    const destination = resolveDestination(url)
    if (destination === 'block') {
      return { blocked: true, reasons: ['Firewall destination is blocked.'] }
    }
    if (destination === 'bypass') {
      return { blocked: false }
    }
    const registry = resolveFirewallPolicyRegistry(url, routing)
    if (!registry || registry.kind === 'block') {
      return { blocked: true }
    }
    if (registry.kind === 'bypass' || registry.kind === 'wrap') {
      return { blocked: false }
    }
    const pathname = url.pathname.slice(registry.prefix.length) || '/'
    const artifact = parseFirewallArtifact(registry.kind, pathname)
    if (!artifact) {
      return {
        blocked: Boolean(isFirewallArtifactPath(registry.kind, pathname)),
        reasons: ['Artifact URL cannot be parsed.'],
      }
    }
    if (method !== 'GET' && method !== 'HEAD') {
      return {
        blocked: true,
        reasons: ['Artifact request method is unsupported.'],
      }
    }
    const purls = firewallArtifactPurls(artifact)
    const decisions = await Promise.all(purls.map(checkPurl))
    const decision = {
      blocked: decisions.some(result => result.blocked),
      reasons: decisions.flatMap(result => result.reasons ?? []),
    }
    options.onDecision?.(purls[0]!, decision)
    return decision
  }

  function close(): void {
    if (controller.signal.aborted) {
      return
    }
    controller.abort()
    cache.clear()
    pending.clear()
    const ecosystems = getTunneledEcosystems()
    if (ecosystems.length) {
      options.onWarning?.(
        `Traffic tunneled without package scanning: ${ecosystems.map(entry => `${entry.ecosystem} (${entry.hosts.join(', ')})`).join('; ')}.`,
      )
    }
  }

  function getTunneledEcosystems(): FirewallTunneledEcosystem[] {
    return [...tunneled]
      .map(([ecosystem, hosts]) => ({
        __proto__: null,
        ecosystem,
        hosts: [...hosts].toSorted(),
      }))
      .toSorted((left, right) => left.ecosystem.localeCompare(right.ecosystem))
  }

  function recordTunneledEcosystem(url: URL): boolean {
    const hostname = canonicalizeFirewallHostname(url.hostname)
    const ecosystem = FIREWALL_ENTERPRISE_ECOSYSTEMS.get(hostname)
    if (!ecosystem) {
      return false
    }
    const hosts = tunneled.get(ecosystem) ?? new Set<string>()
    hosts.add(hostname)
    tunneled.set(ecosystem, hosts)
    return true
  }

  return { checkRequest, resolveDestination, close, getTunneledEcosystems }
}
