# Verify Build

Shared build/test/lint validation. Referenced by skills that modify code or dependencies.

## Steps

Run in order, stop on first failure:

1. `pnpm run fix --all` — auto-fix lint and formatting issues
2. `pnpm run check --all` — lint + typecheck + validation (read-only, fails on violations)
3. `pnpm test` — full test suite

## CI Mode

When `CI_MODE=true` (detected by env-check), skip this validation entirely.
CI runs these checks in its own matrix (Node 20/22/24 × ubuntu/windows).

## On Failure

- Report which step failed with the error output
- Do NOT proceed to the next pipeline phase
- Mark the pipeline run as `status: failed` in `.claude/ops/queue.yaml`
