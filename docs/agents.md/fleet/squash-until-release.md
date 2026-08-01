# Squash until release

A fleet member that has **never shipped a published artifact** keeps a squashed,
single-commit history. It declares `optIns: ["squash-history"]` in the cascade
roster, and `squashing-history` flattens its default branch on a cadence. The
first published release ends that: the opt-in comes **off**, and the member
keeps ordinary history from then on.

The gate is
`scripts/fleet/check/fresh-members-are-squashed-until-release.mts`.

## Why the release boundary is the hinge

A squash rewrites every commit SHA on the default branch. Before the first
release nobody outside the repo has ever seen one of those SHAs, so rewriting
them costs nothing. After the first release, three things point at them and
break:

- **npm / crates.io provenance.** A provenance-attested version binds the
  published tarball to the exact source commit it was built from. Orphan that
  commit and the attestation resolves to nothing.
- **SHA pins.** A `git+https://…#<sha>` dependency, a `.gitmodules` pin, a
  workflow `uses: owner/repo@<sha>` — each resolves a commit that must keep
  existing.
- **Release tags.** A tag points at a commit. Squashing leaves the tag dangling
  off the rewritten branch, so `gh release view` links a tree nobody can reach
  from `main`.

None of this is recoverable by re-pushing. That asymmetry is why the check fails
hard on a released member that still carries the opt-in, and only warns on an
unreleased member that does not.

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
- **A GitHub release.** `socket-wheelhouse` carries 20+ release bundles and
  squashes its own default branch by design. A release asset is a build output,
  not a resolved dependency, so it is not the hinge.

## The other hinge: repo visibility

The squash window is bounded by **two** events, and it closes at whichever comes
first. The check enforces the release one. The other is going public, and it is
worth understanding because it is what makes the flatten physically possible.

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
> A freshly created fleet repo has **no** custom properties set, and nothing in
> the onboarding path sets them. Setting both is a manual onboarding step today;
> until it is automated, `squashing-history` will fail its final push on a
> brand-new member. Wiring it into `register-fleet-member.mts` (or
> `onboard-fleet-member.mts`) is the natural follow-up.

So in practice: history is malleable while a member is **private and
unreleased**. Anyone reaching for a squash after either transition is fighting
rulesets that exist for good reason.

## Opting out at first release

The roster's two copies are kept paired by `fleetRosterPaths`, so edit the seed
and cascade:

1. Remove `"squash-history"` from the member's `optIns` in
   `template/base/.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json`.
   Drop the `optIns` key entirely when it becomes empty.
2. Cascade to the live mirror:
   `node scripts/repo/sync-scaffolding/cli.mts --target . --fix`.
3. Commit both copies together. A split leaves the readers disagreeing about
   whether a diverged default branch is expected.

Do it as part of the first release, not after. Between the publish and the
opt-out removal, a `squashing-history` run is legal-looking and destructive.

## Precedents

| Member | State | Opt-in |
| --- | --- | --- |
| `facts` | private, unreleased | `squash-history` — squashed to one commit |
| `scan-patterns` | private, unreleased | `squash-history` — squashed to one commit |
| `bun-security-scanner` | published on npm | none — history is load-bearing |

## Onboarding default

`scripts/repo/register-fleet-member.mts` applies the opt-in for you. A new
member registered with no explicit `--opt-in` defaults to
`optIns: ["squash-history"]` unless the shared release probe finds it already
published. Pass `--no-squash-history` to register a member without it, and
`--opt-in <capability>` to declare opt-ins explicitly. When the probe cannot
run — offline, no `gh`, no auth — the default applies anyway and the run says
so, because a brand-new member is overwhelmingly the unreleased case.

## Enforcement

- `scripts/fleet/check/fresh-members-are-squashed-until-release.mts` — the
  bidirectional gate, registered as a `releaseStep` so the interactive
  `check --all` loop stays offline.
- `scripts/fleet/_shared/member-release-probe.mts` — the release probe both the
  gate and the roster writer share, so the two can never disagree.
- `.claude/hooks/fleet/squash-history-nudge/` and the divergence hooks read the
  same opt-in through `.claude/hooks/fleet/_shared/fleet-roster.mts`.

See also: [`history-rewrites`](history-rewrites.md).
