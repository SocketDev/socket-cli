---
name: updating-coverage
description: Refresh the README coverage badge by running coverage and rewriting the shields.io badge line.
user-invocable: true
allowed-tools: Read, Bash(pnpm run cover:*), Bash(pnpm run coverage:*), Bash(pnpm run test:cover:*), Bash(node:*), Bash(git:*)
model: claude-haiku-4-5
context: fork
---

# updating-coverage

Runs the repo's coverage script and rewrites the README badge so the published number matches reality. Invoked directly via `/update-coverage` or as a phase of the `updating` umbrella.

## When to use

- After landing a substantial change to test coverage (added a major
  feature with tests, removed a large untested module).
- Pre-release, to refresh the public badge.
- As part of `updating` umbrella flow when the repo declares a
  coverage script.

## What it does NOT do

- **Generate coverage from scratch.** This skill consumes the output of the repo's existing coverage tooling (vitest / c8 / istanbul / node-test coverage). If no coverage script is declared in `package.json`, the skill reports that and exits.
- **Compute coverage thresholds.** The badge reflects what the
  tooling reports; tightening the threshold is a separate decision
  in the repo's vitest/c8 config.
- **Modify nested READMEs.** Only the repo-root `README.md` is
  rewritten. Nested READMEs under `packages/*` have their own
  badges and lifecycles.

## Phases

| #   | Phase     | Outcome                                                                                              |
| --- | --------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Discovery | Find the coverage script in `package.json` (`cover` / `coverage` / `test:cover`, in that preference). |
| 2   | Run       | `pnpm run <script>`. Fail loudly if the run errors.                                                  |
| 3   | Rewrite   | `node scripts/fleet/make-coverage-badge.mts` — reads `coverage/coverage-summary.json`, rewrites the badge. |
| 4   | Commit    | `docs(readme): refresh coverage badge to N%`. Direct-push per fleet norm.                            |

The parse + rewrite math (read the summary, round the percent, pick the color bucket, edit the README) is owned by `scripts/fleet/make-coverage-badge.mts` and its lib `scripts/fleet/lib/coverage-badge.mts` — the same owner the commit-time gate `scripts/fleet/check/coverage-badge-is-current.mts` reads. This skill never re-derives the number or the format in shell; if it did, the badge it wrote (e.g. two decimals, a hard-coded color) would be rejected by `check --all`. The skill is orchestration over those scripts; the judgment it keeps is surfacing a real coverage-run failure.

## Phase 1: discovery

```sh
node -e "import('./scripts/fleet/lib/coverage-badge.mts').then(m => { const s = m.coverageScriptName(process.cwd()); if (!s) { process.exit(1) } console.log(s) })"
```

`coverageScriptName` returns the first of `cover` / `coverage` / `test:cover` declared in `package.json`, or exits non-zero when the repo tracks no coverage. That is not a failure mode — many fleet repos don't track coverage; the skill exits cleanly.

## Phase 2: run

```sh
pnpm run <SCRIPT>
```

Use the standard pnpm runner so the repo's own env config (catalog versions, etc.) applies. A real coverage-run failure is surfaced, not swallowed — that's the judgment this skill keeps.

## Phase 3: rewrite

```sh
node scripts/fleet/make-coverage-badge.mts
```

This reads `coverage/coverage-summary.json` (the `json-summary` reporter's output) and rewrites the README badge in place: the percent is `Math.round`-ed to an integer and the color is the bucket `badgeColor` computes (red → brightgreen). Exit 0 = written or already current; exit 1 = no coverage data / no badge to fill. To see the before value first, run `node scripts/fleet/make-coverage-badge.mts --check` (the dry-run the gate uses) and read its output.

The canonical badge line in `README.md` is the placeholder a seeded repo ships:

```markdown
![Coverage](https://img.shields.io/badge/coverage-<PCT>%25-brightgreen)
```

The script fills `<PCT>` (and updates the color); the `%25` is URL-encoded `%` and is left alone.

## Phase 4: commit

```sh
git add README.md
git commit -m "docs(readme): refresh coverage badge to <N>%"
git push origin <default-branch>
```

Direct-push per the fleet's `Commits & PRs → Push policy` rule; fall back to PR if the remote rejects.

## Output

When called via `/update-coverage`, emit a one-line summary of the integer percent before → after (read from the `--check` run). When no coverage script exists or the percentage is unchanged, exit silently.

## Related

- `.claude/skills/updating/SKILL.md`: umbrella that calls this skill when applicable.
- `.claude/skills/updating-security/SKILL.md`: sibling under `updating`.
- `template/README.md`: canonical README skeleton ships the placeholder badge.
