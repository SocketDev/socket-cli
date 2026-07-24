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
   wrapper through the npm-publish workflow, owner promotes from the staging
   UI. All eight tails must go live before the wrapper.
3. **Phase 2.** Verify installs on all eight platforms against the live
   packages, then pin exact tail versions in the wrapper.
4. **Phase 3.** Remove the `@socketbin` fallback from `install.sh` +
   `socket.js`, drop the legacy optionalDependencies, delete the
   socketaddon/socketbin templates + `scripts/repo/prepublish-socketbin.mts`,
   and npm-deprecate the frozen `@socketbin/cli-*` packages with a pointer to
   the new names.

The installer must never break mid-migration: until Phase 3 the `@socketbin`
download path stays intact and npm keeps serving the frozen binaries.

## Known constraints

- New binaries embed the frozen node-smol base `20260418-50af4c8` from
  SocketDev/socket-btm releases. SocketDev/node-smol is the successor repo but
  has no releases yet; mirror the base assets or ship the successor's first
  release before relying on new binary builds long-term.
- The fleet-mirrored publish surfaces — `scripts/fleet/util/source-allowlist.mts`,
  `scripts/fleet/util/multi-package-publish.mts`, `.github/workflows/npm-publish.yml`
  — are cascade-owned. The `@socketsecurity` scope-union + dot-terminated
  name-prefix support must land at the wheelhouse template and ride a bundle
  refresh; local edits get reverted.
- Each new tail name needs npm trusted-publisher configuration before its
  first OIDC publish.
