# Preflight before the gate

Run the gate's cheap checks locally, in one pass, and fix the whole set before
invoking the gate. The slow suite runs once at the end, not on every iteration.

## The command

```bash
pnpm run preflight          # lint+format, type, dispatch drift — cheap, run it often
pnpm run preflight --tests  # adds the suite, once, before the push
```

Cheap by default on purpose: a preflight that runs the whole suite every time is
one nobody runs. Exit 0 means every stage it ran is clean and the tree is not
stale. Exit 1 lists each failed stage with its fix, together.

## What it runs, and why that list

The stages mirror `.git-hooks/_shared/push-repo-gates.mts` in the gate's own
order, so the two can be lined up by eye. Adding a gate stage means adding a row
to `STAGES` in `scripts/fleet/preflight.mts`.

| Stage | Cost | Gate function | Fix |
| --- | --- | --- | --- |
| lint + format | cheap | `scanFastChecks` | `pnpm run fix --all` |
| type | cheap | `scanTypeCheck` | resolve the error(s) |
| hook dispatch table | cheap | `scanDispatchDrift` | `node scripts/fleet/build-hook-bundle.mts` |
| test | slow, `--tests` only | the merge gate's suite | fix the failing test(s) |

A stage whose `requires` path is absent is skipped and named as "not applicable
here", never silently: a member repo has no `template/base`, so the dispatch
check has nothing to compare.

## Accumulate the cheap set, then fail fast

Two different behaviours, and the split is the point:

- **Cheap checks accumulate.** Lint, type, and drift are independent - a lint
  failure says nothing about whether types pass - so all of them run and every
  red is reported together. One pass hands over the whole cheap blocker set.
- **The slow suite fails fast.** The full suite runs ONLY when the cheap set is
  clean. Paying for it beside a lint red is the long cycle worth avoiding: its
  verdict is discarded the moment that red is fixed and everything re-runs.

`scripts/fleet/pre-push-gate.mts` encodes this as `PREPARE_STEPS` (in order, stop
at the first red, since each feeds the next), `FAST_VERIFY_STEPS` (all run,
failures collected), then `SLOW_VERIFY_STEPS` (gated behind a clean fast pass).

The git pre-push hook is a separate surface, and it already accumulates - worth
stating plainly, because assuming otherwise is what produces an iterate-on-push
loop. `.git-hooks/fleet/pre-push.mts`:

```ts
totalErrors += scanFastChecks()
totalErrors += scanDispatchDrift()
totalErrors += scanTypeCheck()
```

Every stage runs and every failure prints in one report. So when a push is
blocked, the whole blocker set is already on screen - read it all before editing
anything. Re-running the push to reveal "the next error" pays a full gate for
information you were already given.

<details>
<summary><b>The template trap</b> - why a preflight result can be meaningless, and the one ordering that fixes it</summary>

In the wheelhouse, `pnpm run type` and `pnpm test` read the **live** tree, while a
fleet-canonical edit belongs in `template/base/`. Those are different bytes until
the cascade copies one onto the other.

So a template-only edit produces results that describe the OLD code:

- a **green** that proves nothing about your change, and
- a **red** that names a file whose fix you already wrote.

The second one is the expensive failure mode: it reads exactly like a real
regression, so the natural response is to fix it again.

You cannot shortcut it by editing the live copy. Cascaded live mirrors are
`chmod 0o444` by `sync-scaffolding/fixers/mirror-mode.mts`, precisely so a stray
`cp` cannot fork them - and the cascade, the only writer, refuses while
`template/` has uncommitted changes.

That leaves exactly one order:

```bash
# 1. edit the canonical source
$EDITOR template/base/scripts/fleet/thing.mts
# 2. commit it — the cascade will not run against a dirty template/
git commit -o template/base/scripts/fleet/thing.mts -m "fix(fleet): …"
# 3. cascade template → live
pnpm run dogfood
# 4. NOW the checks describe your change
pnpm run preflight
```

`preflight` reports uncommitted `template/` sources before it runs anything and
calls the run STALE, so a passing report never gets mistaken for a verified one.

</details>

## See also

- [`code-first-then-ai`](code-first-then-ai.md) - the deterministic script is the
  primary executor.
- [`fail-fast-linter-count-is-unknowable`](fail-fast-linter-count-is-unknowable.md)
  - the neighbouring trap: a runner that does stop at the first failure, where
  the remaining count cannot be known.
- [`push-policy`](push-policy.md) - the gate itself, and monitoring CI to green.
