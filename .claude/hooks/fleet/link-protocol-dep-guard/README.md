# link-protocol-dep-guard

PreToolUse Edit/Write hook that blocks adding an unpinned dependency
spec — a `link:`/`file:` local path, or a `workspace:` range — to any
dependency block of a `package.json`.

## Why

**A `link:` means a package needs publishing.** The spec points a
dependency at a local path, which carries no registry identity and no
integrity hash. The install resolves to whatever happens to sit at that
path on the machine running it, and on a fresh clone — CI, a new
contributor, a release runner — to nothing at all. The reason the path
is there is almost always that the package it names is **unpublished**,
so the fix is release work: reserve the name and wire trusted publishing
(`scripts/fleet/publish-infra/{npm,cargo}/placeholder.mts`,
`cargo/trusted-publisher.mts`), then depend on the published version.

A `workspace:` range has the same floating problem inside the repo:
`workspace:*` and `workspace:^1.2.3` resolve to whichever sibling
version the tree happens to carry, and pnpm expands the range at publish
time into a range every consumer inherits.

The fleet's preference order among the pinned forms is **`catalog:` >
exact `1.2.3` > `workspace:1.2.3`** — a catalog entry pins just as hard
and one central bump upgrades every repo, where the other two cost a
manifest bump per dependent on each release. Full order, the blocked
forms, and the `peerDependencies` exemption:
[`dependency-spec-pinning`](../../../../docs/agents.md/fleet/dependency-spec-pinning.md).

The worked example for the rarer glob case is decmpfs: five `link:`
entries shipped in the committed `pnpm-lock.yaml` pointing at
`napi/decmpfs/npm/<triple>/`, which are **gitignored generated output**.
The lockfile depended on artifacts absent from a fresh clone, and it
went unnoticed for weeks.

## What it blocks

An Edit/Write to a `package.json` that ADDS (or changes the value of) a
`link:`/`file:` spec or a `workspace:` range in any of:

    dependencies
    devDependencies
    optionalDependencies
    peerDependencies
    overrides            (walked recursively — overrides nest)
    resolutions          (walked recursively)
    pnpm.overrides       (walked recursively)

An existing spec left untouched by the edit does not block; the hook
diffs before-vs-after and reports only what the edit introduces.

## What it does NOT block

- `catalog:` — PREFERRED. A catalog entry is itself exact-pinned in
  `.config/fleet/pnpm-workspace.fleet.yaml`, so `catalog:` pins as hard
  as a literal version while keeping one central bump site.
- An exact registry version (`1.2.3`, `npm:alias@1.2.3`).
- `workspace:1.2.3` — legal, and a FALLBACK rather than a destination.
  The check reports these under a "prefer `catalog:`" heading as the
  conversion backlog; it never fails on them, because a repo whose
  sibling is unpublished has nowhere else to go.
- A git or tarball URL.
- A bare registry range (`^1.2.3`, `>=5.0.0`). These are **classified**
  as `registry-range` and reported by the companion check, but not
  blocked while the fleet's remaining bare ranges convert.
  `isBlockingSpecKind` in `_shared/dependency-spec-forms.mts` is the
  seam that flips it on. `peerDependencies` stay exempt permanently: a
  peer range states the span of host versions a package supports.

## The gap this hook cannot close

In decmpfs the `link:` specs were **never hand-written**. pnpm generated
them: `pnpm-workspace.yaml` declared a `packages:` glob
(`napi/decmpfs/npm/*`) over generated directories, and with
`linkWorkspacePackages: true` pnpm resolved the matching
`optionalDependencies` to `link:` specs in the lockfile. No manifest
edit happened, so no edit-time guard could ever have fired.

That case is caught by the companion commit-time gate,
`scripts/fleet/check/dependency-specs-are-registry-or-workspace.mts`,
which scans the committed `pnpm-lock.yaml` and fails when a `link:`
target is not a git-tracked directory. The two tiers together are the
rule: this hook stops the hand-written spec, the check stops the
generated one.

## Bypass

Type the canonical phrase in a new message:

    Allow link-protocol-dep bypass

Legitimate case: a throwaway local reproduction, or a test fixture whose
whole point is to exercise local-path resolution. Neither belongs in a
committed manifest without a reason stated in review.

## Detection

Parses before+after JSON, classifies every spec through the shared
`_shared/dependency-spec-forms.mts` module (the same classifier the
check uses, so the two tiers cannot drift), keys each finding
`<field>.<dependency name>`, and reports the set difference. Fails open
on JSON parse errors.

## Fix

```jsonc
// package.json

{
  "dependencies": {
    // PREFERRED — published package, centrally pinned in the fleet
    // catalog (.config/fleet/pnpm-workspace.fleet.yaml):
    "typescript": "catalog:",
    // Published package that does not belong in the fleet-wide catalog:
    "defu": "6.1.6",
    // FALLBACK — an in-repo package that genuinely cannot be published.
    // List its directory under `packages:` in pnpm-workspace.yaml, then
    // pin it exactly. Publish it and move to `catalog:` when you can:
    "my-in-repo-pkg": "workspace:1.2.3",
  },
}
```

Generated per-platform output (a napi `npm/<triple>/` directory) is not
a workspace member. Keep its glob out of `packages:` and let the publish
engine find those packages by convention instead.
