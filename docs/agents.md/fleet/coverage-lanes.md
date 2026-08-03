# Coverage lanes

Multi-language coverage rides one fleet `cover` flow, not a per-repo bespoke
script. Rust, Go, and C++ lanes are capability-gated by the top-level
`capabilities` key in `.config/repo/socket-wheelhouse.json` — declaring
`cargo`, `go`, or `cpp` there is the only wiring a repo does. Dispatch derives
from that declaration; nothing else needs touching per repo.

## The actually-used baseline

TypeScript and JS coverage is v8 (`NODE_V8_COVERAGE`) plus c8, with
`/* c8 ignore start … stop */` markers around the genuinely unreachable spans,
driven by `scripts/fleet/cover.mts`. That path is unchanged and remains the TS
norm — every rule in this doc adds native lanes alongside it, it does not
replace it. The bun lane (`scripts/fleet/cover/bun-lane.mts`) exists only for
bun-test repos and is not the model for the native lanes below; it is a
runner substitution within the same TS/JS coverage model, not a new language.

## The lane contract

Every native lane implements the `CoverageLane` shape from
`scripts/fleet/cover/lane-contract.mts`:

- `appliesTo(repoConfig)` — returns the capability's declared paths, or
  `undefined` when the repo has not declared that capability.
- `run(ctx)` — returns a `LaneResult` carrying `measured`, the line-coverage
  `summary` of covered/total/pct — the one denominator every language shares —
  a `detailPath` naming the lcov or Go coverprofile to drill into, and
  `exitCode`.

Per-language tools:

| Capability | Tool | Notes |
| --- | --- | --- |
| `cargo` | `cargo llvm-cov --lcov` | Runs through the repo's pinned toolchain so `#[cfg_attr(coverage_nightly, coverage(off))]` markers are honored — see the coverage section of [`lint-parity-across-languages`](lint-parity-across-languages.md). |
| `go` | `go test -covermode=atomic -coverprofile` | Parsed by a dep-0, statement-block-based parser; reported under the same line denominator as the other lanes. |
| `cpp` | delegates to a repo-owned build+run step | The repo builds, runs, and emits lcov, which the lane reads. |

## Never a false green

No lane reports success while measuring nothing:

- Tool absent → an explicit printed skip, never a silent pass.
- Ran but measured nothing while the capability declared paths → exit 1.

The `coverage-lanes-are-wired` check generalizes this fleet-wide: a repo that
declares a capability must have its lane active and measuring non-empty
coverage. Static wiring, meaning the lane exists and is dispatched, is always
enforced. Measurement evidence, meaning the lane actually produced non-empty
coverage, is enforced on the release/CI tier. It warns first, until
`FLEET_COVERAGE_LANES_ENFORCE` hardens it after the soak window.

## One report

The combined `coverage-summary.json` line percentage (TS lines plus native
lines) feeds the badge. Statements, branches, and functions stay TS-only
metrics, because lcov is line-based and has no equivalent for the other two.
`cover` prints a per-native-language breakdown (rust/go/cpp — the TS lane
reports through the v8/c8 summary, not this breakdown) and writes
`.cache/fleet/coverage/lane-summary.json` as the check's evidence artifact.

## Why

A 0% that exits 0 poisons the badge and the release gate the same way the
stuie incident did for a registry pin — a source that looked green was
actually broken, and nothing downstream caught it before it shipped fleet
wide. Capability-gating kills per-repo bespoke wiring: a repo says what it
has, and dispatch derives the rest, instead of each repo hand-rolling its own
Rust or Go coverage script that drifts from every other repo's.
