import type { FirewallDecision } from './policy/index.mts'

export function createFirewallReport() {
  const decisions = new Map<string, FirewallDecision>()
  let truncated = false
  return {
    __proto__: null,
    record(purl: string, decision: FirewallDecision): void {
      if (decisions.get(purl)?.blocked) {
        return
      }
      if (!decisions.has(purl) && decisions.size >= 10_000) {
        truncated = true
        return
      }
      const reasons = decision.reasons
        ?.slice(0, 32)
        .map(reason => reason.slice(0, 512))
      if (
        (decision.reasons?.length ?? 0) > 32 ||
        decision.reasons?.some(reason => reason.length > 512)
      ) {
        truncated = true
      }
      decisions.set(purl, {
        blocked: decision.blocked,
        ...(reasons ? { reasons } : {}),
      })
    },
    snapshot() {
      return {
        __proto__: null,
        packages: [...decisions].map(([purl, decision]) => ({
          __proto__: null,
          purl,
          decision,
        })),
        truncated,
      }
    },
  }
}
