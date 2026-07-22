# Shared-workflow cascade (gh-aw)

How the fleet's AI-assisted workflows propagate on [GitHub Agentic
Workflows](https://github.github.com/gh-aw/) (gh-aw). Companion to the
`### Drift watch` rule in `template/CLAUDE.md` and to the inlined-workflow
model in [`drift-watch.md`](drift-watch.md).

## The model: per-repo copies, cascaded byte-identical

Every gh-aw workflow is authored ONCE in the wheelhouse template and cascaded
whole to every member — each repo runs its own scheduled copy. There is no
cross-repo reusable and no delegator pinned to another repo's SHA
(`template/base/.github/workflows/weekly-update.md:2-5` states the contract).
The unit that cascades is a pair plus a shared lock:

1. **Source `.md`.** `.github/workflows/<name>.md` is the gh-aw source:
   natural-language agent prompt + YAML frontmatter that declares `on:`,
   `engine:`, budget (`max-ai-credits`), the `network:` egress allowlist, and
   `safe-outputs:`.
2. **Compiled `.lock.yml`.** `gh aw compile` lowers the `.md` to a hardened
   GitHub Actions workflow (`<name>.lock.yml`) plus a pinned
   `.github/aw/actions-lock.json`. The three are one unit: edit the `.md`,
   recompile, commit all three together. `gh-aw-locks-are-current` guards the
   `.md` ↔ `.lock.yml` sync.

Both files are mirror entries in
`scripts/repo/sync-scaffolding/manifest/bundle.json`, so the fleet cascade
delivers them like any other canonical file, and a member's copy that differs
from the template is drift.

## Local delegation only

Where a workflow needs a stable `workflow_call` entry point, the delegator is
a LOCAL file in the same repo — e.g. `get-green.yml` runs
`uses: ./.github/workflows/get-green.lock.yml`, and the `workflow_dispatch`
wrapper `_local-not-for-reuse-get-green.yml` runs
`uses: ./.github/workflows/get-green.yml`. Every `uses:` in the chain is a
`./` ref that resolves inside the repo the run executes in — auditable by
zizmor/actionlint at rest, no cross-repo SHA to keep in step.

## Comment-stamp exemption

A SHA-pinned `uses:` requires a `# <label> (YYYY-MM-DD)` staleness comment
(`uses-sha-verify` / `workflow-uses-comment`). A gh-aw `.lock.yml` is
tool-generated and emits bare `# <tag>` comments with no date, so both the
edit-time `workflow-uses-comment-guard` hook and the commit-time
`workflow-uses-comment` check skip `*.lock.yml`. Never hand-edit a `.lock.yml`;
edit the `.md` and recompile.

## Testing a gh-aw workflow

gh-aw workflows are NOT testable through the local Agent CI runner: it parses
workflows with GitHub's `@actions/workflow-parser`, which cannot convert the
gh-aw agent-runtime jobs — the `agent` / `conclusion` / `detection` jobs — so it
aborts with `No jobs found`. Never feed a `.lock.yml` to `ci:local`.

The gh-aw-native test path is `gh aw trial`, which runs the workflow in a
temporary private host repo and captures safe outputs there, leaving the source
repo untouched:

```bash
gh aw trial ./.github/workflows/weekly-update.md \
  --clone-repo SocketDev/socket-registry \
  --yes --force-delete-host-repo-before --delete-host-repo-after
```

Four requirements, each learned the hard way:

- **`workflow_dispatch` trigger.** `gh aw trial` (and `gh aw run`) reject a
  workflow without one. Every fleet gh-aw workflow carries `workflow_dispatch`
  alongside its `schedule:` crons so it stays trial-able + manually runnable.
- **`--yes`.** The trial is interactive without it (a continue prompt + an
  "enable Actions permissions" prompt).
- **`delete_repo` gh scope.** Needed for the host-repo auto-clean
  (`--force-delete-host-repo-before` / `--delete-host-repo-after`). The fleet
  keeps gh-token scopes minimal, so this is an opt-in escalation; drop it after.
- **Push the `.md` first.** `--clone-repo` pulls the source repo's `origin`
  tree, so an unpushed local change is invisible to the trial.

`gh aw trial` does not provision the engine key (`ANTHROPIC_API_KEY`) to the
throwaway repo, so the agent step runs only against a `--host-repo` you
pre-seed with `gh secret set`, or under `--engine copilot` (which uses the gh
token). Validating the deterministic spine (compile + the `check-updates` gate)
needs no key.

## The orchestrator / worker pattern

`weekly-update` (haiku, the update agent) dispatches `get-green` (sonnet,
the escalation worker) via `safe-outputs.dispatch-workflow` on a test failure.
The dispatch target is a workflow BASENAME resolved in the same repo — rename
`get-green` and the `.md` frontmatter must move in lockstep. gh-aw is one
engine + model per workflow, so a two-model escalation is two workflows. This
same dispatch pattern is the substrate the fleet's planned multi-agent harness
builds on.
