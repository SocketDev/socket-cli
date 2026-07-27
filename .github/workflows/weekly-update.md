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
  # Dated snapshot id ON PURPOSE — do not "simplify" back to the bare alias.
  # Anthropic's live /v1/models lists Haiku 4.5 only in dated form, so the bare
  # `claude-haiku-4-5` never direct-matches in the AWF api-proxy model resolver
  # and every request falls through to token steering's middle-power MEDIAN of
  # the live model list. That median silently served claude-opus-4-8 for weeks,
  # then broke fleet-wide on 2026-07-25 when Anthropic added claude-opus-5 to
  # the live list: the median shifted onto an id absent from AWF's frozen
  # ai-credits pricing table and, with max-ai-credits set and no default
  # pricing, every first model request 400'd (unknown_model_ai_credits). The
  # dated id direct-matches, prices at haiku rates ($1/$5 per Mtok) in the AWF
  # table, and keeps this workflow on the tier the routing doctrine assigns
  # (haiku = mechanical). It is also registered in
  # scripts/fleet/constants/model-pricing.json via update-model-pricing.mts so
  # the gh-aw-workflow-models-are-canonical gate recognizes it.
  model: claude-haiku-4-5-20251001

permissions:
  contents: read
  issues: read
  pull-requests: read

# Per-run + 24h AI-credit budget — the safety win the legacy claude --print lacked.
max-ai-credits: 1500

# Fallback pricing for any model missing from AWF's build-time-frozen
# ai-credits table — gh-aw v0.83.2, ADR-47687. Without it, max-ai-credits +
# an unknown model 400s every request: the 2026-07-25 fleet outage, when
# token steering's middle-power median landed on a model the frozen table
# could not price. Priced at the opus tier, the highest this fleet would
# tolerate, so an unknown model is over-counted against the credit cap and
# trips the budget early — never under-counted. Defense in depth alongside
# the dated engine pin above, not a replacement for it.
# KEY LOCATION IS SCHEMA-VERIFIED, NOT DOCS-VERIFIED: the v0.83.2 release
# notes place this key under sandbox.agent, but the v0.83.2 schema
# authoritatively defines it at models.default-ai-credits-pricing — see
# pkg/parser/schemas/main_workflow_schema.json at that tag, confirmed by the
# compiled lock emitting apiProxy.defaultAiCreditsPricing. Trust the schema
# over the release notes when moving this key on a compiler bump; gh-aw main
# has since refactored the sandbox.agent variant into models.*.
models:
  default-ai-credits-pricing:
    input: 5.0
    output: 25.0

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

# Pre-agent provisioning in the AGENT job. gh-aw inserts these custom steps
# right after its github-app checkout (they contain no checkout of their own,
# so gh-aw keeps its injected one). The agent cannot provision itself: corepack
# cannot parse the devEngines.packageManager RANGE pin (and fleet rules forbid
# corepack), so without this the agent job has no pnpm and no node_modules and
# the update spine (`pnpm run update` / build / test) is dead on arrival.
steps:
  # Fleet-pinned pnpm through the Socket firewall (sfw shims) + `pnpm install`.
  # checkout: 'false' — gh-aw's github-app checkout above already populated the
  # workspace this local composite resolves from.
  - name: Setup and install
    uses: ./.github/actions/fleet/setup-and-install
    with:
      checkout: 'false'
  - name: Expose pnpm inside the agent sandbox
    shell: bash
    run: |
      # The agent executes inside the AWF firewall container, which sees the
      # workspace + RUNNER_TOOL_CACHE but NOT ${RUNNER_TEMP}/pnpm-bin where
      # setup-and-install staged pnpm (only ${RUNNER_TEMP}/gh-aw is mounted).
      # The gh-aw harness prepends every bin/ dir under RUNNER_TOOL_CACHE to
      # the container PATH, so stage the pnpm binary there. The sfw shim stays
      # host-only: inside the sandbox the AWF egress allowlist (network:
      # above) is the firewall.
      mkdir -p "${RUNNER_TOOL_CACHE}/fleet-pnpm/bin"
      cp -a "${RUNNER_TEMP}/pnpm-bin/." "${RUNNER_TOOL_CACHE}/fleet-pnpm/bin/"

# Deterministic gate — single source in weekly-update.mts (`--check-updates`
# exits 0 on actionable drift: pnpm outdated / lockstep exit 2 / submodule-behind
# / soaked-cleared exclude). Cadence-agnostic: a soaked-cleared exclude makes the
# daily promotion actionable without a second gate mode. The agent job waits on
# this and reads needs.check-updates.outputs.has-updates.
jobs:
  check-updates:
    runs-on: ubuntu-latest
    # 15, not 10: the job now also provisions pnpm + runs `pnpm install`
    # (setup-and-install below) before the gate script.
    timeout-minutes: 15
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
      # Provision the fleet-pinned pnpm (through the Socket firewall) and
      # install node_modules — the gate script below imports
      # @socketsecurity/lib-stable from the workspace, so a bare checkout dies
      # with ERR_MODULE_NOT_FOUND. checkout: 'false' keeps the bootstrap
      # checkout above as the only fetch.
      - name: Setup and install
        uses: ./.github/actions/fleet/setup-and-install
        with:
          checkout: 'false'
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
  # A no-op run is the healthy steady state for a scheduled updater — most days
  # nothing both drifts AND has cleared the 7-day soak, so the agent legitimately
  # makes no changes and exits. gh-aw's default appends every such run to an
  # "[aw] No-Op Runs" tracking issue, which is pure noise. Silence it — genuine
  # failures still surface via the missing-tool / incomplete-result /
  # engine-failure issue paths, which stay on.
  noop:
    report-as-issue: false
  create-pull-request:
    title-prefix: 'chore(deps): '
    draft: true
    labels: [dependencies, automation]
    # Commits are signed by default (signed-commits: true → GraphQL
    # createCommitOnBranch / GitHub web-flow signature), preserving the fleet's
    # signed-commit invariant without the legacy BOT_GPG_PRIVATE_KEY plumbing.
    #
    # Positive allowlist of paths a PR may change — the UNION of both cadences
    # plus every deterministic writer in the update flow. A weekly /updating
    # touches manifests / lockfiles / submodules / lockstep; a daily
    # /updating-daily only touches the workspace yaml + lockfile, a subset.
    # Matcher semantics per the pinned v0.83.2 glob_pattern_helpers: anchored
    # full-path match, `*` never crosses `/`, `**` does.
    #
    # Deliberately NOT allowed — these stay gate-blocked for human review:
    # model-pricing writes, since vendor pricing pages are egress-blocked in
    # this workflow and a CI pricing diff would mean fabricated numbers; new
    # pnpm compat patches under patches/, which are judgment-heavy and
    # review-worthy; and advisory lockstep surfaces — file-fork mirrors and
    # the .prettierignore mirror-globs block — which the weekly agent never
    # auto-applies.
    allowed-files:
      - 'package.json'
      # Workspace member manifests at ANY depth — socket-registry nests them
      # two deep — bumped by updates and spliced by the fix-harness doctor's
      # catalog fixer.
      - '**/package.json'
      - 'pnpm-lock.yaml'
      - '*/pnpm-lock.yaml'
      - '.npmrc'
      - 'pnpm-workspace.yaml'
      - '.gitmodules'
      - '.config/repo/lockstep.json'
      - '.config/lockstep.json'
      # update.mts pass 3a — fleet-pin lockstep + `-stable` alias reconcile —
      # mirrors catalog bumps into the cascaded fleet catalog every member
      # carries, in the same wave as the live bump.
      - '.config/fleet/pnpm-workspace.fleet.yaml'
      # Lockstep version-pin rows auto-bump submodule gitlinks; the fleet
      # convention roots every submodule at upstream/<name>. Single-star
      # matches exactly the gitlink entry, never files inside the submodule.
      - 'upstream/*'
      # Coverage phase: scripts/fleet/gen/coverage-badge.mts rewrites the root
      # README badge reference and the repo-local badge SVG — the 2026-07-27
      # socket-registry gate block.
      - 'README.md'
      - 'assets/repo/badges/coverage.svg'
      # The fix harness runs the deterministic CLAUDE.md fleet-block over-cap
      # trimmer, scripts/fleet/lib/claude-md-trim.mts — the 2026-07-27
      # socket-btm gate block. The trim converges on the canonical template
      # content, so letting it ride the weekly PR beats blocking the run.
      - 'CLAUDE.md'
      # Wheelhouse-only twins of the writers above, absent in member repos:
      # the template CLAUDE.md trim target, the stable-alias reconcile +
      # fleet-pin mirror into the canonical template catalogs, and the
      # override-pin manifest applyOverridePinLockstep rewrites.
      - 'template/base/CLAUDE.md'
      - 'template/base/pnpm-workspace.yaml'
      - 'template/base/.config/fleet/pnpm-workspace.fleet.yaml'
      - 'scripts/repo/sync-scaffolding/manifest/catalog-overrides.mts'
    # gh-aw protects manifests/lockfiles by default (supply-chain guard) with a
    # request_review block — but changing exactly those IS this workflow's job,
    # and allowed-files already constrains the surface. Disable the redundant gate.
    protected-files: 'allowed'
  # On test failure, escalate to the stronger model via a separate gh-aw
  # workflow — one engine/model per workflow, so the fix is its own workflow.
  # This is a custom safe-job, NOT the dispatch-workflow safe-output: declaring
  # dispatch-workflow makes the v0.83.2 compiler add actions:write to the
  # safe_outputs/conclusion app mint — pkg/workflow/safe_output_handlers.go
  # returns NewPermissionsActionsWrite unconditionally, token-blind — and the
  # Socket PR App deliberately carries no actions permission: the fleet
  # composite github-pr-app-token declares contents/issues/pull-requests write
  # as the exact scope this app needs, so every mint failed with "The
  # permissions requested are not granted to this installation". The safe-job
  # keeps the agent-driven dispatch but rides the job's own default
  # GITHUB_TOKEN, which CAN dispatch same-repo workflows because this job —
  # unlike the workflow-level `permissions: {}` default — explicitly grants
  # actions:write. The app mint shrinks back to exactly the composite trio.
  jobs:
    dispatch-get-green:
      description: 'Dispatch the get-green fix workflow when a dependency update breaks the build or tests'
      runs-on: ubuntu-latest
      output: 'get-green dispatched — the sonnet-tier fix worker takes it from here'
      permissions:
        actions: write
      inputs:
        branch:
          description: 'The update branch with the failing changes to fix'
          required: true
          type: string
        build-log:
          description: 'Last 100 lines of the failing build output'
          required: false
          type: string
        test-log:
          description: 'Last 100 lines of the failing test output'
          required: false
          type: string
      steps:
        - name: Dispatch get-green
          env:
            GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          run: |
            # Read the agent's dispatch_get_green item from the safe-outputs
            # artifact. No GitHub expression interpolation in the shell body —
            # a literal dollar-brace pair here would even fail workflow parsing,
            # since run blocks are expression-evaluated, unlike YAML comments.
            # Inputs arrive via jq from the artifact and via env, zizmor
            # expression-injection.
            set -euo pipefail
            item="$(jq -c '[.items[] | select(.type == "dispatch_get_green")][0]' "$GH_AW_AGENT_OUTPUT")"
            if [ -z "$item" ] || [ "$item" = "null" ]; then
              echo "no dispatch_get_green item in agent output" >&2
              exit 1
            fi
            branch="$(jq -r '.branch // empty' <<<"$item")"
            if [ -z "$branch" ]; then
              echo "dispatch_get_green item is missing the required branch input" >&2
              exit 1
            fi
            build_log="$(jq -r '.["build-log"] // ""' <<<"$item")"
            test_log="$(jq -r '.["test-log"] // ""' <<<"$item")"
            gh workflow run get-green.lock.yml \
              --repo "$GITHUB_REPOSITORY" \
              --ref "$GITHUB_REF_NAME" \
              -f "branch=$branch" \
              -f "build-log=$build_log" \
              -f "test-log=$test_log"
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

4. **If tests fail:** do NOT open a PR. Call the `dispatch_get_green` tool with
   the branch and the last 100 lines of the failing build and test logs, so the
   stronger model attempts the fix in the dispatched `get-green` workflow.
