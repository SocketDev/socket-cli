# Environment Check

Shared prerequisite validation for all pipelines. Run at the start of every skill.

## Steps

1. Run `git status` to check working directory state
2. Detect CI mode: check for `GITHUB_ACTIONS` or `CI` environment variables
3. Verify `node_modules/` exists (run `pnpm install` if missing)
4. Verify on a valid branch (`git branch --show-current`)

## Behavior

- **Clean working directory**: proceed normally
- **Dirty working directory**: warn and continue (most skills are read-only or create their own commits)
- **CI mode**: set `CI_MODE=true` — skills should skip interactive prompts and local-only validation
- **Missing node_modules**: run `pnpm install` before proceeding

## Queue Tracking

Write a run entry to `.claude/ops/queue.yaml` with:
- `id`: `{pipeline}-{YYYY-MM-DD}-{NNN}`
- `pipeline`: the invoking skill name
- `status`: `in-progress`
- `started`: current UTC timestamp
- `current_phase`: `env-check`
- `completed_phases`: `[]`
