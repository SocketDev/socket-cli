# Preflight before the gate

A gate is a **backstop**, not a discovery tool. Run the checks it runs, locally,
in one pass, and fix the whole set before you invoke it.

## The rule

- **Never use `git push` (or CI) as your error-discovery loop.** Run
  `pnpm run preflight` first: lint+format, type, and hook-dispatch drift, with
  **every** failure reported together. Discovering them one push at a time pays a
  full gate run per error plus a network round trip.

- **Accumulate the cheap checks, fail fast before the slow one.** The cheap
  checks are independent, so all of them run and the whole cheap blocker set
  arrives in one pass. The full suite (`--tests`, and `cover` in the gate) runs
  ONLY when that set is clean - every run being a full run is not workable, and a
  suite verdict gathered beside a lint red is discarded the moment the red is
  fixed and everything re-runs.

- **The gate was never hiding anything.** `.git-hooks/fleet/pre-push.mts`
  accumulates (`totalErrors += scanFastChecks()` … `+= scanTypeCheck()`); it does
  not stop at the first failing stage. So "the gate only told me one thing at a
  time" is not a real explanation for an iterate-on-push loop - the errors were
  reported, just at the most expensive moment. Read the whole block it prints
  before changing anything.

- **A `template/` edit is unverifiable until it cascades.** `pnpm run type` and
  `pnpm test` read the LIVE tree; a fleet-canonical edit lands in
  `template/base/`. Until the cascade copies it across, every result about that
  edit describes the OLD code - a green that means nothing, or a red that sends
  you re-fixing a file you already fixed. The live mirrors are `chmod 0o444`
  (`sync-scaffolding/fixers/mirror-mode.mts`), so the cascade is the only way to
  move them, and the cascade refuses while `template/` is dirty. The order is:
  edit template → commit → `pnpm run dogfood` → verify. `preflight` reports
  dirty template sources first and calls the run STALE rather than letting the
  numbers look meaningful.

- **When a gate does block, harvest it.** Read every line of the report, list
  the failures, then fix them as one batch. Re-running the gate to see what is
  next is the anti-pattern.

## Enforcement

- `pnpm run preflight` (`scripts/fleet/preflight.mts`) is the deterministic
  executor, per [`code-first-then-ai`](code-first-then-ai.md): one command, the
  whole set, one report.
- `preflight-before-push-nudge` (PreToolUse Bash) fires on a `git push` with no
  same-session preflight receipt. Non-blocking - a push after a read-only turn
  is legitimate - but it names the command.

## Why

Measured in one session: five push attempts to land one change, each surfacing
one more error, every cycle paying the full gate. The same set was available
locally the entire time for the cost of a single run. The template trap made it
worse - two of those cycles were spent re-fixing files whose fix was already
committed but not yet cascaded, so the checks were reading stale bytes.

The cost is asymmetric and that is the whole argument: one local pass is minutes,
and an iterate-on-push loop multiplies that by the number of mistakes you made,
which is exactly the number you cannot know up front.
