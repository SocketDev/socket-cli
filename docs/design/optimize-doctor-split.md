# optimize / doctor - the two-role split

Date: 2026-08-17
Status: proposed (optimize pieces landed incrementally; doctor is new)

## The two roles

**`socket doctor` - the dependency-health gate.** Diagnoses and enforces
policy. Owns the soak-time policy: every doctor run enforces a minimum
release age on the repo's package manager, so fresh-publish typosquats never
resolve. Doctor is where "fixing your security issues" lives as a policy
surface: soak-time today, trust-policy scaffolding later.

**`socket optimize` - the dependency-tree optimizer.** Owns the mechanical
improvements to the tree and the build: socket's `@socketregistry` hardened
overrides (existing), dep hoisting (new), and bundle-stub plugins when a
bundler is detectable (new). Optimize answers "make my deps smaller, fewer,
harder."

The split in one line: **doctor enforces time, optimize enforces shape.**

## What exists today (landed 2026-08-17)

- `optimize` runs: origin fast-forward (`sync-origin-main.mts`), pastoralist
  override audit (`pastoralist-audit.mts`, spawned bin), the existing
  `@socketregistry` override application, dependency update.
- `update-pnpm-workspace-yaml.mts` carries `ensurePnpmWorkspaceMinReleaseAge`
  (7-day floor, comment-preserving YAML merge). **Not yet wired** - it moves
  to doctor per this split.

## The doctor command (new)

`packages/cli/src/commands/doctor/` - first pass is deliberately small:

1. **Soak-time enforcement** (moved from the optimize draft):
   `ensurePnpmWorkspaceMinReleaseAge(repoRoot)` for pnpm repos - add at
   10080 when absent, raise when below the floor, report when already
   enforced. npm/yarn get a warning that soak-time needs pnpm (npm has no
   equivalent knob) rather than a silent pass.
2. **The practice gate** (`practice-checks.mts`, landed with the first
   chunk): workflows must run Socket somewhere (SocketDev/action, socket CLI,
   or an sfw step), and every package-manager install in package.json
   scripts and workflows must be sfw-wrapped. Violations print the exact
   file and line, and doctor exits 1 - the gate holds in CI.
3. **Report**: one summary line per policy ("soak-time: enforced at 7 days"
   / "soak-time: raised from 1 day to 7" / "soak-time: not enforceable
   under npm v10"), `--json` carries the structured form.

Later passes (not in the first chunk): trust-policy scaffolding
(`trustPolicy` + justified `trustPolicyExclude` review), stale-patch sweep
(`ERR_PNPM_UNUSED_PATCH` class), pastoralist's removal review surfacing.

## What optimize keeps / gains

1. **Socket overrides** - the existing `@socketregistry` hardened override
   flow, unchanged.
2. **Origin sync + pastoralist audit** - landed today, stays.
3. **Hoisting** (new): normalize the repo's hoisting policy - pnpm's
   `hoistPattern` / `publicHoistPattern` in `.npmrc` for repos whose tree
   duplicates across majors, using the dedupe data optimize already gathers
   via `listPackages`/`ls-by-agent`. Advisory first (report the duplicates
   with the exact hoistPattern addition), then a `--hoist` apply flag.
4. **Bundle-stub plugins when detectable** (landed today):
   `bundle-stub-offer.mts` detects rolldown/esbuild/rollup and prints the
   stub-plugin wiring with the reachability rule (stub → rebuild → test).
   "If detectable" is the contract: silent when no bundler shows.

## Command map after the split

| Command | Reads | Writes | Fails when |
| --- | --- | --- | --- |
| `socket doctor` | package manager, workspace yaml, lockfile | `minimumReleaseAge` in `pnpm-workspace.yaml` | policy unenforceable (non-pnpm) warns, exit 0 with notes |
| `socket optimize` | deps, registry, bundler config | overrides, lockfile, advisory blocks | env invalid or install fails (existing) |
| `socket fix` | CVE feed, tree | fix PRs/branches (existing) | unchanged |

## Tests

- doctor: soak add / raise / present / non-pnpm warn, YAML comment
  preservation (fixture documents with hostile formatting).
- optimize hoisting: advisory output lists real duplicates; `--hoist` writes
  the expected `.npmrc` keys.
- The bundle-stub offer: bundler detection per config file and per script
  body; silent for non-bundled repos.

## Rollout

1. doctor command with soak-time only, this plan's first chunk.
2. optimize hoisting advisory.
3. doctor trust-policy scaffolding, after the first chunk's usage data.

## Open questions

- Should doctor also run `socket scan` and fold its alerts into the report,
  or stay offline-only in the first pass? (Lean: offline; scan is a separate
  network path with its own auth.)
- Does `socket fix` eventually delegate its version selection through
  doctor's soak gate, so a CVE fix never lands on a <7-day release? (Lean:
  yes, but that is fix's change, not this one.)
