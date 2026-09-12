export type FirewallEcosystem =
  | 'npm'
  | 'pypi'
  | 'golang'
  | 'maven'
  | 'gem'
  | 'cargo'
  | 'nuget'
export type FirewallAction = 'block' | 'warn' | 'ignore'
export type FirewallRegistryKind =
  | FirewallEcosystem
  | 'wrap'
  | 'bypass'
  | 'block'

export interface FirewallArtifact {
  name: string
  type: FirewallEcosystem
  version?: string | undefined
  qualifiers?: Record<string, string> | undefined
}

export interface FirewallDecision {
  blocked: boolean
  reasons?: string[] | undefined
}

export interface FirewallPolicyOptions {
  localRegistryAliases?: readonly string[] | undefined
  apiToken?: string | undefined
  customRegistries?: readonly string[] | undefined
  failAction?: FirewallAction | undefined
  unknownHostAction?: FirewallAction | undefined
  fetch?: typeof globalThis.fetch | undefined
  timeoutMs?: number | undefined
  cacheCapacity?: number | undefined
  onWarning?: ((message: string) => void) | undefined
  upstreamProxy?: string | undefined
  upstreamCa?: string[] | undefined
  onDecision?: ((purl: string, decision: FirewallDecision) => void) | undefined
}

export interface FirewallPolicy {
  getTunneledEcosystems(): FirewallTunneledEcosystem[]
  resolveDestination(url: URL): 'inspect' | 'bypass' | 'block'
  checkRequest(url: URL, method: string): Promise<FirewallDecision>
  close(): void
}

export interface FirewallTunneledEcosystem {
  ecosystem: string
  hosts: string[]
}
