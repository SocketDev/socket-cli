---
name: measuring-ecosystem-impact
description: Rank npm packages by ecosystem reach and model what overriding them actually removes from the install tree.
user-invocable: true
allowed-tools: Bash(node:*), Bash(pnpm run:*), Read, Grep, Glob
model: claude-sonnet-4-6
context: fork
metadata:
  internal: true
---

# measuring-ecosystem-impact

Decide which npm packages deserve a hardened drop-in, and how much an override actually buys. All the work is in `scripts/fleet/measure-ecosystem-impact.mts` — this skill exists to run it and to stop the two misreadings that make its output dangerous.

## When to invoke

- Choosing the next wave of `@socketregistry/*` ports.
- Justifying (or retiring) an existing override: what does it still remove?
- Any claim of the form "porting X will collapse Y" — measure before asserting.

## Skip when

- The question is "is this package popular" alone. That is a rank lookup, not a cut simulation.
- There is no network and no populated cache (`.cache/fleet/ecosystem-impact-deps.json`). Run once online first.

## Run it

```bash
node scripts/fleet/measure-ecosystem-impact.mts --help

# Rank + cut for a candidate set, given what is already overridden.
node scripts/fleet/measure-ecosystem-impact.mts \
  --targets get-intrinsic,call-bound,get-proto,dunder-proto,math-intrinsics \
  --overridden is-data-view,own-keys,es-to-primitive \
  --root-count 250

# Machine-readable, for a report or a diff between waves.
node scripts/fleet/measure-ecosystem-impact.mts --targets <list> --json
```

## Reading the result — the two traps

🚨 **A cut percentage is not a verdict.** Read SURVIVING GATEWAYS first. When a target's own siblings are the live routes into it, the group is a clique: consumer-side overriding can never empty it, and only porting its members will. The script flags those groups; do not report a percentage without them.

🚨 **Root sets must match to compare.** Every result prints the root set it was measured from. Two runs over different root sets produce incomparable numbers — re-walking a wider set once turned a stable `18→12` into `31→25` and read as a regression that never happened. Record the root set with the number, and refuse the comparison when they differ.

Both traps, and the measured es-abstract case that produced them, are written up in `docs/agents.md/fleet/ecosystem-impact-measurement.md`.

## Report the finding

State, in this order: the root set, the rank, the before→after with the percentage, the surviving gateways, and the clique verdict. A finding missing the gateways or the root set is not reportable.
