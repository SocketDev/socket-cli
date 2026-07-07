# Diagnosing bugs

The discipline for hard bugs and performance regressions. The one rule that
matters: **build a runnable red loop FIRST — state the loop command before you
state any hypothesis.** Jumping straight to a theory is the exact failure this
discipline prevents. Run the skill `/fleet:diagnosing-bugs` to execute it;
this doc is the doctrine behind it.

Adapted from `mattpocock/skills/diagnosing-bugs`.

## The loop is the skill

If you have a **tight** pass/fail signal that goes **red** on *this* bug,
bisection, hypothesis-testing, and instrumentation all just consume it. Without
one, no amount of staring at code will save you. Spend disproportionate effort
on the loop; the rest is mechanical.

A fleet loop is a **named, agent-runnable command**, never a throwaway harness
you delete after:

- A failing **`pnpm test <file>`** at the seam that reaches the bug (the default).
- A CLI invocation diffing stdout against a known-good snapshot.
- An HTTP/`httpJson` script against a running dev server.
- A replay of a captured trace/payload through the isolated code path.
- A bisection or differential loop (old vs new, two configs) when the bug appeared
  between two known states.

**Tight** = fast (seconds), deterministic (pin time, seed RNG, freeze network with
`nock`), and sharp (asserts the user's *exact* symptom, not "didn't crash"). For a
non-deterministic bug the goal is a higher reproduction rate, not a clean repro —
loop the trigger until it's debuggable.

## The phases

1. **Loop** — build the tight red-capable command and run it at least once. No
   red-capable command, no Phase 3. This is the completion gate the skill enforces.
2. **Reproduce + minimise** — watch it go red on the *user's* symptom (not a nearby
   one); shrink to the smallest scenario where every remaining element is
   load-bearing.
3. **Hypothesise** — generate 3–5 ranked *falsifiable* hypotheses before testing
   any ("if X is the cause, changing Y makes it disappear"). A hypothesis with no
   prediction is a vibe — sharpen or discard.
4. **Instrument** — one variable per probe; prefer a debugger/REPL over logs; tag
   every debug log `[DEBUG-<hex>]` so cleanup is one grep. Perf bugs: measure a
   baseline first, then bisect — logs are usually the wrong tool.
5. **Fix + regression test** — write the test *before* the fix, but only at a
   **correct seam** (one that exercises the real bug pattern at the call site).
   Fleet seam doctrine: test through the public interface at the highest available
   seam, vitest in `test/` (members co-locate; wheelhouse hook/lint-rule tests live
   in `test/repo/`), never `node:test`, never source-text assertions. If no correct
   seam exists, that itself is the finding — flag it, don't fake confidence.
6. **Cleanup + post-mortem** — `grep` out the `[DEBUG-` tags, run `pnpm run check`
   + `pnpm test`, and **name the root cause in the commit message** (`fix(<scope>):
   <root cause>`, per fleet commit doctrine). A second occurrence of the same shape
   → search the repo for siblings (variant analysis) before closing.

## Code-first, then AI

The deterministic core is every loop run, every instrumentation pass, every
regression-test run, and the cleanup grep + check — all `pnpm`/`vitest`
invocations. AI owns only the **residue**: which loop strategy fits this bug,
where to look first, which seam is correct. See
[`code-first-then-ai`](../../../.claude/rules/fleet/code-first-then-ai.md).

## Enforcement

The skill's Phase-1 completion criterion is the procedural gate ("no red-capable
command, no Phase 3"). The Stop-time `stop-claim-verify-nudge` backstops the
related failure — claiming a fix/root-cause without a tool result that proves it.
A dedicated "hypothesis-without-loop" Stop hook was considered and rejected: a
transcript heuristic for "stated a hypothesis" is high-false-positive and
duplicates the verify-nudge. The discipline lives in the skill, enforced by its
hard completion criterion.
