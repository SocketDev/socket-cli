# Pre-commit time gate

The pre-commit hook is a **fast, changed-files-only** gate - it must never hang
or run the whole repo. A commit that stalls for minutes trains people to reach
for `--no-verify`, which is worse than a slightly-looser gate.

## The rule

- **Scope to the changed files.** `pnpm lint --staged` and `pnpm test --staged`
  act only on the staged set. `lint.mts` under `--staged` NEVER escalates to a
  full-workspace lint, even when a staged file touches an infrastructure path
  (`.config/**`, `scripts/**`, `package.json`, `tsconfig*.json`,
  `pnpm-lock.yaml`) - the whole-tree escalation net is kept for `--modified` /
  `--all` only. This matches the ≤200-line small-commit norm: a small commit
  lints/tests a handful of files in a few seconds.
- **Bound every heavy step.** Each heavy optional step runs through
  `run_pkg_step_bounded` in `.git-hooks/fleet/pre-commit`, which backgrounds the
  command in its own process group, polls in 1s ticks, and on exceeding
  `PRECOMMIT_STEP_BUDGET_S` (≤ 10s) kills the whole group (TERM then KILL) and
  fails OPEN. A real lint/test FAILURE (clean non-zero before the budget) still
  BLOCKS the commit; only a budget-exceeding HANG is skipped.

<details>
<summary><b>The other three rules</b> - skipping the pnpm wrapper and its Socket Firewall shim cost, the <code>GATE INCOMPLETE</code> banner for a step that never gated, and the whole-tree net that lives at pre-push and CI</summary>

- **Skip the package-manager wrapper.** `run_pkg_step_bounded <script>` reads the
  repo's `package.json` script body and, when it is exactly `node <path>`, runs
  that path directly under the repo-pinned node `_shared/resolve-node.sh` put on
  PATH. `pnpm` on PATH is the Socket Firewall shim - it boots the sfw proxy,
  which boots pnpm, which re-resolves the workspace - so `pnpm run <script>`
  spends seconds of a 10s budget before the script's first line. Any other body
  (`bun test`, a body with extra flags, a shell pipeline) keeps the wrapper: the
  hook must run what `pnpm run <script>` runs, never a guess. The
  `--config.verify-deps-before-run=false` flag rides only on that wrapper path;
  with pnpm out of the invocation there is no dependency pre-verification to
  disable.
- **A skipped gate must not read as a pass.** `run_step_bounded` records every
  step that failed to gate the commit - one the budget killed, and one that
  exited 0 having checked zero files (lint's `NOT a pass` verdict) - and
  `precommit_gate_summary`, the hook's last line, prints a `GATE INCOMPLETE`
  banner naming them. A commit whose gates all ran for real prints nothing extra.
- **The whole-tree net is elsewhere.** Correctness across the full workspace is
  the pre-push `--all` gate + CI, not the commit hook. Skipping a hung step at
  commit time is safe because the merge path re-runs everything.

</details>

## Enforcement

- `escalatesForScope(mode, files)` (`scripts/fleet/lint.mts`) returns `false`
  for `staged`, so the pre-commit path can't escalate; unit-tested in
  `test/repo/unit/lint.test.mts` (wheelhouse-only - the tooling ships to the
  fleet, its tests stay here).
- `scripts/fleet/check/precommit-steps-are-bounded.mts` (auto-discovered by
  `check --all`) reads `.git-hooks/fleet/pre-commit` and fails loud if a heavy
  step (the `lint` / `test` package script, in any of its three invocation forms
  - `run_pkg_step_bounded lint`, `pnpm … lint`, `node …/lint.mts`) is invoked
  bare or via the unbounded `run_step`, if either heavy step is missing
  entirely, if the hook never calls `precommit_gate_summary`, or if
  `PRECOMMIT_STEP_BUDGET_S` is missing or above the
  `PRECOMMIT_STEP_BUDGET_CAP_S` (10s) cap. Reading all three forms is what keeps
  the check from passing vacuously when the hook changes invocation style. Pure
  core unit-tested in
  `test/repo/unit/check-precommit-steps-are-bounded.test.mts` (wheelhouse-only).

## Why

The escalation net once fired on any staged `scripts/**` edit, re-linting all
~1000 files and blowing the budget - a commit that should take 3s took minutes.
Scoping `--staged` strictly to the staged files, and hard-bounding every heavy
step, keeps the commit hook fast and un-hangable while the pre-push/CI `--all`
gate keeps whole-tree correctness.
