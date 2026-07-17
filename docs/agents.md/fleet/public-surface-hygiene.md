# Public-surface hygiene

The CLAUDE.md `### Public-surface hygiene` section gives the headline invariants. This file is the full ruleset with rationale, hook references, and bypass surface.

The rules apply even when hooks are not installed. They're invariants, not enforcement-dependent. Enforced by `.claude/hooks/fleet/{private-name-nudge,public-surface-nudge,release-workflow-guard}/` and the rules below.

## Customer / company / internal names

- **Real customer / company names**: never write one into a commit, PR, issue, comment, or release note. Replace with `Acme Inc` or rewrite the sentence to not need the reference. No enumerated denylist exists; a denylist is itself a leak.
- **Private repos / internal project names**: never mention. Omit the reference entirely. Don't substitute "an internal tool"; the placeholder is a tell.

## Private / internal paths in source comments

A SOURCE-code comment must never carry an internal/private path. The incident that codified this: an agent leaked a scaffolding-repo `.claude/plans/<doc>.md` path into a public napi-rs source file's comment (`crates/.../src/lib.rs`). That single line discloses internal fleet repo layout, an operator-local working-notes location, and a dev-box checkout path to anyone reading the shipped source.

Blocked inside comment syntax (string literals and real code are left alone):

- **`.claude/plans/…` / `.claude/reports/…`** — untracked operator-local working notes; they never ship and a source file must not point at one.
- **`socket-<repo>/.claude/…`** — another fleet repo's private `.claude/` tree (cross-repo internal layout).
- **`/Users/<name>/…`** — an absolute home path (leaks the username + on-disk layout).
- **`../socket-<repo>/…`** — a sibling fleet-repo relative path (presumes a parent dir that only exists on a dev box; see the no-cross-repo-relative-paths rule).

Scope is SOURCE-code files only (`.rs`/`.ts`/`.mts`/`.js`/`.go`/`.py`/`.c`/`.h`/…). Markdown, docs, JSON/YAML, and the `.claude/` tree itself are out of scope — those surfaces reference these paths legitimately (a plan doc names a plan path).

Three surfaces enforce one rule (code is law): the edit-time `.claude/hooks/fleet/no-private-path-in-source-guard/` (bypass: `Allow private-path-in-source bypass`), the `socket/no-private-path-in-source` lint rule, and the commit-time `scripts/fleet/check/private-paths-are-absent.mts` full scan. The fix is always to remove the path from the comment and describe the constraint instead — not where a plan doc lives.

## Neutral placeholders for test fixtures

Pattern-matching tests, sample documentation, and example configs are tempting places to reach for a "real" package name (e.g. `eslint-plugin-react`, `react`, `lodash`). When the test exercises the _shape_ of a name rather than its identity, use the `acme-*` placeholder family — same convention as `Acme Inc` for company-name placeholders. This avoids tripping lint rules that flag references to specific package families (e.g. `socket/no-eslint-biome-config-ref` fires on `eslint-` prefixes even when the literal is a fixture, not a config ref). Recommended placeholder shapes:

- bare: `acme-foo`, `acme-widget`
- plugin-family: `acme-plugin-react`, `acme-plugin-node`
- scoped: `@acme/widget`, `@acme/types`
- versioned: `acme-foo@1.0.0`, `@acme/widget@2.0.0`

The bypass comment (`socket-lint: allow eslint-biome-ref -- <reason>`) exists for genuinely irreplaceable cases — testing the lint rule itself, or quoting a real `.eslintrc.json` file path inside a migration script. Renaming the fixture is preferred over the bypass.

## Linear refs

Never put `SOC-123` / `ENG-456` / Linear URLs in code, comments, or PR text. Linear lives in Linear.

## Publish / release / build-release workflows

Never `gh workflow run|dispatch` against publish/release workflows. The user runs them manually. Bypass paths:

- `gh workflow run -f dry-run=true`: the workflow must declare a `dry-run:` input AND have no force-prod override set.
- `Allow workflow-dispatch bypass: <workflow>` typed verbatim: one phrase authorizes one dispatch.

`workflow_dispatch.inputs` keys are kebab-case (`dry-run`, `build-mode`); snake_case silently fails the bypass.

## Workflow YAML rules

- `uses: <action>@<40-char-sha>` lines need a trailing `# <tag> (YYYY-MM-DD)` comment so we can age-out stale pins (enforced by `.claude/hooks/fleet/workflow-uses-comment-guard/`).
- Workflow `run:` blocks with `gh ... --body "..."` break YAML on multi-line markdown; always `--body-file <path>` (enforced by `.claude/hooks/fleet/workflow-multiline-body-guard/`; bypass: `Allow workflow-yaml-multiline-body bypass`).
- Edits to `.github/workflows/*.y*ml` auto-lint via local `actionlint` (enforced by `.claude/hooks/fleet/actionlint-on-workflow-edit/`).
- A workflow that commits, pushes, or tags must NOT set `actions/checkout` `persist-credentials: false` — it strips the token a later `git push` step needs, and the push fails with an auth error that looks unrelated. **Why:** adding `persist-credentials: false` for hardening on a workflow that pushes breaks the push step.
- `schedule:`-triggered runs have no `inputs`, so a job-level `if: inputs.X` (or `github.event.inputs.X`) is always falsy on a cron fire. Guard schedule-vs-dispatch branches with `github.event_name` instead. **Why:** a job gated on `inputs.dry-run` never runs on its cron schedule.
- A workflow can't use the default `GITHUB_TOKEN` to trigger another workflow (push / PR / issue events it creates are suppressed; only `workflow_dispatch` / `repository_dispatch` fire). Full failure modes + the PAT / dispatch workarounds in [`github-token-limitations.md`](github-token-limitations.md).

## `pull_request_target` is privileged

Runs in BASE-repo context with secrets. Never combine it with `actions/checkout` of fork head + a step that executes the checked-out code (enforced by `.claude/hooks/fleet/pull-request-target-guard/`). Full threat model + safer patterns in [`pull-request-target.md`](pull-request-target.md).

## No external issue/PR refs in commit messages or PR bodies

GitHub auto-links `<owner>/<repo>#<num>` and `https://github.com/<owner>/<repo>/(issues|pull)/<num>` mentions back to the target issue, spamming the maintainer with `added N commits that reference this issue` events.

- Only SocketDev-owned refs are allowed (`SocketDev/<repo>#<num>` is fine).
- For upstream maintainer issues, link them in _the PR description prose_ (which doesn't trigger backrefs from commits) or use the `[#1203](https://npmx.dev/...)` link form that omits the `owner/repo#` token.

Bypass: `Allow external-issue-ref bypass` (enforced by `.claude/hooks/fleet/no-ext-issue-ref-guard/`).

## Root README skeleton + `freeform-readme` opt-in

Every fleet member's root `README.md` carries the canonical five level-2 sections
in order — `Why this repo exists` / `Install` / `Usage` / `Development` /
`License` — plus the universal social-follow badges (X / Twitter + Bluesky) under
the title, no the fleet source repo leak, no sibling-relative script commands.
Canonical skeleton: `template/README.md`.

Some repos are not infra repos. The VS Code + browser extensions and the skills
directory ship **public product / marketplace READMEs** whose structure is owned
by the listing, not the fleet skeleton. Those repos declare
`"optIns": ["freeform-readme"]` in the cascade roster
(`.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json`). The opt-in exempts
them from the **five-section skeleton only** — the follow-badges, the
the fleet source repo-leak check, and the sibling-relative-path check stay universal.

The rule is enforced across four surfaces, all reading the one roster:

- Edit-time: `.claude/hooks/fleet/readme-fleet-shape-guard/` (skips the section
  check when the target repo is `freeform-readme`).
- Lint-time: `.config/fleet/markdownlint-rules/socket-readme-required-sections`
  (bails via `_shared/freeform-readme-optin`); `socket-readme-social-badges` always
  runs.
- Sync-time: `scripts/repo/sync-scaffolding/checks/readme-skeleton-drift.mts`
  (skips the section finding for `FREEFORM_README_REPOS`).
- Index: the `Root README.md` bullet in `CLAUDE.md`.
