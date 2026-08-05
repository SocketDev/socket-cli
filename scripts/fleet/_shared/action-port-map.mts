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
  // The upstream release tag the composite's port was last reviewed against,
  // or the BRANCH name when the upstream publishes no usable release tag.
  // Must equal the `.gitmodules` reference pin's `branch` — a vendor bump
  // without a re-port review reds `action-ports-are-lock-stepped`.
  portedAt: string
  // For a no-release-tag upstream ONLY: the exact branch commit the port was
  // reviewed against. This is the lock-step anchor in place of a tag, and it
  // is a STRONGER one — a tag names a moving-target-by-convention, a SHA names
  // the precise tree that was read. Must equal the block's `ref`.
  portedSha?: string | undefined
  // For a no-release-tag upstream ONLY: the date `portedSha` was taken,
  // `YYYY-MM-DD`. A branch pin has no version to read staleness from, so the
  // timestamp is the only signal that a port is drifting behind its upstream.
  portedOn?: string | undefined
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
  // Restore leg of the cache port: the fleet cache CLI over the first-party
  // cache-service client (scripts/fleet/cache/restore.mts) replaces
  // `uses: actions/cache/restore`.
  'cache-pnpm-store': [
    {
      portedAt: 'main',
      portedOn: '2026-08-04',
      portedSha: 'ffdc20ef9208b774c9a99db718b9b02c64d84e70',
      upstream: 'actions/toolkit',
    },
  ],
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
  // Same minter port as github-pr-app-token, narrower contents:read scope for
  // the thin-member payload fetch.
  'github-payload-app-token': [
    { portedAt: 'v3.2.0', upstream: 'actions/create-github-app-token' },
  ],
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
  // Two ports in one composite: the Install-pnpm step ports pnpm/action-setup
  // (pinned, SRI-verified binary + PATH) and the Install Node.js step ports
  // actions/setup-node (SHASUMS256-verified tarball + PATH, no NODE_AUTH_TOKEN
  // placeholder — the tokenless publish posture depends on that absence).
  setup: [
    { portedAt: 'v7.0.0', upstream: 'actions/setup-node' },
    { portedAt: 'v6.0.9', upstream: 'pnpm/action-setup' },
  ],
  // Save leg of the cache port: the fleet cache CLI over the first-party
  // cache-service client (scripts/fleet/cache/save.mts) replaces
  // `uses: actions/cache/save`.
  'setup-and-install': [
    {
      portedAt: 'main',
      portedOn: '2026-08-04',
      portedSha: 'ffdc20ef9208b774c9a99db718b9b02c64d84e70',
      upstream: 'actions/toolkit',
    },
  ],
  // Port of import-gpg's core: import key from env, extract the long key ID,
  // set user.signingkey/commit.gpgsign/user.name/user.email. Paired with
  // cleanup-git-signing — upstream does that half in its post step.
  'setup-git-signing': [
    { portedAt: 'v7.0.0', upstream: 'crazy-max/ghaction-import-gpg' },
  ],
  // Provisions the keyless on-device AI CLI (@socketsecurity/odai) — the CLI
  // wrapping and cache keying are Socket-original, and the model-cache
  // restore/save legs run the fleet cache CLIs (the actions/cache port).
  'setup-odai': [
    {
      portedAt: 'main',
      portedOn: '2026-08-04',
      portedSha: 'ffdc20ef9208b774c9a99db718b9b02c64d84e70',
      upstream: 'actions/toolkit',
    },
  ],
  // Socket-original cache wrapper over `uses: actions/cache`: cargo registry +
  // git index + each workspace's target dir, keyed on prefix + OS + rustc
  // version + Cargo.lock hashes.
  //
  // It covers the same ground as Swatinem/rust-cache and is deliberately NOT
  // declared a port of it. That upstream is LGPL-3.0, so it sits in
  // COPYLEFT_UPSTREAMS as run-and-observe-only; declaring the port here would
  // provision an `upstream/Swatinem-rust-cache` reference block whose whole
  // purpose is reading the implementation, which is the derivation the
  // copyleft boundary exists to prevent. Evolve this composite against the
  // fleet cache CLIs and its own behavior, never against that source. The
  // cache engine itself IS a declared port: the fleet cache CLIs over the
  // first-party cache-service client (scripts/fleet/cache/) replace
  // `uses: actions/cache`.
  'setup-rust-cache': [
    {
      portedAt: 'main',
      portedOn: '2026-08-04',
      portedSha: 'ffdc20ef9208b774c9a99db718b9b02c64d84e70',
      upstream: 'actions/toolkit',
    },
  ],
  // Port of the rustup surface: channel / profile / targets / components, with
  // a rustup-init fetch for images that lack it.
  //
  // Pinned to a timestamped master SHA, not a tag: dtolnay/rust-toolchain has
  // cut exactly one tag, `v1`, and MOVES it — that tag's release is dated 2022
  // while it resolves to a 2025 commit. Pinning the moving tag by its current
  // hash is worse than useless, because once the tag moves the recorded hash
  // is a commit the tag no longer reaches. Note: zizmor audits for exactly
  // that shape and calls it an impostor commit. The branch SHA below is a
  // real, reachable commit and names the exact tree the port was reviewed
  // against.
  'setup-rust-toolchain': [
    {
      portedAt: 'master',
      portedOn: '2026-07-16',
      portedSha: '2c7215f132e9ebf062739d9130488b56d53c060c',
      upstream: 'dtolnay/rust-toolchain',
    },
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
