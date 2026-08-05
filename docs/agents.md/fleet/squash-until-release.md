# Squash until release

A fleet member that has **never shipped a published artifact** keeps a squashed,
single-commit history. It declares `optIns: ["squash-history"]` in the cascade
roster, and `squashing-history` flattens its default branch on a cadence. The
first published release does **not** end that — the opt-in **stays**.
`squashing-history` FREEZES: every commit through the newest published-release
commit stays byte-identical forever, and each cadence run collapses only the
unreleased TAIL above that boundary. See
[`squashing-history`'s `SKILL.md`](../../../.claude/skills/fleet/squashing-history/SKILL.md)
for the mechanism.

The gate is
`scripts/fleet/check/fresh-members-are-squashed-until-release.mts`.

## Why the release boundary is the hinge

A full-root squash rewrites every commit SHA on the default branch. Before the
first release nobody outside the repo has ever seen one of those SHAs, so
rewriting them costs nothing. After the first release, orphaning the release
commit breaks two things a consumer's lockfile or workflow can depend on:

- **SHA pins.** A `git+https://…#<sha>` dependency, a `.gitmodules` pin, a
  workflow `uses: owner/repo@<sha>` — each resolves a commit that must keep
  existing.
- **Release tags and the packument source link.** A tag points at a commit;
  npm's packument `gitHead` and the `.cargo_vcs_info.json` `git.sha1` do too.
  Orphaning it leaves `gh release view` and the packument's source link
  pointing at a tree nobody can reach from the default branch.

The Sigstore/Rekor provenance attestation itself stays cryptographically valid
either way — `npm audit signatures` verifies the attestation's signature, not
whether the commit it names is still reachable — so "provenance breaks" is
narrower than it first sounds. The pins and the source link are what actually
dangle, and freezing the release commit costs nothing to avoid, so the freeze
happens regardless.

None of this is recoverable by re-pushing. That asymmetry is why the check
fails hard when a released, opted-in member's frozen zone gets orphaned anyway,
and only warns when an unreleased member has not opted in at all.

## What counts as released

npm and crates.io — the registries a consumer's lockfile actually resolves:

- **npm:** the `name` in the member's root `package.json` resolves on the
  registry with a `latest` version. A `"private": true` manifest is skipped; it
  can never reach the registry.
- **crates.io:** any crate name declared by the member's root `Cargo.toml` or a
  `crates/*/Cargo.toml` resolves with a version. A crate setting
  `publish = false` is skipped.

Two things deliberately do **not** count:

- **A `0.0.0` reservation.** `publish-infra/{npm,cargo}/placeholder.mts`
  publishes `0.0.0` to claim a name so OIDC trusted publishing can be configured
  against it. Nothing resolves a reservation, so it leaves the window open.
- **A GitHub release.** The wheelhouse carries 20+ release bundles and
  squashes its own default branch by design. A release asset is a build output,
  not a resolved dependency, so it is not the hinge.

## The other hinge: repo visibility

The squash window is bounded by **two** events, and it closes at whichever comes
first. The check enforces the release one. The other is going public, and it is
worth understanding because it is what makes the flatten physically possible.

<details>
<summary><b>What makes the force-push possible</b> — the enterprise ruleset that rejects it, the two org custom properties that exempt a member, and the onboarding stage that sets them</summary>

`squashing-history` finishes with `git push --force-with-lease` to the default
branch. Enterprise-level rulesets apply to new SocketDev repos and are not
repo-disableable — they require a PR and a passing "Audit GHA Workflows"
workflow, which rejects that push outright. A member exempts itself through org
custom properties whose names encode the escape:

- `disable-github-actions-security=true`
- `temporarily-doesnt-touch-customers=true`

Both are set on `facts`, `scan-patterns`, and `bun-security-scanner`. A private,
pre-customer repo qualifies for both. A public repo publishing to npm with
provenance does not — and both properties are named for exactly that
impermanence.

> [!IMPORTANT]
> A freshly created fleet repo has **no** custom properties set, so
> `squashing-history` fails its final push until they are. The onboarding
> pipeline's identity stage sets them: it runs `register-fleet-member.mts`
> without `--skip-github`, which syncs the property seed right after the roster
> write. A member registered with `--skip-github` still owes that sync — re-run
> the stage.

</details>

So in practice: history is malleable while a member is **private and
unreleased**. Anyone reaching for a squash after either transition is fighting
rulesets that exist for good reason.

## The freeze boundary, resolved deterministically

"Newest published-release commit" is resolved registry-first and
ancestor-verified — never a loose local tag or bump-commit-subject match,
which can resolve into REPLACED history after a rewrite (the socket-mcp trap,
`history-rewrites.md`):

- **npm:** the packument's `versions[<latest>].gitHead` for the newest release.
- **crates.io:** `.cargo_vcs_info.json`'s `git.sha1`, via
  `scripts/fleet/crate-release-sha.mts` — do not re-derive it.
- Every candidate is accepted only when `git merge-base --is-ancestor <sha>
  <tip>` holds. A resolved anchor that fails that check is off-lineage and
  REJECTED.
- A multi-package or multi-crate member can carry several release anchors —
  the boundary is the NEWEST one across all of them that passes the ancestor
  check.
- A repo the registry confirms is published, with no ancestor-verified anchor
  at all, REFUSES the squash outright rather than silently full-flattening it.

## Precedents

| Member | State | Opt-in |
| --- | --- | --- |
| `facts` | private, unreleased | `squash-history` — squashed to one commit |
| `scan-patterns` | private, unreleased | `squash-history` — squashed to one commit |
| `bun-security-scanner` | published on npm | none today — a candidate to opt back in now that release freezes the tail instead of dropping the opt-in |

## Onboarding default

`scripts/repo/register-fleet-member.mts` applies the opt-in for you. A new
member registered with no explicit `--opt-in` defaults to
`optIns: ["squash-history"]` unless the shared release probe finds it already
published. Pass `--no-squash-history` to register a member without it, and
`--opt-in <capability>` to declare opt-ins explicitly. When the probe cannot
run, the default applies anyway and the run says so, because a brand-new
member is overwhelmingly the unreleased case. Note: the probe can't run when
offline, when `gh` is missing, or when there's no auth.

## Enforcement

- `scripts/fleet/check/fresh-members-are-squashed-until-release.mts` — the
  bidirectional gate, registered as a `releaseStep` so the interactive
  `check --all` loop stays offline. A released, opted-in member's frozen zone
  must stay reachable from its default branch (`verifyFrozenZoneReachable` —
  GitHub's compare API, the remote no-clone equivalent of `git merge-base
  --is-ancestor`); an unreleased member without the opt-in is a notice, not a
  failure. Either check reads UNVERIFIED (never a false hazard) when `gh` is
  unavailable, the anchor cannot be resolved, or the compare read fails.
- `scripts/fleet/_shared/member-release-probe.mts` — the release probe both the
  gate and the roster writer share, so the two can never disagree.
- `scripts/fleet/lib/squash-publish-guard.mts`'s `resolveFreezeBoundary` — the
  pure boundary decision `squashing-history`'s runner uses at RUNTIME, given
  the anchors and their ancestry.
- `.claude/hooks/fleet/squash-freeze-boundary-guard/` — blocks a manual
  full-root flatten (`reset --soft <root>`, `rebase --root`, a parentless
  `commit-tree`) in a repo with a likely frozen zone, pointing at the runner.
- `.claude/hooks/fleet/squash-history-nudge/` and the divergence hooks read the
  same opt-in through `.claude/hooks/fleet/_shared/fleet-roster.mts`.

See also: [`history-rewrites`](history-rewrites.md).
