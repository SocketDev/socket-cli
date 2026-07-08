# Code first, then AI

A codified procedure's **deterministic script is the primary executor**. AI is a
fallback the script explicitly hands off to — never the primary path, never a
substitute for running (or fixing) the script.

## The rule

- **Run the script, don't hand-do it.** If an operation has a script — release
  bump + CHANGELOG (`bump.mts`), gh-aw action-pin sync (`sync-gh-aw-action-pins.mts`),
  cascade (`sync-scaffolding`), lint-fix (`pnpm run fix`), lockfile regen — run
  that script. Do not perform the operation by hand or with an AI step the script
  already owns.

- **A script must fail LOUD, never false-green.** A reconcile / sync / generate
  script that can't resolve must exit non-zero with What / Where / Saw-vs-wanted /
  Fix — never report success or silently no-op. A silent green strands the
  operator into hand-fixing and bypassing guards. (This is not hypothetical: the
  registry-pin sync reported "all pins match" while pointing a repo at a reusable
  workflow socket-registry's own CI said was broken — shipping red CI fleet-wide
  for two weeks. The fix was a green-gate that fails loud on a red source.)

- **AI only where the script cedes.** `ai-lint-fix` runs `lint --fix` (deterministic
  oxlint autofix) first and spawns AI only for the custom `socket/*` rules oxlint
  can't autofix. That ordering — deterministic first, AI for the residue — is the
  shape every AI-assisted pipeline takes.

- **Don't hand-format around a failing codegen step.** When a generator's own
  self-format / self-lint step throws (a shim quirk, a cwd-quoting bug under
  `execSync`), surface or fix THAT invocation — never hand-run
  `prettier` / `oxfmt` / `eslint` to paper over it. A format step that fails on
  one machine ships unformatted output on *every* machine where it fails; the
  hand-run hides the latent bug instead of fixing it (and a hand-run on a
  pre-commit/husky-cleaned repo only works by luck). The deterministic fix is to
  repair the generator's format call — point it at the local binary, tolerate the
  shim — not to format by hand. `no-direct-linter-guard` blocks a direct
  `prettier` / `eslint` / `cargo fmt` (and runner-wrapped `yarn prettier` /
  `pnpm exec prettier`) inside a fleet repo, where the pnpm/script wrappers own
  formatting. It is a CONVENTION guard, so it no-ops in a non-fleet repo — there
  the native binary (or the project's own script) is the sanctioned path, and the
  repo's own CI, not a fleet hook, owns the format gate.

- **Don't hand-edit a script-owned artifact** to dodge a wrong script. Registry
  pins, `CHANGELOG.md`, the lockfile, and generated output are owned by their
  scripts (and guarded: `no-hand-edit-registry-pin-guard`, `changelog-is-commit-derived`,
  `dirty-lockfile-nudge`). If the script is wrong, **fix the script** — bypassing
  the guard to hand-edit is the anti-pattern this rule exists to stop.

## Why

When a deterministic path exists, exhaust it before deferring to AI. AI is
non-deterministic, unreproducible run-to-run, and (as a release/cascade executor)
exactly where hand-fumbling creeps in. Code that works the same in CI and locally
is the contract; AI fills the gaps code explicitly leaves.
