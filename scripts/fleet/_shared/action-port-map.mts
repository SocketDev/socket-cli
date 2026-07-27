/**
 * @file The composite → upstream PORT MAP — the machine-checkable record of
 *   which third-party GitHub Action each `.github/actions/fleet/*` composite
 *   PORTS, and the upstream release tag that port was last reviewed against.
 *   The record is TOTAL: every composite has an entry, and a Socket-original
 *   composite declares `[]` so a NEW composite that omits its mapping fails
 *   `action-ports-are-lock-stepped` rather than landing silently unpinned.
 *   Consumers: `vendor-actions.mts` derives its vendored-upstream list from
 *   `portedUpstreams()`, so declaring a port here IS what provisions the
 *   `upstream/<owner>-<repo>` reference block; the check enforces the inverse
 *   direction — every declared port has a pinned, sha256-stamped block whose
 *   tag equals `portedAt`. Bumping a reference pin therefore goes red until the
 *   composite is re-reviewed against the upstream diff and `portedAt` is
 *   advanced with it — that is the lock-step.
 *   Doctrine: docs/agents.md/fleet/upstream-references.md.
 */

export interface CompositePort {
  // The ported upstream as `<owner>/<repo>`, e.g. `softprops/action-gh-release`.
  upstream: string
  // The upstream release tag the composite's port was last reviewed against.
  // Must equal the `.gitmodules` reference pin's tag — a vendor bump without a
  // re-port review reds `action-ports-are-lock-stepped`.
  portedAt: string
}

// One key per `.github/actions/fleet/*` composite — template/base plus the
// template/conditional overlays. `[]` = Socket-original, no upstream ported.
// A composite that merely `uses:` an upstream directly is NOT a port — its pin
// is owned by the `uses:`-pin machinery, not this map.
export const COMPOSITE_ACTION_PORTS: Readonly<
  Record<string, readonly CompositePort[]>
> = {
  // Socket-original helper scripts: SRI tool fetch/verify, jq.mjs, platform.mjs.
  _shared: [],
  // Wrapper, not a port: the cache engine stays `uses: actions/cache/restore`.
  'cache-pnpm-store': [],
  // Inline git-fetch port of the checkout surface: ref / working-directory /
  // fetch-depth / persist-credentials=false / the pull_request merge ref.
  checkout: [{ portedAt: 'v7.0.1', upstream: 'actions/checkout' }],
  // Port of import-gpg's post-run cleanup: delete the imported key by
  // fingerprint, kill gpg-agent, unset the git signing config.
  'cleanup-git-signing': [
    { portedAt: 'v7.0.0', upstream: 'crazy-max/ghaction-import-gpg' },
  ],
  // Socket-original DEBUG/SOCKET_DEBUG normalizer.
  debug: [],
  // Port of the RS256 JWT → installation → scoped access-token mint flow;
  // inputs client-id/private-key/owner/repositories mirror the upstream.
  'github-pr-app-token': [
    { portedAt: 'v3.2.0', upstream: 'actions/create-github-app-token' },
  ],
  // Port of the gh-release surface over the gh CLI: tag/title/notes/notes-file/
  // assets ≈ tag_name/name/body/body_path/files, draft-assemble-then-publish.
  'github-release': [
    { portedAt: 'v3.0.2', upstream: 'softprops/action-gh-release' },
  ],
  // Same minter port as github-pr-app-token, narrower contents:write scope.
  'github-release-app-token': [
    { portedAt: 'v3.2.0', upstream: 'actions/create-github-app-token' },
  ],
  // Socket-original githubstatus.com component probe.
  'github-status-check': [],
  // Socket-original: pnpm install + lib floor gate + agentshield provisioning.
  install: [],
  // Socket-original network-off gate via unshare.
  'run-offline': [],
  // Socket-original setup+main script runner.
  'run-script': [],
  // The Install-pnpm step ports pnpm/action-setup: pinned, SRI-verified pnpm
  // binary download + PATH. Node itself stays `uses: actions/setup-node`.
  setup: [{ portedAt: 'v6.0.9', upstream: 'pnpm/action-setup' }],
  // Aggregator: ports nothing itself, `uses: actions/cache/save` directly.
  'setup-and-install': [],
  // Port of import-gpg's core: import key from env, extract the long key ID,
  // set user.signingkey/commit.gpgsign/user.name/user.email. Paired with
  // cleanup-git-signing — upstream does that half in its post step.
  'setup-git-signing': [
    { portedAt: 'v7.0.0', upstream: 'crazy-max/ghaction-import-gpg' },
  ],
}

// Split an `<owner>/<repo>` slug; undefined when the shape is wrong. Pure.
export function splitSlug(
  slug: string,
): { owner: string; repo: string } | undefined {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(slug)
  return m ? { owner: m[1]!, repo: m[2]! } : undefined
}

// The `upstream/<owner>-<repo>` reference-submodule name for a slug — the
// naming rule the existing `upstream/actions-<name>` blocks already follow.
// Pure.
export function upstreamSubmoduleName(slug: string): string {
  const parts = splitSlug(slug)
  return parts
    ? `upstream/${parts.owner}-${parts.repo}`
    : `upstream/${slug.replace(/\//g, '-')}`
}

// Every distinct upstream slug the port map declares, sorted. Pure.
export function portedUpstreams(
  portMap: Readonly<
    Record<string, readonly CompositePort[]>
  > = COMPOSITE_ACTION_PORTS,
): string[] {
  const slugs = new Set<string>()
  const portLists = Object.values(portMap)
  for (let i = 0, { length } = portLists; i < length; i += 1) {
    const ports = portLists[i]!
    for (let j = 0, portCount = ports.length; j < portCount; j += 1) {
      slugs.add(ports[j]!.upstream)
    }
  }
  return [...slugs].toSorted()
}
