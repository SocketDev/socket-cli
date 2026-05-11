# Bundle-trim scan

Identifies unused module paths the rolldown bundler statically pulls into `dist/` but that the runtime never reaches. Reports candidates only — does NOT mutate the repo. The active trim loop (stub → rebuild → tests pass → keep) lives in the `trimming-bundle` skill.

## Mission

For each repo that ships a rolldown bundle, look at `dist/index.js` (or the primary entry) and compare the set of statically-resolved imports against the set of imports actually reachable from the published API surface. The delta is the candidate set — modules the bundler kept that the runtime can't reach.

## Inputs

- `dist/` — the most recent build output. If missing or stale, the scan flags "build first" and skips.
- `.config/rolldown.config.mts` — required (signal that this repo uses rolldown).
- `.config/rolldown/lib-stub.mts` — required (the canonical plugin the trim skill uses). If missing, the scan flags "cascade missing canonical plugin" and skips.
- `src/index.ts` (or the entry declared in `package.json` `exports`) — the published API surface.

## Skip when

- `.config/rolldown.config.mts` doesn't exist (repo doesn't use rolldown).
- `.config/rolldown/lib-stub.mts` doesn't exist (cascade gap; surface as a separate finding).
- `dist/` doesn't exist (run `pnpm build` first; surface as a separate finding).

## Method

1. **Survey resolved imports**: `rg --no-heading "from '@socketsecurity/lib/[^']+'" dist/` — list of every lib subpath the bundle imported.
2. **Survey published surface**: read `src/index.ts` (or `package.json` `exports`-pointed entry) end-to-end and collect every transitively-reached lib subpath. Walk re-exports.
3. **Compute delta**: subpaths in (1) but not in (2) are candidates.
4. **Verify reachability claim** (cheap pass; the trim skill does the deep verification before stubbing): for each candidate, `rg --no-heading "<subpath-name>" src/` should return zero hits in src. Hits mean the subpath IS reached and the candidate is a false positive.
5. **Estimate size impact**: `du -b dist/<file>` for the heaviest candidates.

## Output shape

```
### Bundle Trim

Bundle: dist/index.js (current size: <N> KB)
Plugin status: createLibStubPlugin imported (current stubPattern: /<regex>/)

Candidates (sorted by size, heaviest first):
- @socketsecurity/lib/<subpath> — <KB> potential savings
  Reason: imported by bundle, not reached from src/index.ts
  Verify: src/ has zero hits for `<subpath-name>`
  Confidence: HIGH | MEDIUM | LOW
  Action: hand to trimming-bundle skill for stub loop

If 0 candidates:
  ✓ No unreachable lib subpaths detected. Bundle is tree-shaken cleanly.
```

Confidence levels:

- **HIGH** — subpath is in the import survey, has zero hits in `src/`, and the trim skill's Phase 3 verify would pass.
- **MEDIUM** — subpath is in the survey, has hits in `src/` but only inside files that aren't reached from the entry. The trim skill needs to walk the reachability graph to confirm.
- **LOW** — subpath is in the survey but the static analysis is ambiguous. Skip in the report or leave for manual investigation.

## When to escalate

If candidates total >50KB and the repo is npm-published (consumers bear the bundle weight), prioritize handing off to the `trimming-bundle` skill before the next release. Bundle bloat is a quality issue users feel.

## Cross-references

- `trimming-bundle` skill — the active trim loop. This scan reports; that skill mutates.
- `.config/rolldown/lib-stub.mts` — the canonical plugin. Both scan and skill require it to exist.
- `socket-packageurl-js/docs/rolldown-migration.md` — worked example of bundle-size baseline tracking.
