# fable-fallback

`claude-fable-5` (and the `claude-mythos-5` alias) is an adaptive-only model
whose classifiers false-positive on benign security analysis work. A classifier
refusal returns a normal-looking result (`exitCode: 0`, non-empty `stdout`)
whose content is a refusal message — not an error. A caller that only reads
`exitCode` silently treats the refusal as success.

## The rule

- Every `spawnAiAgent({model:'claude-fable-5',…})` call MUST inspect
  `result.refused` / `result.servedByFallback` after the call and route to an
  Opus-4.8 fallback when either field is truthy.
- `spawnTierWithFallback('fable',…)` is exempt — it owns the fallback
  centrally. This exemption is provisional: the `refused`/`servedByFallback`
  fields on `AgentSpawnResult` are pending upstream socket-lib Step 1. Until
  that lands, the tier call is exempt by convention (guard-only).
- A Fable spawn MUST NOT set a thinking budget (`--budget-tokens`,
  `budget_tokens`, `--thinking-budget`, `thinking` key, or `effort` key on the
  call) — Fable is adaptive-only; `buildArgs` drops `--effort` for these
  models and no thinking-budget flag exists.

## Static-analysis limitations

The guard (`scripts/fleet/check/fable-spawns-have-opus-fallback.mts`) catches
literal model strings (`'claude-fable-5'`, `'fable'`). Two classes of site are
invisible to it:

- **Indirect model references** — `model: opts.updateModel` or
  `model: AI_TIER.fable.model` where the string isn't a literal. These are
  covered at runtime by the lib detecting refusals unconditionally on the Fable
  branch once Step 1 lands.
- **Stale `.refused` references** — `hasFallbackCheck` matches any `.refused`
  in the enclosing function scope, not necessarily on the result binding of
  THIS spawn. A refactored function with a leftover `.refused` check on a
  different object passes the guard. Reviewers should verify the check targets
  the correct binding.

## Detection (guard, pending lib Step 1)

The guard checks three rules:

1. `spawnAiAgent({model:'claude-fable-5',…})` result not checked for
   `result.refused` / `result.servedByFallback` in the enclosing function.
2. A Fable spawn (literal model or `spawnTierWithFallback('fable',…)`) sets a
   budget/thinking knob.
3. A hand-rolled `spawn('claude', argv)` pushes `--model claude-fable-5`
   without routing through `spawnAiAgent` / `spawnTierWithFallback`.

Exit 1 on any violation. Registered in `scripts/fleet/check.mts` adjacent to
`ai-spawns-have-paired-effort`.

## Instrumentation (pending socket-lib Step 1)

When `spawnAiAgent` gains `--output-format json` on the Fable branch:

- `AgentSpawnResult` gains `refused: boolean` (true when `stop_reason` is
  `"refusal"`) and `servedByFallback: boolean` (true when the lib retried on
  Opus-4.8).
- Callers read these fields; `spawnTierWithFallback` handles the retry
  unconditionally so its callers remain exempt.
- The static guard remains in place as a belt after the lib adds the
  suspenders.
