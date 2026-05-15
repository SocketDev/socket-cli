# Drift watch

Companion to the `### Drift watch` rule in `template/CLAUDE.md`.
The inline section gives the headline; this file enumerates where
drift hides, how to check, and the cascade-PR convention.

## The principle

> Drift across fleet repos is a defect, not a feature.

When two socket-\* repos pin different versions of the same shared
resource, the divergence is a bug. The repo with the **newer version
is the source of truth**; older repos catch up.

This applies whenever a value is meant to be byte-identical (a SHA, a
hook, a CLAUDE.md fleet block) or semver-aligned (a tool version, a
Node release, a pnpm pin).

## Where drift commonly hides

- **`external-tools.json`** — pnpm / zizmor / sfw versions plus
  per-platform sha256s. `socket-registry`'s `setup-and-install`
  action is the canonical source.
- **`socket-registry/.github/actions/*`** — composite-action SHAs
  pinned in consumer workflows.
- **`template/CLAUDE.md` fleet block** (between `BEGIN/END
FLEET-CANONICAL` markers) — must be byte-identical across the
  fleet.
- **`template/.claude/hooks/*`** — same hook code in every repo;
  diverged hook code is drift.
- **`lockstep.json` `pinned_sha` rows** — upstream submodules
  tracked by socket-btm (lsquic, yoga, etc.).
- **`.gitmodules` `# name-version` annotations** (enforced by
  `.claude/hooks/gitmodules-comment-guard/`).
- **pnpm / Node `packageManager` / `engines` fields** — fleet-wide
  pin; any divergence is drift.

## How to check

1. **Editing one of the above in repo A?** Grep the same thing in
   repos B/C/D before committing. If A is older, bump A first; if A
   is newer, plan a sync to B/C/D.
2. **`socket-registry`'s `setup-and-install` action** is the
   canonical source for tool SHAs. Diverging from it is drift.
3. **`socket-wheelhouse`'s `template/` tree** is the canonical
   source for `.claude/`, CLAUDE.md fleet block, and hook code.
   Diverging is drift.
4. **`node scripts/sync-scaffolding/cli.mts --all`** (in socket-wheelhouse)
   surfaces drift programmatically.

## Never silently let drift sit

Reconcile in the same PR, or open a follow-up PR titled
`chore(sync): cascade <thing> from <newer-repo>` and link it.
The `drift-check-reminder` hook nags after edits to known-drift
surfaces.

## Cascade PR convention

`chore(sync): cascade <thing> from <newer-repo>@<sha>`

Examples:

- `chore(sync): cascade Node 26.1.0 from socket-wheelhouse@87eb704`
- `chore(sync): cascade plan-location-guard from
socket-wheelhouse@d846d1c`
- `chore(sync): cascade pnpm 11.0.8 + Node 26.1.0 from
socket-registry@abc1234`

The body should list affected files + the upstream commit. The
sync-scaffolding tool produces this body automatically when run with
`--target <repo> --fix`.

## See also

- `.claude/hooks/drift-check-reminder/`
- `.claude/hooks/gitmodules-comment-guard/`
- `scripts/sync-scaffolding/` — drift detection + auto-fix tooling
  (canonical in socket-wheelhouse).
