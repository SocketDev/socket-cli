---
name: building-tdd
description: Test-driven development — build a feature or fix a bug test-first. Use when the user wants test-first / red-green-refactor, or asks to build a feature with tests.
---

# building-tdd

Red-green-refactor in **vertical slices** — one test → one implementation →
repeat. The loop is `pnpm test <file>` going red then green. Seam doctrine
(public interface, highest seam, vitest, no source-text assertions, member
co-location vs wheelhouse `test/repo/`):
[`test-layout`](../../../../docs/agents.md/fleet/test-layout.md). The deterministic
core is every `pnpm test` / `pnpm run check` run; AI owns the residue — what to
test and how to name the behaviour ([`code-first-then-ai`](../../../rules/fleet/code-first-then-ai.md)).

## Never: horizontal slices

Do NOT write all tests then all implementation. Tests written in bulk verify
*imagined* behaviour — they assert the *shape* of data and signatures, pass when
behaviour breaks, and outrun your understanding. One behaviour at a time.

## 1. Plan

Establish the project's behavioural vocabulary first — `rg 'describe\(' test/ |
head -20` to see how existing tests name behaviour, so your test names match.
Then list the behaviours to test (not implementation steps) and the public
interface under test. You can't test everything — pick the critical paths.

## 2. Tracer bullet

Write ONE test for ONE behaviour at the correct seam. Name the
`pnpm test <file>` invocation. Watch it go **red**. Write the minimal code to
make it green. This proves the path end-to-end.

## 3. Incremental loop

For each remaining behaviour: RED (`pnpm test <file>` fails) → GREEN (minimal
code passes). One test at a time, only enough code to pass the current test,
don't anticipate future tests, assert observable behaviour through the public
interface — never internal structure or source text.

## 4. Refactor

Only after all tests pass. Run `pnpm run check` + `pnpm run lint`. Refactor with
the green suite as your safety net; the tests shouldn't change (they verify
behaviour, not implementation). `prefer-vitest-guard` and `no-test-in-scripts-guard`
enforce the structural rules — this skill is the procedural loop they assume.

## Completion criterion

Every chosen behaviour has a passing test that exercises it through the public
interface, `pnpm run check` is green, and no test asserts implementation detail.
