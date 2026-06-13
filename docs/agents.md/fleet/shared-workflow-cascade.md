# Shared-workflow cascade (gh-aw)

How the fleet's shared reusable workflows propagate, now that the weekly-update
automation runs on [GitHub Agentic Workflows](https://github.github.com/gh-aw/)
(gh-aw). Companion to the `### Drift watch` rule in `template/CLAUDE.md`.

## The four layers

The fleet's shared-workflow model has four layers; gh-aw changes only what the
pinned file looks like, not the propagation mechanics:

1. **Layer 1 — source `.md`.** `socket-registry/.github/workflows/weekly-update.md`
   is the gh-aw source: natural-language agent prompt + a YAML frontmatter that
   declares `on:`, `engine:`, budget (`max-ai-credits`), the `network:` egress
   allowlist, and `safe-outputs:`.
2. **Layer 2 — compiled `.lock.yml`.** `gh aw compile` lowers the `.md` to a
   hardened GitHub Actions workflow (`weekly-update.lock.yml`) plus a pinned
   `.github/aw/actions-lock.json`. The three are one unit: edit the `.md`,
   recompile, commit all three together. `gh-aw-locks-are-current` guards the
   `.md` ↔ `.lock.yml` sync.
3. **Layer 3 — the reusable.** Members `uses:` the compiled
   `SocketDev/socket-registry/.github/workflows/weekly-update.lock.yml@<sha>` —
   the same `workflow_call` contract the legacy `.yml` exposed, keyed now on the
   `.lock.yml` path.
4. **Layer 4 — the `_local` delegator.** Each repo's
   `.github/workflows/_local-not-for-reuse-<workflow>.yml` is its own entry
   point; it pins the Layer-3 reusable to the **propagation SHA** and passes
   inputs + secrets through.

## Propagation SHA + the pin reconciler

The propagation SHA is the socket-registry merge commit that carries a given
`.lock.yml`. `scripts/fleet/sync-registry-workflow-pins.mts` reads each repo's
`_local` pin (via the local checkout, else the public API) and repins delegators
to it. `pinLineRe` / `parseLocalPin` tolerate an optional `.lock` segment, so
the reconciler repins both the legacy `<workflow>.yml@<sha>` and the gh-aw
`<workflow>.lock.yml@<sha>` forms during the migration without caring which a
member is on.

## Comment-stamp exemption

A SHA-pinned `uses:` requires a `# <label> (YYYY-MM-DD)` staleness comment
(`uses-sha-verify` / `workflow-uses-comment`). A gh-aw `.lock.yml` is
tool-generated and emits bare `# <tag>` comments with no date, so both the
edit-time `workflow-uses-comment-guard` hook and the commit-time
`workflow-uses-comment` check skip `*.lock.yml`. Never hand-edit a `.lock.yml`;
edit the `.md` and recompile.

## Testing a gh-aw reusable

gh-aw workflows are NOT testable through the local Agent CI runner: it parses
workflows with GitHub's `@actions/workflow-parser`, which cannot convert the
gh-aw agent-runtime jobs (the `agent` / `conclusion` / `detection` jobs), so it
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
  `workflow_call`-only workflow. Every gh-aw reusable carries both
  `workflow_dispatch` (trial-able + manually dispatchable) and `workflow_call`
  (production).
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

`weekly-update` (haiku, the update agent) dispatches `fix-test-failures` (sonnet,
the escalation worker) via `safe-outputs.dispatch-workflow` on a test failure.
gh-aw is one engine + model per workflow, so a two-model escalation is two
workflows. This same dispatch pattern is the substrate the fleet's planned
multi-agent harness builds on.
