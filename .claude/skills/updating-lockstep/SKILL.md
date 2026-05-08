---
name: updating-lockstep
description: Acts on `lockstep.json` drift for repos that carry the lockstep manifest. Reads `pnpm run lockstep --json`, auto-bumps mechanical `version-pin` rows, surfaces `file-fork` / `feature-parity` / `spec-conformance` / `lang-parity` rows as advisory. Invoked by the `updating` umbrella skill; can also run standalone.
user-invocable: true
allowed-tools: Read, Edit, Grep, Glob, Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(diff:*)
---

# updating-lockstep

Acts on drift in `lockstep.json`. Auto-applies mechanical `version-pin` bumps; surfaces everything else as advisory notes for human review. Each actioned row becomes its own atomic commit so the PR reviewer can accept / reject per-row.

## When to use

- Invoked by the `updating` umbrella skill (weekly-update workflow).
- Standalone: `/updating-lockstep` to sync just the lockstep manifest.
- After manual submodule bumps, to refresh `lockstep.json` metadata.

Exits cleanly when `lockstep.json` is absent — not every fleet repo has one.

## Per-kind policy at a glance

`version-pin` is mechanical (auto-bump per `upgrade_policy`). Everything else is advisory — upstream semantics and local deltas need human judgment.

Full policy table, scripts per phase, and advisory format in [`reference.md`](reference.md).

## Phases

| # | Phase | Outcome |
|---|---|---|
| 1 | Pre-flight | Bail if no `lockstep.json`. Verify scaffolding (`lockstep.schema.json`, `scripts/lockstep.mts`). Clean tree. Detect CI mode. |
| 2 | Collect drift | `pnpm run lockstep --json` → split rows into **auto** (mechanical version-pin bumps) and **advisory** (everything else with drift). |
| 3 | Auto-bump | Per row: resolve submodule, fetch tags, identify target tag, checkout, update `lockstep.json` + `.gitmodules`, validate, commit (`chore(deps): bump <upstream> to <tag>`). Test before committing in interactive mode. |
| 4 | Advisory | Compose per-row markdown lines for the PR body. |
| 5 | Report | Human-readable summary; in CI mode, emit advisory block to `$GITHUB_OUTPUT` (base64); HANDOFF block per `_shared/report-format.md`. |

## Hard requirements

- **Bail safely on missing manifest** — exit 0 cleanly if `lockstep.json` is absent.
- **Atomic commits** — one commit per auto-bumped row. Conventional Commits format.
- **`.gitmodules` version comments** — keep `# <name>-<version>` annotations synchronized with `pinned_tag`.
- **Stable releases only** — filter `-rc` / `-alpha` / `-beta` / `-dev` / `-snapshot` / `-nightly` / `-preview` (full pattern in `reference.md`).
- **No `npx` / `pnpm dlx` / `yarn dlx`** — `pnpm exec` or `pnpm run` per CLAUDE.md _Tooling_.
- **Edit tool, not `sed`** — for `.gitmodules` annotation updates.

## Forbidden

- Auto-editing `file-fork` / `feature-parity` / `spec-conformance` / `lang-parity` rows' tracked state. Advisory only.
- Bumping a `locked` `version-pin` without human approval (gated on coordinated upstream change).
- Skipping the tag-stability filter.

## CI vs interactive mode

- **CI** (`CI=true` / `GITHUB_ACTIONS`) — skip per-row test validation; emit advisory to `$GITHUB_OUTPUT`.
- **Interactive** (default) — run `pnpm test` before each auto-bump commit; rollback the row on failure and continue.

## Success criteria

- All actionable `version-pin` rows bumped atomically (one commit per row).
- Advisory rows collected for PR body / workflow output.
- No edits to non-`version-pin` row tracked state.
- `pnpm run lockstep` exits 0 or 2 at end (never 1 — no schema errors introduced).
- `.gitmodules` version comments synchronized with `pinned_tag`.

## Commands reference

- `pnpm run lockstep --json` — drift report (consumed by this skill).
- `jq` — parse + edit `lockstep.json` (structured JSON edits).
- `git submodule status` — verify submodule state after bumps.
