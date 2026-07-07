---
name: diagnosing-bugs
description: Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose" / "debug this", or reports something broken, throwing, failing, or slow.
---

# diagnosing-bugs

A discipline for hard bugs. Build a **tight** loop that goes **red** on *this*
bug FIRST; everything after is mechanical. Doctrine + the fleet adaptations:
[`diagnosing-bugs.md`](../../../../docs/agents.md/fleet/diagnosing-bugs.md). Skip a
phase only with an explicit reason.

## Phase 1 — Build the loop

Construct one **named, agent-runnable** command that drives the bug code path and
asserts the user's exact symptom — a failing `pnpm test <file>`, a CLI+snapshot
diff, an `httpJson` script, a trace replay, a bisection/differential loop. Never a
throwaway harness you delete after.

Make it **tight**: fast (seconds), deterministic (pin time, seed RNG, freeze the
network with `nock`), sharp (asserts the symptom, not "didn't crash"). For a flaky
bug, raise the reproduction rate until it's debuggable.

**Completion criterion:** you can paste **one command you have already run** and
its output, and it is red-capable, deterministic, fast, and agent-runnable. If you
catch yourself reading code to build a theory before this command exists — stop.
No red-capable command, no Phase 3.

If you genuinely cannot build a loop, say so explicitly, list what you tried, and
ask for environment access / a captured artifact. Do not proceed to hypothesise.

## Phase 2 — Reproduce + minimise

Run the loop; watch it go red on the **user's** symptom (not a nearby one). Then
shrink the repro: cut inputs, callers, config one at a time, re-running after each,
until every remaining element is load-bearing. Don't proceed until reproduced AND
minimised.

## Phase 3 — Hypothesise

Generate **3–5 ranked falsifiable hypotheses** before testing any — each states a
prediction ("if X is the cause, changing Y makes it disappear"). No prediction =
a vibe; sharpen or discard. Show the ranked list to the user before testing
(cheap checkpoint; they may re-rank instantly) — but proceed on your ranking if
they're AFK.

## Phase 4 — Instrument

One variable per probe, mapped to a specific Phase-3 prediction. Prefer a
debugger/REPL over logs. Tag every debug log `[DEBUG-<hex>]` so cleanup is one
grep — never "log everything and grep". Perf bugs: measure a baseline first
(`performance.now()`, profiler, query plan), then bisect.

## Phase 5 — Fix + regression test

Write the test **before** the fix, but only at a **correct seam** — one that
exercises the real bug pattern at the call site. Fleet seam doctrine: public
interface, highest available seam, vitest in `test/` (members co-locate; wheelhouse
hook/lint-rule tests in `test/repo/`), never `node:test`, never source-text
assertions. Turn the minimised repro into a failing test, watch it fail, apply the
fix, watch it pass. If no correct seam exists, that is the finding — flag it.

## Phase 6 — Cleanup + post-mortem

`grep` out the `[DEBUG-` tags, run `pnpm run check` + `pnpm test`, commit with the
**root cause named** in the message (`fix(<scope>): <root cause>`). If this is the
second occurrence of the same shape, search the repo for siblings before closing
(variant analysis).
