# provenance-publish-nudge

Stop hook that fires after a release commit, queries the npm registry
for the published version, and warns to stderr if the version is
missing provenance attestation or trusted-publisher OIDC metadata.

## Trigger

The hook activates when HEAD looks like a release commit:

- Commit subject matches `chore: bump version to vX.Y.Z` (or
  `chore(scope): release vX.Y.Z`), AND the captured version equals
  `package.json` version.
- OR HEAD has an annotated tag matching `vX.Y.Z` whose version equals
  `package.json` version.

## Action

For the resolved name@version:

1. Fetch `https://registry.npmjs.org/<name>/<version>`.
2. If 404: silent (release in flight, retry next Stop).
3. If 2xx and BOTH `dist.attestations` + `_npmUser.trustedPublisher`
   are present: silent.
4. Otherwise: warn to stderr listing the missing signals and pointing
   at `scripts/fleet/check/provenance-is-attested.mts` for follow-up.

The hook never fails the turn — Stop hooks shouldn't gate. The warning
surfaces; the operator decides what to do.

## State

`.claude/state/provenance-nudge.last` holds the last-checked
`<name>@<version>` string so a given release is checked at most once.
Bumping the version resets the throttle (different stateKey).

## Bypass

No bypass — it's a reminder (exit 0), not a block. A 404 (release in
flight) or both trust signals present already keeps it silent.

## Why this exists

Even with the canonical `scripts/fleet/npm-publish.mts --staged + --approve`
flow, an OIDC regression in CI (workflow YAML drift, missing
`id-token: write` permission, fallback to a classic token) can publish
a version without provenance. The publish workflow exits 0; nothing
visible goes wrong; the version on npm just lacks the trust metadata
that ties it back to a specific GitHub Actions run.

This hook closes that loop: every release commit is followed by a
quick registry check that confirms the trust signals landed.
