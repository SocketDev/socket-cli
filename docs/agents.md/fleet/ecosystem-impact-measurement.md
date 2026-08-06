# Ecosystem-impact measurement

Companion to the ecosystem-impact rule in `template/base/CLAUDE.md`. How to
decide which npm packages deserve a hardened drop-in, and the two measurement
traps that have each produced a confidently wrong answer.

Runner: `scripts/fleet/measure-ecosystem-impact.mts` (graph math in
`scripts/fleet/lib/ecosystem-impact.mts`), wrapped by the
`measuring-ecosystem-impact` skill.

## Two signals, neither sufficient

- **Rank** - position in `npm-high-impact`'s lists (`npmHighImpact`,
  `npmTopDependents`, `npmTopDownloads`), a catalog-pinned devDependency. This
  is ecosystem reach.
- **Cut** - what an override actually REMOVES from an install tree. A drop-in
  deletes the subtree under the package it replaces, so a port's value is the
  dependency closure it collapses, not the package's own size.

Rank alone over-values a package nothing depends on transitively. Cut alone
over-values a deep tree nobody installs. Rank the candidates, then simulate the
cut.

An override cuts a package's OUT-edges, not the package itself - consumers
still depend on it. `cutOverriddenEdges` models exactly that: the node stays,
its dependencies go to zero.

## Trap 1: a clique does not prune like a tree

Modelling the cut as "remove the leaves and the branch dies" is wrong the
moment the targets depend on each other.

Measured on the es-abstract plumbing: porting eight leaf predicates
(`is-data-view`, the `data-view-*` trio, `own-keys`, `stop-iteration-iterator`,
`is-async-function`, `es-to-primitive`) was predicted to drive the plumbing to
~0 reachable roots. It cut 29–43% - `call-bound` 14→8, `get-intrinsic` 18→12,
`get-proto` 19→13, `dunder-proto` 21→15, `math-intrinsics` 19→13, `call-bind`
2→2.

The surviving-gateway breakdown explains it. The top remaining routes to
`get-intrinsic` were `get-intrinsic` itself (24 paths), `get-proto` (13), and
`call-bound` (8). These packages are each other's gateways: a
mutually-reinforcing strongly-connected component, not a tree hanging off
prunable leaves. Consumer-side overriding cannot reach into a clique - only
overriding its members can.

<details>
<summary><b>Detail</b> - Rule</summary>

**Rule:** always report SURVIVING GATEWAYS alongside the cut percentage. A
percentage on its own invites the wrong conclusion. When a target appears in
its own surviving-gateway set, or shares a strongly-connected component with
another target, treat the group as a clique and plan direct ports of its
members.

The runner enforces this. `findTargetCliques` runs Tarjan over the graph
induced by what SURVIVED the cut, every target carries an `inSurvivingClique`
flag, and the rendered report prints the gateways and the clique verdict
directly under each percentage. A clique whose members all left the tree is not
reported - a dead cycle is not a reason to keep porting.

</details>

## Trap 2: root sets must match to compare

The cut number is meaningless without the root set it was measured from. An
early re-run of the same simulation reported `get-intrinsic` 31→25 rather than
18→12, purely because it walked every cached package instead of the original
candidate-plus-overridden root set. Nothing had regressed; the denominator had
moved.

**Rule:** record the root set with every result, and refuse to compare runs that
used different ones.

The runner makes the root set an explicit input (`--roots`, or the top
`--root-count` entries of a named `--root-list`), echoes it in
`OverrideCutReport.roots`, and prints it as the first line of every report.

## Per-target metric

Reachability is counted **per root**: how many of the roots can still reach the
target. A single whole-graph reachable-set answers "is it in the tree at all",
which stays true long after a package has decayed into a niche transitive
dependency of one root - a metric that never moves is a metric that never
informs.

## Closure resolution

Direct dependencies come from `registry.npmjs.org/<name>/latest`, walked
breadth-first with memoization and a depth cap. Three behaviors worth knowing:

- A 429 is retried with exponential backoff. A dropped package silently shrinks
  the graph and quietly inflates every cut number, so a rate limit that
  outlasts the retries fails loud instead.
- A 404 is a real leaf (unpublished or renamed), not an error.
- Hitting `--max-depth` is reported. The packages at the wall are recorded as
  truncated rather than passed off as leaves.

The resolved map is cached under the repo's runtime-state store
(`.cache/fleet/ecosystem-impact-deps.json`), never the tracked tree. `--offline`
serves the cache only and names the miss.

## Related

- socket-registry `docs/agents.md/repo/override-impact-analysis.md` - the
  repo-tier writeup this fleet topic generalizes.
- socket-registry `scripts/npm/survey-override-deps.mts` - the offline-first
  survey of existing overrides and their remaining dependencies.
