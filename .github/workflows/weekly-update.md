---
# Per-repo weekly + daily dependency update — gh-aw agentic workflow. Source of
# truth: this .md. Edit it, then `gh aw compile` → weekly-update.lock.yml (commit
# BOTH + .github/aw/actions-lock.json). Cascaded to every fleet member; each repo
# runs its own scheduled copy — no shared reusable, no socket-registry delegator.
#
# Two cadences share ONE workflow: the Monday cron runs the full /updating
# umbrella; the daily cron runs /updating-daily (promote soaked exclusions only).
# The stronger get-green workflow is dispatched on a test failure.
#
# Wins over the legacy claude --print reusable: per-run + 24h AI-credit budget,
# firewall egress allowlist, safe-output PR (GitHub web-flow-signed + atomic via
# git-bundle — no BOT_GPG plumbing).
on:
  schedule:
    # Monday 09:00 UTC — full weekly /updating umbrella.
    - cron: '0 9 * * 1'
    # Daily 08:00 UTC — /updating-daily soaked-exclusion promotion (an hour
    # before the Monday run so soaked bypasses are promoted first).
    - cron: '0 8 * * *'
  # workflow_dispatch keeps the workflow trial-able (`gh aw trial` / `gh aw run`
  # both require it) and manually runnable — a manual run does the full weekly
  # update.
  workflow_dispatch:

engine:
  id: claude
  model: claude-haiku-4-5

permissions:
  contents: read

# Per-run + 24h AI-credit budget (the safety win the legacy claude --print lacked).
max-ai-credits: 1500

# Firewall egress allowlist: gh-aw `defaults` (npm / github / apt / ghcr) + the
# Anthropic engine API. Nothing else reaches the agent's network.
network:
  allowed:
    - defaults
    - api.anthropic.com

# Deterministic gate — single source in weekly-update.mts (`--check-updates`
# exits 0 on actionable drift: pnpm outdated / lockstep exit 2 / submodule-behind
# / soaked-cleared exclude). Cadence-agnostic: a soaked-cleared exclude makes the
# daily promotion actionable without a second gate mode. The agent job waits on
# this and reads needs.check-updates.outputs.has-updates.
jobs:
  check-updates:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    outputs:
      cadence: ${{ steps.cadence.outputs.cadence }}
      has-updates: ${{ steps.check.outputs.has-updates }}
    steps:
      - uses: actions/checkout@v5.0.0
        with:
          persist-credentials: false
      - name: Determine cadence
        id: cadence
        shell: bash
        # The daily cron ('0 8 * * *') promotes soaked exclusions only; every
        # other trigger (Monday cron / manual dispatch) runs the full weekly
        # update. gh-aw forbids `${{ github.event.schedule }}` in expressions, so
        # read the triggering cron from the event payload with jq instead.
        run: |
          sched="$(jq -r '.schedule // empty' "$GITHUB_EVENT_PATH" 2>/dev/null || true)"
          if [ "$sched" = "0 8 * * *" ]; then
            echo "cadence=daily" >> "$GITHUB_OUTPUT"
          else
            echo "cadence=weekly" >> "$GITHUB_OUTPUT"
          fi
      - name: Check for actionable updates
        id: check
        shell: bash
        run: |
          if node scripts/fleet/weekly-update.mts --check-updates; then
            echo "has-updates=true" >> "$GITHUB_OUTPUT"
          else
            echo "has-updates=false" >> "$GITHUB_OUTPUT"
          fi

# The agent commits inside its run; gh-aw packages them as a git bundle and a
# safe_outputs job opens a signed (GitHub web-flow GPG) PR.
safe-outputs:
  create-pull-request:
    title-prefix: 'chore(deps): '
    draft: true
    labels: [dependencies, automation]
    # Commits are signed by default (signed-commits: true → GraphQL
    # createCommitOnBranch / GitHub web-flow signature), preserving the fleet's
    # signed-commit invariant without the legacy BOT_GPG_PRIVATE_KEY plumbing.
    #
    # Positive allowlist of paths a PR may change — the UNION of both cadences: a
    # weekly /updating touches manifests / lockfiles / submodules / lockstep; a
    # daily /updating-daily only touches the workspace yaml + lockfile (a subset),
    # so one allowlist safely covers both.
    allowed-files:
      - 'package.json'
      - '*/package.json'
      - 'pnpm-lock.yaml'
      - '*/pnpm-lock.yaml'
      - '.npmrc'
      - 'pnpm-workspace.yaml'
      - '.gitmodules'
      - '.config/lockstep.json'
    # gh-aw protects manifests/lockfiles by default (supply-chain guard) with a
    # request_review block — but changing exactly those IS this workflow's job,
    # and allowed-files already constrains the surface. Disable the redundant gate.
    protected-files: 'allowed'
  # On test failure, escalate to the stronger model via a separate gh-aw workflow
  # (one engine/model per workflow → the fix is its own workflow).
  dispatch-workflow:
    workflows: [get-green]
    max: 1
---

# Dependency update

You are an automated CI agent running the fleet's dependency update. Actionable
updates were detected: `${{ needs.check-updates.outputs.has-updates }}`. If that
is not `true`, do nothing and exit.

## Cadence

Two schedules share this workflow. The cadence for this run is
`${{ needs.check-updates.outputs.cadence }}`:

- **`daily`:** run the `/updating-daily` skill only — promote soaked
  `minimumReleaseAgeExclude` entries whose 7-day soak has cleared, then reconcile
  the lockfile. No npm bumps. Title the PR `promote soaked exclusions
(<YYYY-MM-DD>)`.
- **`weekly`:** run the `/updating` umbrella — npm dependencies, lockstep
  manifest, submodules, and workflow pins. Title the PR `weekly dependency update
(<YYYY-MM-DD>)`.

## Steps

1. Run the cadence-appropriate skill above. Work in CI mode: skip builds/tests
   during the update. Make **atomic commits** (one logical change per commit) so
   the PR history is reviewable. Do NOT push or open a PR yourself — the
   workflow's safe outputs handle that.

2. Build the project if it has a `build` script, then run its tests:

   ```bash
   pnpm run build   # skip if the repo has no build script
   pnpm test
   ```

3. **If tests pass:** open a pull request via the `create_pull_request` safe
   output, titled per the cadence above. Body: a short intro naming the skill that
   ran, then a `<details><summary>View commit history</summary>` block with the
   commit list.

4. **If tests fail:** do NOT open a PR. Dispatch the `get-green` workflow via the
   `dispatch_workflow` safe output, passing the branch and the build/test logs, so
   the stronger model attempts the fix.
