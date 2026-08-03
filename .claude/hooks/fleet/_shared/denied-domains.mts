/*
 * @file Single source of truth for fleet-DENIED domains — hosts that must
 *   never appear in ANY fleet surface: not a gh-aw `allowDomains` list, not a
 *   firewall / egress allowlist, not a workflow, config, script, doc, or
 *   lockfile. The opposite pole of `cdn-allowlist.mts`: that list names the
 *   public hosts a fetch MAY target; this list names hosts that are known
 *   malicious or owner-vetoed, where even a passive reference is a landmine —
 *   a good-faith engineer or agent reads the hostname as legitimate and
 *   "fixes" it into an egress grant. Every entry carries a dated reason that
 *   is shown verbatim in every enforcement message, so the WHY travels with
 *   the block instead of living in one reviewer's head.
 *
 *   Consumers, all importing THIS module so the surfaces never drift:
 *   - `denied-domain-reference-guard` — edit-time, dev machines: blocks an
 *     Edit/Write that lands a denied host into any file.
 *   - `scripts/fleet/check/denied-domains-are-absent.mts` — commit-time tree
 *     scan + wildcard-aware egress-grant scan over gh-aw locks and the fleet
 *     egress allowlist.
 *   - `scripts/fleet/check/taze-is-single-registry.mts` — the original
 *     vetoed-endpoint ruling; imports `TAZE_FAST_NPM_META_HOST` below.
 *
 *   Citing an IOC as an IOC is legitimate: a markdown file under `docs/`
 *   carrying `IOC_CITATION_MARKER` is exempt from the tree scan. Egress
 *   surfaces get NO exemption, marker or not — a denied domain in an
 *   allowlist is always red. Data + pure helpers only, no side effects, so
 *   every consumer can import this module freely.
 */

// The 2026-07 fake-Corepack campaign: a site impersonating the Node.js
// Corepack tool distributed an infostealer + proxyware. All campaign entries
// below cite this advisory.
export const FAKE_COREPACK_ADVISORY =
  'https://socket.dev/blog/fake-corepack-site-distributes-infostealer-and-proxyware'

const FAKE_COREPACK_CAMPAIGN =
  'fake-Corepack infostealer/proxyware campaign — IOC from the Socket advisory'

// The taze fast-npm-meta hosted endpoint, denied 2026-07-24 by owner ruling.
// Named export so taze-is-single-registry.mts scans for exactly this host and
// the two enforcement points can never disagree on the string.
export const TAZE_FAST_NPM_META_HOST = 'npm.antfu.dev'

// Marker a security-advisory markdown doc under docs/ carries to cite denied
// domains AS IOCs. Use it as an HTML comment near the top of the doc:
//   <!-- fleet:denied-domains:ioc-citation -->
// The exemption is deliberately narrow: markdown under docs/ only, never a
// workflow, config, or any egress surface.
export const IOC_CITATION_MARKER = 'fleet:denied-domains:ioc-citation'

export interface DeniedDomain {
  // ISO date the entry landed — so "why is this here?" has a when.
  dateAdded: string
  // Extra path exemptions beyond the global set, for an entry whose host
  // legitimately appears in a specific tracked artifact. Never consulted for
  // egress surfaces.
  exemptPathRe?: RegExp | undefined
  // The bare hostname, lowercase, no scheme.
  host: string
  // Why the host is denied, shown verbatim in every enforcement message.
  // Written so a reader who believes the host is legitimate learns why it is
  // not — do not shorten these into slogans.
  reason: string
  // The advisory or ruling the entry cites.
  source: string
}

// Sorted by host. Removing or weakening an entry is a security decision, not
// a cleanup — route it through the owner.
export const DENIED_DOMAINS: readonly DeniedDomain[] = [
  {
    dateAdded: '2026-07-26',
    host: 'aifpleasurebeh.org',
    reason: `distribution/C2 infrastructure of the ${FAKE_COREPACK_CAMPAIGN}`,
    source: FAKE_COREPACK_ADVISORY,
  },
  {
    dateAdded: '2026-07-26',
    host: 'beadpie.xyz',
    reason: `distribution/C2 infrastructure of the ${FAKE_COREPACK_CAMPAIGN}`,
    source: FAKE_COREPACK_ADVISORY,
  },
  {
    dateAdded: '2026-07-26',
    host: 'corepack.org',
    reason:
      'fake "Corepack" site impersonating the legitimate Node.js Corepack ' +
      'tool, distributing an infostealer + proxyware — the ' +
      `${FAKE_COREPACK_CAMPAIGN}. This domain READS legitimate; it is not. ` +
      'The REAL Corepack lives at github.com/nodejs/corepack and installs ' +
      'from npm as `corepack` — corepack.org has never been its home. Never ' +
      'allowlist this domain and never "correct" this entry.',
    source: FAKE_COREPACK_ADVISORY,
  },
  {
    dateAdded: '2026-07-26',
    host: 'freevpn.win',
    reason: `proxyware/VPN lure infrastructure of the ${FAKE_COREPACK_CAMPAIGN}`,
    source: FAKE_COREPACK_ADVISORY,
  },
  {
    dateAdded: '2026-07-26',
    host: 'ghabovethec.info',
    reason: `distribution/C2 infrastructure of the ${FAKE_COREPACK_CAMPAIGN}`,
    source: FAKE_COREPACK_ADVISORY,
  },
  {
    dateAdded: '2026-07-26',
    host: 'moonlighthathel.org',
    reason: `distribution/C2 infrastructure of the ${FAKE_COREPACK_CAMPAIGN}`,
    source: FAKE_COREPACK_ADVISORY,
  },
  {
    dateAdded: '2026-07-26',
    host: 'nostop.go2cloud.org',
    reason: `affiliate-tracking endpoint used by the ${FAKE_COREPACK_CAMPAIGN}`,
    source: FAKE_COREPACK_ADVISORY,
  },
  {
    dateAdded: '2026-07-24',
    // The single-registry pnpm patch legitimately carries the host in its
    // redirected-code context; the taze check holds patch/pin parity.
    // oxlint-disable-next-line socket/require-regex-comment -- documented above
    exemptPathRe: /(?:^|\/)patches\/taze@[^/]+\.patch$/,
    host: TAZE_FAST_NPM_META_HOST,
    reason:
      'taze fast-npm-meta hosted endpoint, vetoed by owner ruling: taze ' +
      'resolves versions via the CONFIGURED registry only, through the ' +
      'single-registry pnpm patch. Unpatched, every lookup leaves for this ' +
      'endpoint, fleet egress policy blocks it, and taze still exits 0 — a ' +
      'false green.',
    source: 'scripts/fleet/check/taze-is-single-registry.mts',
  },
  {
    dateAdded: '2026-07-26',
    host: 'openshield.canatrace.com',
    reason: `infostealer delivery endpoint of the ${FAKE_COREPACK_CAMPAIGN}`,
    source: FAKE_COREPACK_ADVISORY,
  },
  {
    dateAdded: '2026-07-26',
    host: 'ukankingwithea.com',
    reason: `distribution/C2 infrastructure of the ${FAKE_COREPACK_CAMPAIGN}`,
    source: FAKE_COREPACK_ADVISORY,
  },
  {
    dateAdded: '2026-07-26',
    host: 'yakteam.xyz',
    reason: `distribution/C2 infrastructure of the ${FAKE_COREPACK_CAMPAIGN}`,
    source: FAKE_COREPACK_ADVISORY,
  },
]

export interface DeniedFilename {
  // ISO date the entry landed.
  dateAdded: string
  // The exact filename, lowercase.
  name: string
  // Why the filename is denied, shown verbatim in enforcement messages.
  reason: string
  // The advisory the entry cites.
  source: string
}

// Filename IOCs — high-entropy names unique to a campaign. Deliberately NOT
// listed: OperaGXSetup.exe — a legitimate product's real installer name that
// the campaign reused; denying the string would flag innocent references, so
// its distribution domains above carry the denial instead.
export const DENIED_FILENAMES: readonly DeniedFilename[] = [
  {
    dateAdded: '2026-07-26',
    name: 'vpnsetup_d9gfqvs3dsic73fcvi90.exe',
    reason: `infostealer/proxyware dropper filename of the ${FAKE_COREPACK_CAMPAIGN}`,
    source: FAKE_COREPACK_ADVISORY,
  },
]

// Regex metacharacters to escape when embedding a hostname in a pattern.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g

/**
 * Boundary-aware matcher for one denied host: the host preceded by start of
 * text or a non-hostname character — so `evil.corepack.org` and
 * `https://corepack.org` match while `notcorepack.org` does not — and not
 * followed by a hostname character, so `corepack.organization` does not
 * match. Case-insensitive.
 */
export function deniedHostRe(host: string): RegExp {
  const esc = host.replace(RE_ESCAPE, String.raw`\$&`)
  // Boundary shape documented in the doc comment above.
  // oxlint-disable-next-line socket/require-regex-comment -- documented above
  return new RegExp(`(?:^|[^a-z0-9-])${esc}(?![a-z0-9-])`, 'i')
}

export interface DeniedDomainHit {
  // The matching denylist entry.
  entry: DeniedDomain
  // 1-based line of the first occurrence in the scanned text.
  line: number
}

export interface DeniedFilenameHit {
  // The matching filename entry.
  entry: DeniedFilename
  // 1-based line of the first occurrence in the scanned text.
  line: number
}

function lineOfIndex(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1
    }
  }
  return line
}

/**
 * Denied domains appearing in `text`, first occurrence each. `exemptEntry`
 * lets a caller skip an entry whose per-path exemption applies.
 */
export function findDeniedDomainsInText(
  text: string,
  exemptEntry?: ((entry: DeniedDomain) => boolean) | undefined,
): DeniedDomainHit[] {
  const hits: DeniedDomainHit[] = []
  for (let i = 0, { length } = DENIED_DOMAINS; i < length; i += 1) {
    const entry = DENIED_DOMAINS[i]!
    if (exemptEntry?.(entry)) {
      continue
    }
    const m = deniedHostRe(entry.host).exec(text)
    if (m) {
      // The boundary group may consume one leading character; the line of the
      // match start is what we report either way.
      hits.push({
        __proto__: null,
        entry,
        line: lineOfIndex(text, m.index),
      } as DeniedDomainHit)
    }
  }
  return hits
}

/**
 * Denied filename IOCs appearing in `text`, first occurrence each.
 * Case-insensitive substring — the names are high-entropy, so boundaries add
 * nothing.
 */
export function findDeniedFilenamesInText(text: string): DeniedFilenameHit[] {
  const hits: DeniedFilenameHit[] = []
  const lower = text.toLowerCase()
  for (let i = 0, { length } = DENIED_FILENAMES; i < length; i += 1) {
    const entry = DENIED_FILENAMES[i]!
    const idx = lower.indexOf(entry.name)
    if (idx >= 0) {
      hits.push({
        __proto__: null,
        entry,
        line: lineOfIndex(text, idx),
      } as DeniedFilenameHit)
    }
  }
  return hits
}

/**
 * True when an egress grant covers a denied host, deny-biased: the grant
 * equals the host, is a subdomain of it, is a parent domain of it — gh-aw
 * treats a bare domain as covering subdomains — or is a `*.suffix` wildcard
 * whose suffix stands in any of those relations.
 */
export function grantCoversDeniedHost(grant: string, host: string): boolean {
  const g = grant.trim().toLowerCase().replace(/^\*\./, '')
  if (!g) {
    return false
  }
  const h = host.toLowerCase()
  return g === h || g.endsWith(`.${h}`) || h.endsWith(`.${g}`)
}

export interface DeniedGrantHit {
  // The matching denylist entry.
  entry: DeniedDomain
  // The offending grant exactly as it appears in the allowlist.
  grant: string
}

/**
 * Grants from an egress allowlist that cover a denied host.
 */
export function findDeniedGrants(grants: readonly string[]): DeniedGrantHit[] {
  const hits: DeniedGrantHit[] = []
  for (let i = 0, { length } = grants; i < length; i += 1) {
    const grant = grants[i]!
    for (let j = 0, dlen = DENIED_DOMAINS.length; j < dlen; j += 1) {
      const entry = DENIED_DOMAINS[j]!
      if (grantCoversDeniedHost(grant, entry.host)) {
        hits.push({ __proto__: null, entry, grant } as DeniedGrantHit)
      }
    }
  }
  return hits
}

/**
 * One enforcement-message block for a denied entry: host, date, the verbatim
 * reason, and the advisory — so every surface explains WHY, not just WHAT.
 */
export function describeDeniedEntry(entry: DeniedDomain): string {
  return (
    `\`${entry.host}\` — denied ${entry.dateAdded}: ${entry.reason}\n` +
    `  Source: ${entry.source}`
  )
}
