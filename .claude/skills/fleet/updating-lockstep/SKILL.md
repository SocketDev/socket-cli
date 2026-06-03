---
name: updating-lockstep
description: Acts on `lockstep.json` drift for repos that carry the lockstep manifest. Reads `pnpm run lockstep --json`, then runs a Workflow that pipelines each mechanical `version-pin` row through resolve → bump → validate → commit independently. Surfaces `file-fork` / `feature-parity` / `spec-conformance` / `lang-parity` rows as advisory. Invoked by the `updating` umbrella skill; can also run standalone.
user-invocable: true
allowed-tools: Workflow, Read, Edit, Grep, Glob, Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(diff:*)
model: claude-haiku-4-5
context: fork
---

# updating-lockstep

Acts on drift in `lockstep.json`. Collects drift inline, then runs a `Workflow` that pipelines each mechanical `version-pin` row through resolve → bump → validate → commit on its own timeline; everything else surfaces as advisory notes for human review. Each actioned row becomes its own atomic commit so the PR reviewer can accept / reject per-row.

## When to use

- Invoked by the `updating` umbrella skill (weekly-update workflow).
- Standalone: `/updating-lockstep` to sync just the lockstep manifest.
- After manual submodule bumps, to refresh `lockstep.json` metadata.

Exits cleanly when `lockstep.json` is absent. Not every fleet repo has one.

## Per-kind policy at a glance

`version-pin` is mechanical (auto-bump per `upgrade_policy`). Everything else is advisory. Upstream semantics and local deltas need human judgment.

Full policy table, scripts per phase, and advisory format in [`reference.md`](reference.md).

## Phases

Phases 1–2 (pre-flight + collect drift) run inline — one `pnpm run lockstep --json` call builds the work-list. Phase 3 (auto-bump) is independent per-row fan-out — each `version-pin` row resolves and validates on its own timeline — so it runs as a **`Workflow`** `pipeline()`. Phases 4–5 (advisory compose + report) run inline after, since the report needs the full per-row result set.

| #   | Phase                  | Outcome                                                                                                                                                                                                                |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Pre-flight (inline)    | Bail if no `lockstep.json`. Verify scaffolding (`lockstep.schema.json`, `scripts/fleet/lockstep.mts`). Clean tree. Detect CI mode.                                                                                     |
| 2   | Collect drift (inline) | `pnpm run lockstep --json` → split rows into **auto** (mechanical version-pin bumps) and **advisory** (everything else with drift). The auto rows are the pipeline work-list.                                          |
| 3   | Auto-bump (pipeline)   | Per row: resolve submodule, fetch tags, identify target tag, checkout, update `lockstep.json` + `.gitmodules`, validate, commit (`chore(deps): bump <upstream> to <tag>`). Test before committing in interactive mode. |
| 4   | Advisory (inline)      | Compose per-row markdown lines for the PR body.                                                                                                                                                                        |
| 5   | Report (inline)        | Human-readable summary; in CI mode, emit advisory block to `$GITHUB_OUTPUT` (base64); HANDOFF block per `_shared/report-format.md`.                                                                                    |

### The per-row pipeline: author a `Workflow`

The skill invoking `Workflow` is a sanctioned opt-in. Pass the **auto** (`version-pin`) row list from Phase 2 as `args`; the advisory rows stay inline. Author the script inline (don't pre-`Write` it). Shape:

```
pipeline(autoRows, resolveTarget, bumpAndCommit)
```

1. **`resolveTarget` stage** — one `agent()` per row: resolve the submodule path, fetch tags, apply the tag-stability filter (drop `-rc`/`-alpha`/`-beta`/`-dev`/`-snapshot`/`-nightly`/`-preview`), pick the target tag per `upgrade_policy`. Returns `ROW_SCHEMA`: `{ upstream, submodulePath, currentTag, targetTag, locked: boolean, skipReason? }`. A `locked` row or no newer stable tag returns with a `skipReason` and no stage-2 work.
2. **`bumpAndCommit` stage** — checkout the target tag, update `lockstep.json` + the `.gitmodules` `# <name>-<version>` annotation (via Edit, not `sed`), validate (`pnpm run lockstep` exits 0 or 2), run `pnpm test` in interactive mode, then commit `chore(deps): bump <upstream> to <tag>`. Returns `RESULT_SCHEMA`: `{ upstream, targetTag, committed: boolean, state: bumped|skipped-locked|skipped-no-tag|test-failed }`. A test failure rolls back the row and the stage throws, dropping the item to `null` (filter before the Phase-5 report).

Worktree isolation is **not** needed: each row touches a distinct submodule path + its own `lockstep.json`/`.gitmodules` lines, and commits land sequentially on the same branch. Most repos carry only a handful of `version-pin` rows, so the pipeline is shallow — the win is per-row streaming (a slow tag-fetch on one upstream doesn't block the others) and validated structured rows for the report.

## Hard requirements

- **Bail safely on missing manifest**: exit 0 cleanly if `lockstep.json` is absent.
- **Atomic commits**: one commit per auto-bumped row. Conventional Commits format.
- **`.gitmodules` version comments**: keep `# <name>-<version>` annotations synchronized with `pinned_tag`.
- **Stable releases only**: filter `-rc` / `-alpha` / `-beta` / `-dev` / `-snapshot` / `-nightly` / `-preview` (full pattern in `reference.md`).
- **No `npx` / `pnpm dlx` / `yarn dlx`**: `pnpm exec` or `pnpm run` per CLAUDE.md _Tooling_.
- **Edit tool, not `sed`**: for `.gitmodules` annotation updates.

## Forbidden

- Auto-editing `file-fork` / `feature-parity` / `spec-conformance` / `lang-parity` rows' tracked state. Advisory only.
- Bumping a `locked` `version-pin` without human approval (gated on coordinated upstream change).
- Skipping the tag-stability filter.

## CI vs interactive mode

- **CI** (`CI=true` / `GITHUB_ACTIONS`): skip per-row test validation; emit advisory to `$GITHUB_OUTPUT`.
- **Interactive** (default): run `pnpm test` before each auto-bump commit; rollback the row on failure and continue.

## Success criteria

- All actionable `version-pin` rows bumped atomically (one commit per row).
- Advisory rows collected for PR body / workflow output.
- No edits to non-`version-pin` row tracked state.
- `pnpm run lockstep` exits 0 or 2 at end (never 1; no schema errors introduced).
- `.gitmodules` version comments synchronized with `pinned_tag`.

## Commands reference

- `pnpm run lockstep --json`: drift report (consumed by this skill).
- `jq`: parse + edit `lockstep.json` (structured JSON edits).
- `git submodule status`: verify submodule state after bumps.
