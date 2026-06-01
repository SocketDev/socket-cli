---
name: trimming-bundle
description: For repos that ship a built bundle, finds unused code paths in dist/ and iteratively stubs them via the bundler's stub plugin. Each candidate stub goes through stub → rebuild → test loop; only paths that pass the loop are kept. Today the only supported bundler is rolldown (createLibStubPlugin); the skill shape generalizes to other bundlers if the fleet adopts them. Use after a bundler migration, before publishing a new version, or whenever bundle size grows unexpectedly.
user-invocable: true
allowed-tools: Read, Edit, Grep, Glob, AskUserQuestion, Bash(pnpm:*), Bash(node:*), Bash(grep:*), Bash(rg:*), Bash(find:*), Bash(ls:*), Bash(wc:*), Bash(du:*), Bash(stat:*), Bash(git status:*), Bash(git diff:*)
---

# trimming-bundle

Iteratively stub heavyweight modules that the bundler statically pulls in but the runtime never reaches. Apply on repos that ship a built bundle. Today: rolldown only (socket-packageurl-js, socket-sdk-js; any repo with `.config/rolldown.config.mts`). The skill is named generically because the dead-path-stubbing pattern applies to any bundler; today the only fleet bundler is rolldown.

## When to invoke

- After the rolldown migration lands (replacing esbuild); the static-analyzer behavior differs and unused-path detection needs a fresh pass.
- Before publishing a new version where bundle size matters (npm-published packages).
- When `dist/index.js` grows by more than ~10% between releases without a corresponding feature addition.
- As a follow-up step after `scanning-quality` flags `bundle-trim` candidates (the quality scan reads dist/ but doesn't mutate it; this skill does the trim loop).

## Skip when

- The repo doesn't build a rolldown bundle (no `.config/rolldown.config.mts`).
- The bundle is consumed by code that uses dynamic feature detection (rare; flagged by the rolldown plugin's `moduleSideEffects: false` annotation).
- Tests aren't running (`pnpm test` fails before any trim). Fix tests first; trim depends on the test signal.

## Required: rolldown/lib-stub.mts

🚨 This skill **REQUIRES** `.config/rolldown/lib-stub.mts` to be present and to export `createLibStubPlugin`. The file is fleet-canonical (cascades from `socket-wheelhouse/template/.config/rolldown/lib-stub.mts` via sync-scaffolding) and must NOT be edited locally per the no-fleet-fork rule.

Before doing anything else:

```bash
[ -f .config/rolldown/lib-stub.mts ] || {
  echo "ERROR: .config/rolldown/lib-stub.mts is missing."
  echo "Cascade it from socket-wheelhouse:"
  echo "  cd /Users/<user>/projects/socket-wheelhouse &&" # socket-hook: allow cross-repo
  echo "  node scripts/sync-scaffolding/cli.mts --target <this-repo> --fix"
  exit 1
}
```

If the file is missing, STOP and run the cascade. Do NOT inline a copy of the plugin. It must be the fleet-canonical version.

Verify the rolldown config imports it:

```bash
grep -q "createLibStubPlugin" .config/rolldown.config.mts || {
  echo "ERROR: .config/rolldown.config.mts doesn't import createLibStubPlugin."
  echo "Add: import { createLibStubPlugin } from './rolldown/lib-stub.mts'"
  echo "And: plugins: [createLibStubPlugin({ stubPattern: /...regex.../ })]"
  exit 1
}
```

## Inputs

- `dist/`: the most recent build output (run `pnpm build` first if missing or stale).
- `.config/rolldown.config.mts`: already imports `createLibStubPlugin` from `.config/rolldown/lib-stub.mts` (fleet-canonical; cascaded via sync-scaffolding).
- `pnpm test`: must pass at start; the trim loop's signal is "tests still pass after stub."

## Process

### Phase 1: Baseline

```bash
pnpm build
ls -lah dist/
pnpm test
```

Record:

- Current bundle size (sum of `dist/*.js`).
- Current test pass count.
- Any pre-existing test failures (do NOT proceed if tests were already failing; fix first).

### Phase 2: Identify candidates

Read `dist/index.js` (or the primary entry) and grep for module imports / requires. The static analyzer keeps modules that are statically reachable from any export. Candidates for stubbing are modules whose entire surface area is:

- **Touch-only**: imported but never called via the published API (e.g. `globs` imported by a deprecated helper that's no longer in the entry chain).
- **Dev-only**: present because of a side-effect import that doesn't matter at runtime (e.g. node:fs/promises pulled in by a build-time helper).
- **Conditional-dead**: behind a flag that the published bundle never sets (e.g. `if (DEBUG_MODE)` where DEBUG_MODE is `false` in the build).

How to identify, in priority order:

1. **Heuristic**: `rg "from '@socketsecurity/lib/(globs|sorts|http-request|.*)'" dist/`. Note which lib subpaths show up. Cross-reference against published API surface (`src/index.ts` exports). Anything imported by the bundle that's not transitively reached from `src/index.ts` is a candidate.
2. **Bundle size scan**: `du -bc dist/*.js | sort -rn | head -10`. Identifies the largest bundle outputs. If `dist/index.js` is unexpectedly large, the heaviest unused dep is usually the culprit.
3. **Plugin echo**: temporarily set `verbose: true` (if added) on `createLibStubPlugin` to log every resolved module. The list of resolved paths NOT under your repo's src/ is the candidate set.

For each candidate, record:

- The absolute resolved path or path-pattern (`/.../@socketsecurity/lib/dist/globs.js`).
- The size impact (run `du -b` on the file).
- The reason the runtime can't reach it.

### Phase 3: Verify reachability claim

🚨 Stubbing a file that IS reached at runtime gives runtime crashes, not bundle-time errors. Verify each candidate before stubbing:

```bash
# 1. Search the published API surface for direct imports.
rg --no-heading "from .*<candidate-name>" src/

# 2. Search transitively reachable code for indirect imports.
rg --no-heading "<candidate-name>" src/

# 3. Confirm the candidate is NOT reached from any test.
rg --no-heading "<candidate-name>" test/
```

If any of these find a hit, the candidate is reachable; skip it. Only candidates with zero hits across all three queries proceed to Phase 4.

### Phase 4: Stub one candidate

Edit `.config/rolldown.config.mts` to extend the `stubPattern` regex:

```ts
const stubPattern = /(?:globs|sorts|<new-candidate>)\.js$/
```

Pattern matches the absolute resolved path. Use the file's basename or a unique path fragment, whichever's stable across pnpm hoisting.

Then:

```bash
pnpm build
pnpm test
```

Three outcomes:

- **Tests pass + bundle smaller** → keep the stub. Move to next candidate.
- **Tests pass + bundle same size** → the stub didn't trigger; the regex doesn't match the resolved path. Inspect the build output to see why (run with `--logLevel debug`), adjust the pattern, retry.
- **Tests fail** → the candidate IS reached. Revert the stub. The Phase 3 verification missed an import path; investigate.

Iterate one candidate at a time. Multi-candidate stubs make failure attribution painful; keep the loop tight.

### Phase 5: Document the kept stubs

For each candidate that survived the loop, add a one-line comment in the `stubPattern` definition explaining WHY it's safe to stub (which import path it's on, why runtime never reaches it). Future maintainers need to know the chain of reasoning, not just the regex.

### Phase 6: Verify

```bash
pnpm build
pnpm test
pnpm exec oxlint
pnpm exec tsgo -p tsconfig.check.json
```

All four must pass before committing.

### Phase 7: Commit

```bash
git add .config/rolldown.config.mts
git commit -m "perf(bundle): stub <N> unused lib internals (<size> saved)"
```

The commit message states the count + size delta. If the trim is significant (say >50KB), also update `docs/rolldown-migration.md` with the new baseline.

## Reference

- `.config/rolldown/lib-stub.mts`: fleet-canonical plugin (cascade via sync-scaffolding; never edit locally per the no-fleet-fork rule).
- `docs/rolldown-migration.md`: repo-specific (in repos that ran the migration). Records baseline numbers from before/after the esbuild → rolldown switch.
- `socket-packageurl-js/.config/rolldown.config.mts`: the worked example of `createLibStubPlugin` use, with a populated `stubPattern`.

## Companion: scanning-quality

The `bundle-trim` scan in `scanning-quality/scans/bundle-trim.md` runs the discovery half of this skill (Phase 1–3) and reports candidates. It does NOT mutate the repo. Use this skill for the actual trim loop.

## Failure modes

- **Tests pass but the stubbed dep is dynamically required at runtime via `await import()`**: the static analyzer flags it as unreachable but the runtime path needs it. Add the dep back to the entry's static imports OR remove the dynamic import.
- **The `stubPattern` matches more paths than intended**: too-broad regex. Tighten to a specific basename or a unique path segment. The plugin matches against the absolute resolved path, so `node_modules/.pnpm/@socketsecurity+lib@.../dist/globs.js` is what you're matching.
- **Bundle size grows after a stub**: the empty-CJS replacement is heavier than the dependency's tree-shaken form. Check the rolldown output: usually means the dep was already mostly tree-shaken and the stub overhead exceeds what's saved.
