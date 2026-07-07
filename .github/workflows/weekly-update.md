---
# Shared reusable weekly-update — gh-aw agentic workflow. Source of truth: this
# .md. Edit it, then `gh aw compile` → weekly-update.lock.yml (commit BOTH +
# .github/aw/actions-lock.json). The 12 fleet delegators `uses:` the compiled
# .lock.yml@<propagation-sha> (Layer 3 of the shared-workflow cascade).
#
# Replaces the legacy 485-line claude --print reusable workflow. Wins: per-run +
# daily AI-credit budget, firewall egress allowlist, safe-output PR (GitHub
# web-flow-signed + atomic via git-bundle — no BOT_GPG plumbing needed).
on:
  # workflow_dispatch is what makes this trial-able (`gh aw trial` / `gh aw run`
  # both require it) and manually dispatchable; the inputs mirror workflow_call's
  # so a manual run can override the same knobs. Production callers use
  # workflow_call below.
  workflow_dispatch:
    inputs:
      test-setup-script:
        description: 'Command to run before tests (e.g. "pnpm run build")'
        required: false
        type: string
        default: 'pnpm run build'
      test-script:
        description: 'Test command'
        required: false
        type: string
        default: 'pnpm test'
      update-model:
        description: 'Claude model for the update step'
        required: false
        type: string
        default: 'haiku'
  workflow_call:
    inputs:
      branch-prefix:
        description: 'Branch name prefix for the PR branch (date suffix added automatically)'
        required: false
        type: string
        default: 'weekly-update'
      check-timeout-minutes:
        description: 'Timeout for the check-updates job'
        required: false
        type: number
        default: 10
      checkout-fetch-depth:
        description: 'Fetch depth for checkout (0 = full history; recommended for submodule drift analysis)'
        required: false
        type: string
        default: '0'
      checkout-submodules:
        description: 'Submodule init mode: "false", "true" (top-level), or "recursive"'
        required: false
        type: string
        default: 'false'
      fix-model:
        description: 'Claude model for the get-green escalation'
        required: false
        type: string
        default: 'sonnet'
      fix-timeout-minutes:
        description: 'Timeout for the get-green step'
        required: false
        type: number
        default: 15
      pr-base:
        description: 'Base branch for the PR'
        required: false
        type: string
        default: 'main'
      pr-body-extra:
        description: 'Optional markdown appended to the PR body (e.g. cross-linked cascade PRs)'
        required: false
        type: string
        default: ''
      pr-title-prefix:
        description: 'PR title prefix (date suffix added automatically)'
        required: false
        type: string
        default: 'chore(deps): weekly dependency update'
      test-setup-script:
        description: 'Command to run before tests (e.g. "pnpm run build")'
        required: false
        type: string
        default: 'pnpm run build'
      test-script:
        description: 'Test command'
        required: false
        type: string
        default: 'pnpm test'
      test-timeout-minutes:
        description: 'Timeout for the test step'
        required: false
        type: number
        default: 15
      update-model:
        description: 'Claude model for the update step'
        required: false
        type: string
        default: 'haiku'
      update-timeout-minutes:
        description: 'Timeout for the update step'
        required: false
        type: number
        default: 10
      updating-skill:
        description: 'Skill to invoke for the update (defaults to the /updating umbrella)'
        required: false
        type: string
        default: 'updating'
      validate-file-patterns:
        description: 'Pipe-separated case-glob patterns of paths allowed to change'
        required: false
        type: string
        default: 'package.json|*/package.json|pnpm-lock.yaml|*/pnpm-lock.yaml|.npmrc|pnpm-workspace.yaml|.gitmodules|.config/lockstep.json'
    secrets:
      ANTHROPIC_API_KEY:
        description: 'Anthropic API key for Claude'
        required: true
      SOCKET_API_TOKEN:
        description: 'Socket API token — sfw-enterprise instead of sfw-free when provided'
        required: false

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

# Deterministic gate — ports the legacy check-updates job verbatim. The agent
# job waits on this and reads needs.check-updates.outputs.has-updates.
jobs:
  check-updates:
    runs-on: ubuntu-latest
    timeout-minutes: ${{ inputs.check-timeout-minutes }}
    outputs:
      has-updates: ${{ steps.check.outputs.has-updates }}
    steps:
      - uses: actions/checkout@v5.0.0
        with:
          persist-credentials: false
      - name: Check for actionable updates
        id: check
        shell: bash
        # Single source of the gate logic: weekly-update.mts --check-updates
        # exits 0 when there is actionable drift (pnpm outdated / lockstep exit 2
        # / submodule-behind), 1 when there is not. Map that to has-updates.
        run: |
          if node scripts/fleet/weekly-update.mts --check-updates; then
            echo "has-updates=true" >> "$GITHUB_OUTPUT"
          else
            echo "has-updates=false" >> "$GITHUB_OUTPUT"
          fi

# The agent commits inside its run; gh-aw packages them as a git bundle and a
# safe_outputs job opens a signed (GitHub web-flow GPG) PR. protected_files is
# emptied because a dependency-update PR's whole job is to change manifests +
# lockfiles that gh-aw protects by default.
safe-outputs:
  create-pull-request:
    title-prefix: 'chore(deps): weekly dependency update '
    draft: true
    labels: [dependencies, automation]
    # Commits are signed by default (signed-commits: true → GraphQL
    # createCommitOnBranch / GitHub web-flow signature), preserving the fleet's
    # signed-commit invariant without the legacy BOT_GPG_PRIVATE_KEY plumbing.
    #
    # Positive allowlist of paths the PR may change (a dependency update only
    # touches manifests / lockfiles / submodules), replacing the legacy
    # validate-file-patterns warn-step with a hard safe-output constraint.
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
    # and allowed-files already constrains the surface. Disable the redundant
    # review gate.
    protected-files: 'allowed'
  # On test failure, escalate to the stronger model via a separate gh-aw
  # workflow (one engine/model per workflow → the fix is its own workflow).
  dispatch-workflow:
    workflows: [get-green]
    max: 1
---

# Weekly dependency update

You are an automated CI agent running the fleet's weekly dependency update. Updates
were detected: `${{ needs.check-updates.outputs.has-updates }}`. If that is not
`true`, do nothing and exit.

## Steps

1. Run the `/${{ inputs.updating-skill }}` skill to update everything applicable to
   this repo — npm dependencies, lockstep manifest, submodules, and workflow pins.
   Work in CI mode: skip builds/tests during the update. Make **atomic commits**
   (one logical change per commit) so the PR history is reviewable. Do NOT push or
   open a PR yourself — the workflow's safe outputs handle that.

2. Run the test setup + test commands:

   ```
   ${{ inputs.test-setup-script }}
   ${{ inputs.test-script }}
   ```

3. **If tests pass:** open a pull request via the `create_pull_request` safe output.
   Title it `${{ inputs.pr-title-prefix }} (<YYYY-MM-DD>)`. Body: a "## Weekly Update"
   intro noting it ran the `/updating` umbrella (npm + lockstep + submodules +
   pins), then `${{ inputs.pr-body-extra }}` if non-empty, then a
   `<details><summary>View commit history</summary>` block with the commit list,
   then a generated-by footer. Only include files matching
   `${{ inputs.validate-file-patterns }}`; if your changes touch anything outside
   that allowlist, call it out in the PR body for human review.

4. **If tests fail:** do NOT open a PR. Dispatch the `get-green` workflow via
   the `workflow_call` safe output, passing the branch and the build/test logs, so
   the stronger `${{ inputs.fix-model }}` model attempts the fix.
