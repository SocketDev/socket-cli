---
name: writing-fast-tests
description: Writing or reviewing tests, or a slow suite: pick the cheapest seam, keep files parallel-safe.
metadata:
  internal: true
---

# writing-fast-tests

A slow suite is a suite people skip. The fleet budget is **under a minute for
the unit tier**, hard-capped at `vitest.unitBudgetMs` (180s default); past that
`cover.mts` warns every 180s and tells you to investigate rather than wait.

Order of preference, cheapest first: **in-process call → shared fixture →
parallel file → isolated run.** Reach for the next one only when the previous
one genuinely cannot express the behaviour.

This skill covers how to make a suite fast. What an assertion may say is a
separate contract — assert outcomes and exit codes rather than message prose,
never re-implement the logic under test, never scan source text. See
[`test-layout`](../../../../docs/agents.md/fleet/test-layout.md) → "What to
assert". A fake for I/O is right; a fake for LOGIC defeats the test.

## 1. Default to the in-process seam

Import the module and call its exported function. Spawning the same code as a
child process to assert the same logic is the single most expensive mistake in
the fleet's suites.

Measured on `no-tail-install-out-guard` (socket-wheelhouse, 2026-07-30):

| Seam | Cost per call |
|---|---|
| `spawn(node, [hook])` + JSON on stdin | **136 ms** |
| `import` + `findOffendingPipe(cmd)` | **0.002 ms** |

That is ~68,000×. One cover run captured **2454 spawned children**; at 136 ms
each that is ~334 s of process boot, roughly 78% of a 430 s unit run.

So: export the pure decision function and assert against it. A hook, a CLI, and
a codemod all have one — if yours doesn't, that's the refactor.

```ts
// Fast: the matcher is a pure function of its input.
const r = await check(bashPayload('pnpm i | tail -5'))
assert.equal(r?.kind, 'block')
```

## 2. Keep exactly one spawn as a wiring smoke test

Spawning is right for what only a real process shows: **exit codes, stdio
framing, signal handling, env isolation, argv parsing**. Prove the wiring once
per file, then assert every remaining behaviour in-process.

```ts
// One spawn proves stdin→stderr→exit 2 is wired. The other 68 specs don't respawn.
test('subprocess: blocks with exit 2', async () => {
  const { code, stderr } = await runHook(bashPayload('pnpm i | tail -5'))
  assert.equal(code, 2)
  assert.match(stderr, /Blocked/)
})
```

If a file has N spawns for N assertions, collapse it: keep one, convert the rest.

## 3. Share expensive setup, never per-test

Build a fixture repo, parse a config, or compile an artifact **once per file**
at module scope or in `beforeAll` — not in `beforeEach`. A `git init` per test
is a spawn per test wearing a different hat.

Share read-only fixtures freely. Only deep-copy when a test mutates one, and
prefer designing the test not to mutate.

## 4. Stay parallel-safe by default

vitest runs files in parallel workers. Most "flaky under parallel" is a test
reaching for a shared global. Keep files independent:

- **Temp dirs**: `mkdtempSync(path.join(os.tmpdir(), 'my-fixture-'))` — never a
  fixed path two files can both claim.
- **Ports**: bind `:0` and read back the assigned port — never a constant.
- **cwd**: pass `{ cwd }` to the call; never `process.chdir` (banned fleet-wide —
  it is process-global, so it corrupts every other worker in flight).
- **Env**: pass env into the function; never mutate `process.env` and hope.
- **Git**: fixtures build their own repo + bare origin on disk so `git ls-remote`
  resolves locally with no network, and import the `isolate-git-env` side-effect
  first so inherited git vars can't leak onto the live `.git/config`.

## 5. Isolate only when you have proven contention

`describe.sequential`, a `--no-file-parallelism` file, or a dedicated tier is a
real cost — it serializes what the machine could overlap. Justify it with a
named shared resource (one git index, a singleton, a fixed socket), and write
that resource into a comment. "It felt flaky" is not a justification; find the
shared state instead.

Genuinely heavy suites — external spec suites, cross-impl parity, built-artifact
checks — do not belong in the unit tier at all. List their globs under
`vitest.conformanceExclude` in `.config/repo/socket-wheelhouse.json` and pair
them with a `test:conformance` runner.

## 6. Never let the network or a real clock in

`no-unmocked-net-guard` and `no-unmocked-ai-guard` block live calls, and a
network round trip dwarfs everything above. Mock at the boundary. Fake timers
beat `await sleep(500)` — a sleep is dead wall-clock in every future run.

## Reviewing an existing slow suite

1. Rank files by spawn count:
   `for f in $(rg -l 'spawn\(' test/); do echo "$(rg -c 'spawn\(' $f) $f"; done | sort -rn | head`
2. For the top files, ask per spawn: *does this assert process behaviour, or
   just logic?* Convert the logic ones.
3. Re-measure. Report the before/after wall clock — a speedup claim needs a
   receipt like any other.

## Completion criterion

The unit tier finishes under a minute, no file spawns a child to assert
behaviour an exported function already decides, every shared fixture is built
once, and any sequential/isolated run names the resource that forced it.

## Handoffs

[building-tdd](../building-tdd/SKILL.md) for the red-green loop this feeds,
[updating-coverage](../updating-coverage/SKILL.md) for coverage gaps, and
[test-layout](../../../../docs/agents.md/fleet/test-layout.md) for seam and
placement doctrine.
