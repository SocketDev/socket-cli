# wheelhouse-drift-guard

PreToolUse guard. Blocks an Edit / MultiEdit / Write to a **root copy** of a
byte-controlled fleet path (a `template/base` mirror / optional entry) that
**would drift** from its resolved template source, pointing at
`template/base/<path>` + the re-cascade instead.

## Why

A wheelhouse-controlled file is distributed to every member by two channels — the
GitHub-Release bundle and the commit cascade — and both read the SAME canonical
source, `template/base/<path>`. Editing the root copy drifts it from that source:
the next cascade overwrites the edit, or the wheelhouse ships a root copy that
silently disagrees with `template/base` (the incident that shipped a stale
`github-release.yml` / `npm-publish.yml`). Full rationale:
[`wheelhouse-controlled-drift`](../../../../docs/agents.md/fleet/wheelhouse-controlled-drift.md).

## Scope

- Fires only when the post-edit text would actually DIFFER from the resolved
  template winner (an idempotent edit is never blocked).
- Never fires on a path under `template/` (the canonical source), on an
  EXPECTED / PRESET / native-handler path (content varies per repo), or in a
  member repo (no `template/base` → that is no-fleet-fork-guard's job).
- Convention-scoped (`isFleetTarget`): stands down in a non-fleet clone.
- Belt scan:
  `scripts/fleet/check/wheelhouse-controlled-files-are-classified.mts` asserts
  every `template/base` file is classified into a channel (Assertion A) and
  reports drifted root copies (Assertion B).

## Bypass

`Allow wheelhouse-drift bypass` — rare; e.g. an intentional root-copy edit you
will fold back into `template/base` in the same change.
