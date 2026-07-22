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
  issues: read
  pull-requests: read

# Per-run + 24h AI-credit budget — the safety win the legacy claude --print lacked.
max-ai-credits: 1500

# Auth without a PAT: the Socket PR App mints a short-lived installation token
# per run for gh-aw's checkout, the GitHub MCP server, and the safe-output PR.
# gh aw compile injects actions/create-github-app-token and revokes at run end;
# it falls back to GH_AW_GITHUB_TOKEN || GITHUB_TOKEN only when the app secrets
# are absent (ignore-if-missing). The custom check-updates job below mints its
# own token pre-checkout (gh-aw does not inject minting into custom jobs).
tools:
  github:
    github-app:
      client-id: ${{ vars.SOCKET_PR_CLIENT_ID }}
      private-key: ${{ secrets.SOCKET_PR_APP_PRIVATE_KEY }}
      owner: ${{ github.repository_owner }}

checkout:
  # No ignore-if-missing here: the creds-presence gate gh-aw generates for it
  # nests a ${{ }} inside the safe-output checkout's `if:` (zizmor
  # unsound-condition), and the github.token fallback would 404 on this private
  # repo anyway. The SocketDev PR-App org creds are always present fleet-wide.
  github-app:
    client-id: ${{ vars.SOCKET_PR_CLIENT_ID }}
    private-key: ${{ secrets.SOCKET_PR_APP_PRIVATE_KEY }}
    owner: ${{ github.repository_owner }}

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
      # Mint a Socket PR-App installation token pre-checkout so the private-repo
      # fetch authenticates — the default GITHUB_TOKEN is denied by org policy
      # ("Repository not found"). Secrets can't be read in `if:`, so reflect the
      # key's presence into an output; the checkout falls back to github.token
      # when the app secrets are absent.
      - name: Detect PR-App credentials
        id: pr_app_creds
        shell: bash
        env:
          PR_APP_KEY: ${{ secrets.SOCKET_PR_APP_PRIVATE_KEY }}
        run: |
          if [ -n "$PR_APP_KEY" ]; then
            echo 'present=true' >> "$GITHUB_OUTPUT"
          else
            echo 'present=false' >> "$GITHUB_OUTPUT"
          fi
      - name: Mint PR-App token
        id: pr_app_token
        if: steps.pr_app_creds.outputs.present == 'true'
        uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
        with:
          app-id: ${{ vars.SOCKET_PR_APP_ID }}
          private-key: ${{ secrets.SOCKET_PR_APP_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}
          # Least-privilege: this token only authenticates the read-only
          # checkout fetch of THIS repo (zizmor github-app audit).
          repositories: ${{ github.event.repository.name }}
          permission-contents: read
      # Plain actions/checkout can't authenticate the private-repo git fetch in
      # this environment (fatal: Repository not found). Use the same manual
      # bootstrap the fleet CI uses: route context through env (no ${{ }} in the
      # shell body — zizmor expression-injection), authorize the fetch inline via
      # an x-access-token extraheader, and never persist it to .git/config.
      - name: Bootstrap checkout
        shell: bash
        env:
          GITHUB_TOKEN: ${{ steps.pr_app_token.outputs.token || github.token }}
          SERVER_URL: ${{ github.server_url }}
          REPOSITORY: ${{ github.repository }}
          TRIGGER_SHA: ${{ github.sha }}
        run: |
          set -euo pipefail
          git init -q
          git config --local advice.detachedHead false
          git remote remove origin 2>/dev/null || true
          git remote add origin "${SERVER_URL}/${REPOSITORY}"
          FETCH_ARGS=(--no-tags --prune --depth 1 origin "${TRIGGER_SHA}")
          if [ -n "${GITHUB_TOKEN}" ]; then
            AUTH_B64="$(printf 'x-access-token:%s' "${GITHUB_TOKEN}" | base64 | tr -d '\n')"
            git -c "http.${SERVER_URL}/.extraheader=AUTHORIZATION: basic ${AUTH_B64}" fetch "${FETCH_ARGS[@]}"
          else
            git fetch "${FETCH_ARGS[@]}"
          fi
          git checkout -q --detach FETCH_HEAD
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
  # No ignore-if-missing on any github-app block: gh-aw's presence-gate for it
  # emits `if: ${{ … secrets.X != '' }}`, which GitHub rejects (the `secrets`
  # context is not valid in `if:`). The SocketDev PR-App org creds are always
  # present fleet-wide, so the mint is unconditional.
  github-app:
    client-id: ${{ vars.SOCKET_PR_CLIENT_ID }}
    private-key: ${{ secrets.SOCKET_PR_APP_PRIVATE_KEY }}
    owner: ${{ github.repository_owner }}
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
      - '.config/repo/lockstep.json'
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
