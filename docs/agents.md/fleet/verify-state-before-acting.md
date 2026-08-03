# Verify state before acting

Before creating, publishing, claiming, or scaffolding anything against a
resource, **read its current state first.** Never assume it is absent, empty,
unpublished, or unclaimed — check, then act on what is actually there.

## The rule

- **Read before you build a create/publish flow.** Before publishing a package,
  claiming a name, cutting a release, opening a PR, or scaffolding a resource,
  query what already exists: `npm view <pkg>`, crates.io, `gh release view`,
  `gh repo view`, a registry read. Let the real state drive the plan — do not
  set up the operation blind.
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

`verify-before-publish-guard` (PreToolUse, Bash) blocks two shapes — in every
repo, fleet or external, because registry mistakes are universal guardrails:

- **Git-spec misparse:** an `npm`/`pnpm`/`yarn publish <arg>` whose path arg
  contains `/` without a leading `./`, `../`, `/`, or `~` — npm silently reads
  `placeholders/darwin-x64` as the GitHub repo `placeholders/darwin-x64`, not a
  folder. Also fires on publish commands embedded in generated snippets
  (`printf … | pbcopy`), since handing someone broken commands is the same
  defect.
- **Unverified publish:** a non-`--dry-run` publish with no same-session
  registry-read receipt (`npm view` / `npm info` / `gh release view` in a recent
  assistant tool call). Run the read first; the retry passes.

Bypass: `Allow verify-before-publish bypass` (typed verbatim by the user).

## Why

Acting on an assumed state is how you rebuild what already exists, republish
frozen versions, and strand yourself into hand-fixes and guard bypasses. Reading
the state costs one command; the wrong assumption costs rework and sometimes an
irreversible mistake. (Incident: a set of npm placeholder packages were already
published at `0.0.0`; a publish flow and copy-paste commands were generated for
them anyway without one `npm view` up front — wasted work, a near-miss
republish, and the pasted commands also hit the git-spec misparse.)
