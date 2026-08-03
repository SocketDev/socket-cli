# cli.exe migration — off the dead @socketbin/@socketaddon scopes

The `@socketbin/*` and `@socketaddon/*` npm scopes are decommissioned. npm
still serves the frozen `@socketbin/cli-*` binaries — last published
2025-11-03 — so existing installs keep working, but no new publish can ever
happen there. The replacement family is:

```text
@socketsecurity/cli.exe.<triplet>
```

per the fleet dot-naming grammar `@<owner>/<name>[.<lang>].<target>[-<platform>]`
with the `.exe` target and pnpm pack-app platform tails. The eight triplets:
`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-arm64-musl`, `linux-x64`,
`linux-x64-musl`, `win32-arm64`, `win32-x64`. The gate is
`scripts/fleet/check/platform-tails-match-naming-domain.mts`; the doctrine is
`docs/agents.md/fleet/binary-vs-napi-naming.md`.

## Legacy fallback mapping

Until the cli.exe tails are live and pinned, consumers fall back to the frozen
legacy names that actually contain binaries. Legacy naming used `alpine` for
musl and `win32` for Windows — the `@socketbin/cli-win-*` and
`@socketbin/cli-linux-*-musl` names that also exist on npm are empty 0.0.0
placeholders and are never targeted.

| Triplet          | Preferred                                | Fallback                    |
| ---------------- | ---------------------------------------- | --------------------------- |
| darwin-arm64     | @socketsecurity/cli.exe.darwin-arm64     | @socketbin/cli-darwin-arm64 |
| darwin-x64       | @socketsecurity/cli.exe.darwin-x64       | @socketbin/cli-darwin-x64   |
| linux-arm64      | @socketsecurity/cli.exe.linux-arm64      | @socketbin/cli-linux-arm64  |
| linux-arm64-musl | @socketsecurity/cli.exe.linux-arm64-musl | @socketbin/cli-alpine-arm64 |
| linux-x64        | @socketsecurity/cli.exe.linux-x64        | @socketbin/cli-linux-x64    |
| linux-x64-musl   | @socketsecurity/cli.exe.linux-x64-musl   | @socketbin/cli-alpine-x64   |
| win32-arm64      | @socketsecurity/cli.exe.win32-arm64      | @socketbin/cli-win32-arm64  |
| win32-x64        | @socketsecurity/cli.exe.win32-x64        | @socketbin/cli-win32-x64    |

The frozen fallbacks are pinned at `0.0.0-20251103.61247` in the `socket`
wrapper's optionalDependencies.

## Consumers

- `install.sh` — probes the cli.exe tail first, falls back to the legacy
  package, verifies npm's published integrity either way.
- `socket` wrapper — `templates/socket-package/bin/socket.js` resolves the
  preferred tail then the legacy one; optionalDependencies dual-list both
  families. Source of truth for names:
  `packages/package-builder/scripts/cli-exe-targets.mts`.
- SEA build — `packages/cli/scripts/build-sea.mts` stamps binaries into
  `packages/package-builder/build/{dev|prod}/out/cli.exe.<triplet>/bin/`.
- Prepublish — `scripts/repo/prepublish-cli-exe.mts` sets version +
  buildMethod and strips `private` before the staged publish pipeline.

## Cutover phases

1. **Phase 0 — done in this tree.** Tail scaffolds + generators under the new
   names, wrapper + installer prefer-new-fall-back-legacy, publish tooling.
   No publishes.
2. **Phase 1.** First staged publish of the eight tails + updated `socket`
   wrapper through the npm-publish-cli-exe workflow, owner promotes from the
   staging UI. All eight tails must go live before the wrapper. Runbook below.
3. **Phase 2.** Verify installs on all eight platforms against the live
   packages, then pin exact tail versions in the wrapper.
4. **Phase 3.** Remove the `@socketbin` fallback from `install.sh` +
   `socket.js`, drop the legacy optionalDependencies, delete the
   socketaddon/socketbin templates + `scripts/repo/prepublish-socketbin.mts`,
   and npm-deprecate the frozen `@socketbin/cli-*` packages with a pointer to
   the new names.

The installer must never break mid-migration: until Phase 3 the `@socketbin`
download path stays intact and npm keeps serving the frozen binaries.

## Phase 1 runbook

Everything below the owner step is wired and proven in this tree: six of the
eight tails — all but the win32 pair, see the constraint list — build from the
mirrored base assets, pass their smokes, stamp through
`prepublish-cli-exe.mts`, and pass the naming-domain gate.

### Publish surface

The cascade-owned `npm-publish.yml` stages exactly one package, the repo-root
manifest, which here is the private monorepo — it cannot carry a nine-package
family. The wired path is repo-owned instead:

- `.github/workflows/npm-publish-cli-exe.yml` — dispatch shell bound to the
  `npm-publish` environment with `id-token: write`. Generates the package
  scaffolds, builds the CLI bundle + SEA binaries from the mirrored base
  assets, stamps versions, and stages each package via `pnpm stage publish`
  with OIDC provenance. Dry-run unless `publish: true`.
- `scripts/repo/stage-publish-cli-exe.mts` — the stager it calls. Guards every
  package dir — expected name, stamped version, `private` stripped, binary or
  `bin/socket.js` present, no lingering `0.0.0-replaced-by-*` placeholders —
  then runs `pnpm stage publish --access public --no-git-checks
--ignore-scripts` from it. Staging only; approval is always a human step.

The cross-org `scripts/fleet/util/multi-package-publish.mts` stager is NOT
this path: it exists for tails built in a different repo, and its
source-allowlist schema — checked at bundle v1.0.11 — still admits only
`@socketaddon`/`@socketbin` scopes and hyphen-terminated name prefixes. The
cli.exe tails are built in-repo, so that surface is not on the Phase 1
critical path.

### Owner step — the one remaining action

Configure npm trusted publishing for each of the eight
`@socketsecurity/cli.exe.<triplet>` names, plus `socket` when it moves to this
workflow, in the npmjs.com UI:

- Publisher: GitHub Actions
- Repository: `SocketDev/socket-cli`
- Workflow: `npm-publish-cli-exe.yml`
- Environment: `npm-publish`

If the UI will not accept a trusted-publisher config for a name that has never
been published, bootstrap each tail's first version with a granular automation
token through the same staged flow, then attach the trusted publisher and
rotate the token out.

### Dispatch — tails first

```sh
gh workflow run npm-publish-cli-exe.yml \
  -f version=2.1.0 -f family=cli-exe-tails -f triplets=buildable
# dry-run staging; re-run with -f publish=true to upload for real
```

Then promote locally: `pnpm stage list`, then `pnpm stage approve <id>` per
tail with 2FA. Verify each name resolves on the registry.

### Dispatch — wrapper last

Only after every published tail is live:

```sh
gh workflow run npm-publish-cli-exe.yml \
  -f version=2.1.0 -f family=socket-wrapper -f publish=true
```

The stamp step rewrites the wrapper's `0.0.0-replaced-by-publish` cli.exe
optionalDependencies to the same version; the frozen `@socketbin/*` pins stay
put. Approve the same way. Until the win32 tails can build, the wrapper's
`@socketsecurity/cli.exe.win32-*` entries have no published versions to point
at — hold the wrapper publish until either the win32 base is fixed or the
win32 entries are dropped from the template's optionalDependencies for the
first wrapper release.

## Known constraints

- New binaries embed the frozen node-smol base `20260418-50af4c8`. The base
  assets are mirrored into socket-cli-controlled asset-carrier releases —
  `base-assets-node-smol-20260418-50af4c8` and
  `base-assets-binject-20260507-f1e66a5` on SocketDev/socket-cli — with SHA-256
  pins checked in at `packages/cli/scripts/constants/base-assets.mts`. Builds
  resolve the mirror first and fall back to the descoped SocketDev/socket-btm
  originals for one transition release. SocketDev/node-smol is the successor
  repo but has no releases yet; move the pins there once it ships.
- The fleet-mirrored publish surfaces — `scripts/fleet/util/source-allowlist.mts`,
  `scripts/fleet/util/multi-package-publish.mts`, `.github/workflows/npm-publish.yml`
  — are cascade-owned. The `@socketsecurity` scope-union + dot-terminated
  name-prefix support must land at the wheelhouse template and ride a bundle
  refresh; local edits get reverted. Verified 2026-07-24: bundle v1.0.11 does
  NOT carry it — the template still restricts `SourceAllowlistTargetScope` to
  `@socketaddon | @socketbin` and `namePrefix` to hyphen-terminated. Not a
  Phase 1 blocker, since the tails publish through the in-repo
  npm-publish-cli-exe surface, not the cross-org stager.
- The frozen `node-win-*.exe` base assets are minimal stub launchers binject
  cannot inject into — exit 252, `Cannot inject into uncompressed stub
binary` — so the win32-arm64/win32-x64 tails cannot build from this base.
  Identical bytes from mirror and source, so this predates the mirror. The
  win32 tails unblock when a node-smol release ships real Windows binaries.
- Each new tail name needs npm trusted-publisher configuration before its
  first OIDC publish.
