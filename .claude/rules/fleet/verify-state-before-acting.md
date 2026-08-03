# Verify state before acting

Before creating, publishing, claiming, or scaffolding anything against a
resource, **read its current state first.** Never assume it is absent, empty,
unpublished, or unclaimed — check, then act on what is actually there.

## The rule

- **Read before you build a create/publish flow.** Before publishing a package,
  claiming a name, cutting a release, opening a PR, or scaffolding a resource,
  query what already exists: `npm view <pkg>`, `cargo search <crate>` /
  crates.io, `gh release view`, `gh repo view`, a registry read. Let the real
  state drive the plan — do not set up the operation blind.
- **If it already exists, adapt — do not redo it.** Finding the resource already
  in place is the success case, not a detour: skip the redundant work, and never
  regenerate a flow (or hand someone commands) for something already done.
- **Irreversible actions make verifying first the only safety.** An npm version
  cannot be republished and unpublish is restricted; a crates.io version is
  permanent; a pushed tag or release is public immediately. The cost of a wrong
  assumption is asymmetric, so the cheap up-front read is mandatory, not
  optional.
- **This is the pre-action twin of verify-before-you-claim.** `stop-claim-verify`
  covers "do not claim done without a receipt"; this covers "do not start
  without reading the state." Same discipline, opposite end of the task.

## Enforcement

- `verify-before-publish-guard` (PreToolUse, every repo) blocks the
  publish-family footguns this rule exists to stop: a `npm|pnpm|yarn publish`
  path arg with no leading `./` (npm silently reads bare `a/b` as a GitHub git
  spec, not a folder — snippet-embedded commands included), and any
  non-`--dry-run` publish with no same-session registry-read receipt
  (`npm view` / `gh release view` in a recent tool call — run the read, then
  retry). Details: `docs/agents.md/fleet/verify-state-before-acting.md`.

## Why

Acting on an assumed state is how you rebuild what already exists, republish
frozen versions, and strand yourself into hand-fixes and guard bypasses. Reading
the state costs one command; the wrong assumption costs rework and sometimes an
irreversible mistake. (Incident: a set of npm placeholder packages were already
published at `0.0.0`; a publish flow and copy-paste commands were generated for
them anyway without one `npm view` up front — wasted work and a near-miss
republish.)
