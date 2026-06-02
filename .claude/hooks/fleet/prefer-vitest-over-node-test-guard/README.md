# prefer-vitest-over-node-test-guard

PreToolUse hook that blocks `node --test <file>` Bash commands and steers to the fleet-canonical test runner.

## What it catches

`node --test` runs the Node.js built-in test runner. Fleet repos use **vitest**. The two runners are incompatible — test files register with vitest globals, not `node:test`'s API, so `node --test` produces silent passes or "No test suite found" failures.

## What it suggests

```sh
# Run a specific test file (preferred — scoped to your change):
pnpm exec vitest run path/to/your.test.mts

# Run the full suite:
pnpm test
```

Targeting a specific file is always preferred over the full suite — faster feedback, less noise.

## Bypass

Type `Allow node-test-runner bypass` verbatim in a recent user turn.
