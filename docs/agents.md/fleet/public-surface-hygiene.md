# Public-surface hygiene

The CLAUDE.md `### Public-surface hygiene` section gives the headline invariants. This file is the full ruleset with rationale, hook references, and bypass surface.

The rules apply even when hooks are not installed. They're invariants, not enforcement-dependent. Enforced by `.claude/hooks/fleet/{private-name-nudge,public-surface-nudge,no-private-path-in-source-guard,no-private-ref-in-tests-docs-guard,release-workflow-guard}/` and the rules below.

## Customer / company / internal names

- **Real customer / company names**: never write one into a commit, PR, issue, comment, or release note. Replace with `Acme Inc` or rewrite the sentence to not need the reference. No enumerated denylist exists; a denylist is itself a leak.
- **Private repos / internal project names**: never mention. Omit the reference entirely. Don't substitute "an internal tool"; the placeholder is a tell.

## Private / internal paths in source comments

A SOURCE-code comment must never carry an internal/private path. The incident that codified this: an agent leaked a scaffolding-repo `.claude/plans/<doc>.md` path into a public napi-rs source file's comment (a `crates/<crate>/src/lib.rs`). That single line discloses internal fleet repo layout, an operator-local working-notes location, and a dev-box checkout path to anyone reading the shipped source.

Blocked inside comment syntax (string literals and real code are left alone):

- **`.claude/plans/` / `.claude/reports/`** — untracked operator-local working notes; they never ship and a source file must not point at one.
- **`socket-<repo>/.claude/…`** — another fleet repo's private `.claude/` tree (cross-repo internal layout).
- **`/Users/<name>/…`** — an absolute home path (leaks the username + on-disk layout).
- **`../socket-<repo>/…`** — a sibling fleet-repo relative path (presumes a parent dir that only exists on a dev box; see the no-cross-repo-relative-paths rule).

Scope is SOURCE-code files only (`.rs`/`.ts`/`.mts`/`.js`/`.go`/`.py`/`.c`/`.h`/…). Markdown, docs, JSON/YAML, and the `.claude/` tree itself are out of scope — those surfaces reference these paths legitimately: a plan doc names a plan path.

Three surfaces enforce one rule (code is law): the edit-time `.claude/hooks/fleet/no-private-path-in-source-guard/` (bypass: `Allow private-path-in-source bypass`), the `socket/no-private-path-in-source` lint rule, and the commit-time `scripts/fleet/check/private-paths-are-absent.mts` full scan. The fix is always to remove the path from the comment and describe the constraint instead — not where a plan doc lives.

## Private refs in tests and docs

A separate surface covers a different leak shape: a unit-test or documentation file whose new content names a `SocketDev/<repo>` slug outside the fleet roster, a `linear.app` issue URL, or a Slack thread link. Tests and docs ship in public repos and survive history squashes, so a private repo name, ticket reference, or thread link in one of them is a durable leak even though it's not a source-code comment. Use fictional slugs (`acme/widgets`) in tests; omit internal references from docs. The fleet roster (`fleet-repos.json`) is the sole sanctioned place a private repo name appears, so roster membership is the public/private line this surface draws for org slugs — company and customer names stay with the `private-name-nudge` reminder above. Enforced by `.claude/hooks/fleet/no-private-ref-in-tests-docs-guard/` (bypass: `Allow private-ref-in-tests-docs bypass`, e.g. a doc legitimately citing a public non-fleet SocketDev repo).

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

Never `gh workflow run|dispatch` against publish/release workflows. The user runs them manually. Enforced by `.claude/hooks/fleet/release-workflow-guard/`. Bypass paths:

- `gh workflow run -f dry-run=true`: the workflow must declare a `dry-run:` input AND have no force-prod override set.
- `Allow workflow-dispatch bypass: <workflow>` typed verbatim: one phrase authorizes one dispatch.

`workflow_dispatch.inputs` keys are kebab-case (`dry-run`, `build-mode`); snake_case silently fails the bypass.

## Workflow YAML rules

- `uses: <action>@<40-char-sha>` lines need a trailing `# <tag> (YYYY-MM-DD)` comment so we can age-out stale pins (enforced by `.claude/hooks/fleet/workflow-uses-comment-guard/`).
- Workflow `run:` blocks with `gh ... --body "..."` break YAML on multi-line markdown; always `--body-file <path>` (enforced by `.claude/hooks/fleet/workflow-multiline-body-guard/`; bypass: `Allow workflow-yaml-multiline-body bypass`).
- Edits to `.github/workflows/*.y*ml` auto-lint via local `actionlint` (enforced by `.claude/hooks/fleet/actionlint-on-workflow-edit/`).
- A workflow that commits, pushes, or tags must NOT set `actions/checkout` `persist-credentials: false` — it strips the token a later `git push` step needs, and the push fails with an auth error that looks unrelated. **Why:** adding `persist-credentials: false` for hardening on a workflow that pushes breaks the push step.
- `schedule:`-triggered runs have no `inputs`, so a job-level `if: inputs.X` (or `github.event.inputs.X`) is always falsy on a cron fire. Guard schedule-vs-dispatch branches with `github.event_name` instead. **Why:** a job gated on `inputs.dry-run` never runs on its cron schedule.
- A workflow can't use the default `GITHUB_TOKEN` to trigger another workflow (push / PR / issue events it creates are suppressed; only `workflow_dispatch` / `repository_shared` fire). Full failure modes + the PAT / dispatch workarounds in [`github-token-limitations.md`](github-token-limitations.md).

## `pull_request_target` is privileged

Runs in BASE-repo context with secrets. Never combine it with `actions/checkout` of fork head + a step that executes the checked-out code (enforced by `.claude/hooks/fleet/pull-request-target-guard/`). Full threat model + safer patterns in [`pull-request-target.md`](pull-request-target.md).

## No external issue/PR refs in commit messages or PR bodies

GitHub auto-links `<owner>/<repo>#<num>` and `https://github.com/<owner>/<repo>/(issues|pull)/<num>` mentions back to the target issue, spamming the maintainer with `added N commits that reference this issue` events.

- Only SocketDev-owned refs are allowed (`SocketDev/<repo>#<num>` is fine).
- For upstream maintainer issues, link them in _the PR description prose_ (which doesn't trigger backrefs from commits) or use the `[#1203](https://npmx.dev/...)` link form that omits the `owner/repo#` token.

Bypass: `Allow external-issue-ref bypass` (enforced by `.claude/hooks/fleet/no-ext-issue-ref-guard/`).

## Clickable PR/issue refs in reports and docs

The rule above governs commit messages and PR bodies, where GitHub auto-links a bare `#N` against the current repo, so there a bare `#N` is already a working link and the danger is the reverse: a foreign `<owner>/<repo>#N` or full URL that backref-spams. Rendered Markdown docs and agent status reports are the opposite surface. GitHub only auto-links `#N` inside issues, PRs, and commits, so a bare `#7317` in a `.md` file or a terminal status report is **dead text**. Reference a PR or issue there as a clickable Markdown link.

- Write `[#7317](https://github.com/PerryTS/perry/pull/7317)`, not a bare `#7317`.
- Build it in code with the shared helper `githubRefLink(repoUrl, n, kind)` from `@socketsecurity/lib/links/github`. It returns `[#7317](…/pull/7317)` and degrades to a bare `#N` when the repo URL can't be parsed. For a CLI's own stdout, which is not Markdown, socket-cli's `githubRepoLink` emits an OSC-8 terminal hyperlink instead.
- This does not change the rule above. In commit messages and PR bodies keep the bare same-repo `#N`, and never emit a raw `<owner>/<repo>#N` or full github URL there.

Enforced by `scripts/fleet/check/pr-refs-in-docs-are-linked.mts` over tracked docs. Changelogs and fixtures are out of scope, since a fragment becomes Release notes where `#N` auto-links. Escape hatch: `<!-- pr-ref-link: allow -->` on the line, or `<!-- pr-ref-link: allow-file -->` anywhere in the file.

## Root README skeleton

Every fleet member's root `README.md` opens with lead prose saying why the repo
exists, directly under the title and badges, never a `## Why this repo exists`
heading. It then carries the canonical four level-2 sections in order:
`Install`, `Usage`, `Development`, `License`. It also carries the universal
social-follow badges (X / Twitter + Bluesky) under the title, no fleet source
repo leak, and no sibling-relative script commands. Canonical skeleton:
`template/base/README.md`.

Extra sections beyond the canonical four are fine anywhere, so a product or
marketplace README can carry its own listing-shaped material. Only the four
canonical sections and their relative order are required, which is why no member
needs an exemption.

The rule is enforced across four surfaces:

- Edit-time: `.claude/hooks/fleet/readme-fleet-shape-guard/`.
- Lint-time: `.config/fleet/markdownlint-rules/socket-readme-required-sections.mts`;
  `socket-readme-social-badges` runs alongside it.
- Sync-time: `scripts/repo/sync-scaffolding/checks/readme-skeleton-drift.mts`.
- Index: the `Root README.md` bullet in `CLAUDE.md`.
