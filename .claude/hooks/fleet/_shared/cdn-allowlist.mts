/**
 * @file Single source of truth for "is this a fleet-approved CDN / package
 *   registry host?" — shared by the cdn-allowlist-guard Claude hook
 *   (PreToolUse, blocks a fetch/download to an off-allowlist host) and the
 *   commit-time check, so the two never drift (code is law, DRY).
 *
 *   The allowlist holds ONLY public package-registry and public CDN hosts —
 *   the canonical registries every ecosystem advertises (crates.io, pypi.org,
 *   …) plus the browser CDNs a front-end's CSP already exposes. These are
 *   public knowledge, so the list is not sensitive: it is an allowlist, not a
 *   secret, and the enforcement (not the secrecy of the list) is the value.
 *
 *   🚨 NEVER add an internal host here. A naive `https://` grep of a Socket
 *   service repo surfaces `*.svc.cluster.local` Kubernetes service names
 *   (artifact-search, github-interposer, metadata, nats, pgbouncer,
 *   pipeline-gateway, svix, typosquat, …). Those are infra topology — a
 *   public-surface-hygiene violation if committed. Seed this list from the
 *   typed ecosystem-registry CONSTANTS that name fetch targets, never from a
 *   blanket URL grep, and keep it to public registries / public CDNs only.
 */

import { findInvocation } from './shell-command.mts'

// Public package-registry + download hosts the fleet's tooling legitimately
// fetches from (seeded from depscan's ecosystem registry constants). Public
// knowledge; all are canonical registries. Sorted alphabetically.
export const ALLOWED_CDN_HOSTS: readonly string[] = [
  'bower.io',
  'chromewebstore.google.com',
  'clojars.org',
  'conda-forge.org',
  'cran.r-project.org',
  'crates.io',
  'deno.land',
  'elpa.gnu.org',
  'forge.puppet.com',
  'formulae.brew.sh',
  'github.com',
  'hackage.haskell.org',
  'hex.pm',
  'hub.docker.com',
  'huggingface.co',
  'juliahub.com',
  'metacpan.org',
  'npmjs.org',
  'nuget.org',
  'open-vsx.org',
  'package.elm-lang.org',
  'packagist.org',
  'pkgs.racket-lang.org',
  'proxy.golang.org',
  'pub.dev',
  'pypi.org',
  'repo1.maven.org',
  'rubygems.org',
  'swiftpackageindex.com',
  'vcpkg.io',
]

// Public CDN hosts a fleet front-end's CSP exposes (wildcard subdomains).
// Public-by-design (sent in browser response headers). `*.` matches any
// subdomain depth of the suffix.
export const ALLOWED_CDN_WILDCARDS: readonly string[] = [
  '*.apicdn.sanity.io',
  '*.api.sanity.io',
  '*.cloudfront.net',
  '*.githubusercontent.com',
  '*.jsdelivr.net',
  '*.unpkg.com',
]

// True when `hostname` exactly matches an allowed host, or matches an allowed
// wildcard suffix (`*.example.com` matches `a.example.com` and
// `a.b.example.com`, but not the bare `example.com`). Compares
// case-insensitively. Pass a bare hostname, not a URL.
export function isAllowedCdnHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  for (let i = 0, { length } = ALLOWED_CDN_HOSTS; i < length; i += 1) {
    if (host === ALLOWED_CDN_HOSTS[i]) {
      return true
    }
  }
  for (let i = 0, { length } = ALLOWED_CDN_WILDCARDS; i < length; i += 1) {
    const suffix = ALLOWED_CDN_WILDCARDS[i]!.slice(1)
    if (host.endsWith(suffix) && host.length > suffix.length) {
      return true
    }
  }
  return false
}

// Extract the hostname from a URL string, or undefined when it doesn't parse.
export function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

// Find the first http(s) URL in a Bash command whose host is NOT allowed,
// returning { url, host }. Used by the guard. Only flags fetch/download tools
// (curl / wget / fetch) so unrelated URL mentions don't trip it. AST-matched
// binary detection (no regex on the command), then a URL scan of the string.
export interface DisallowedCdnHit {
  url: string
  host: string
}

const FETCH_BINARIES: readonly string[] = ['curl', 'wget', 'fetch', 'http', 'https']

const URL_RE = /https?:\/\/[^\s"'`)>\]]+/g

export function findDisallowedCdn(command: string): DisallowedCdnHit | undefined {
  let invokesFetch = false
  for (let i = 0, { length } = FETCH_BINARIES; i < length; i += 1) {
    if (findInvocation(command, { binary: FETCH_BINARIES[i]! })) {
      invokesFetch = true
      break
    }
  }
  if (!invokesFetch) {
    return undefined
  }
  const matches = command.match(URL_RE)
  if (!matches) {
    return undefined
  }
  for (let i = 0, { length } = matches; i < length; i += 1) {
    const url = matches[i]!
    const host = hostnameOf(url)
    if (host && !isAllowedCdnHost(host)) {
      return { url, host }
    }
  }
  return undefined
}
