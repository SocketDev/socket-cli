# fleet-doctor

`scripts/fleet/doctor.mts` — a cascade-resident health check that diagnoses and
repairs onboarding gaps that break `pnpm install` in a fleet member but that the
sync-scaffolding cascade does not catch.

## Gap classes

### Gap 1 — catalog-reference-without-entry (auto-fixable)

A workspace package.json declares `"<dep>": "catalog:"` (or
`"catalog:<named>"`) without a matching entry in the repo's
`pnpm-workspace.yaml` `catalog:` block. pnpm rejects the install with
`ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC`.

Root cause: some catalog names are optional fleet names — version-locked only
when the dep is present, never injected by the cascade. A repo can therefore
carry the dependency reference without the catalog entry.

Auto-fix: the doctor resolves the version from the cascaded fleet catalog
(`pnpm-workspace.fleet.yaml`) — its `catalog:` block (fleet-canonical names)
and `catalogOptional:` block (optional names like `rolldown` and `vite`) — and
splices the entry into `pnpm-workspace.yaml` sorted, using `spliceCatalogEntry`.

If the dep is not a known fleet catalog name, or the ref targets a named
catalog, the doctor reports the gap with the exact fix the operator must apply.
It never guesses a version.

### Gap 2 — soak-window install failure (report-only)

After catalog gaps are fixed, `pnpm install` can still fail with
`ERR_PNPM_NO_MATURE_MATCHING_VERSION` when a (transitive) dep resolves within
the 7-day `minimumReleaseAge` soak window and is not in
`minimumReleaseAgeExclude`.

The doctor reports these loud with:

- The exact annotated bullet to add to `pnpm-workspace.yaml`.
- The `pnpm view <name> time --json` command to get the publish date.
- A note that the durable fleet-wide fix is updating the wheelhouse's canonical
  release-age annotation source and re-cascading.

The trust gate (`minimumReleaseAge`) is wheelhouse-owned and review-gated. The
doctor never auto-applies soak excludes.

## Version source

`pnpm-workspace.fleet.yaml` — cascaded byte-identical from the wheelhouse to
every fleet member. Two blocks:

- `catalog:` — fleet-canonical names (present in every repo).
- `catalogOptional:` — optional names (`rolldown`, `vite`); version-locked when
  present, never injected by the cascade.

`loadOptionalCatalogEntries()` in `scripts/repo/sync-scaffolding/manifest/catalog.mts`
reads the `catalogOptional:` block as its version source of truth.

## Run modes

| Command | Effect |
| --- | --- |
| `node scripts/fleet/doctor.mts` | Diagnose only. No FS writes, no network. Exit 1 if any finding. |
| `node scripts/fleet/doctor.mts --fix` | Auto-fix Gap 1 (catalog entries). Run probe install if fixes were applied. |
| `node scripts/fleet/doctor.mts --probe-install` | Run probe install unconditionally. |
| `pnpm run fix --all` | Runs `doctor --fix` automatically after deterministic fixers, before AI. |

## Exit contract

- Exit 0: no findings, or all fixable findings were applied and no unfixed
  findings remain.
- Exit 1: any unfixed finding (including fixable-but-unapplied in diagnose
  mode, and report-only soak findings).

## Findings format

Each finding uses the four-ingredient error format:

```text
What:  <short phrase describing the problem>
Where: <file path or config key>
Saw:   <what was observed vs. what is required>
Fix:   <actionable fix, multi-line if needed>
```

## Why soak is report-only

The soak-exclude annotation source
(`scripts/repo/sync-scaffolding/manifest/release-age-annotations.mts`) is
wheelhouse-owned and review-gated. A member-side auto-add would desync the
canonical annotation source and weaken the trust gate. The doctor will promote
to auto-fix if and when the annotation source becomes a cascaded artifact.
