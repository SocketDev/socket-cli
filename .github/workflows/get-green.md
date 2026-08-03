---
# Shared reusable get-green — gh-aw sonnet-tier worker dispatched by
# weekly-update when a dependency update breaks tests. Edit this .md, then
# `gh aw compile` → get-green.lock.yml (commit BOTH +
# .github/aw/actions-lock.json).
#
# The two-model escalation (haiku update → sonnet fix) is expressed as two
# workflows because gh-aw is one engine/model per workflow.
#
# `name` sets the Actions-UI label so it matches the filename; without it gh-aw
# falls back to the body H1, which is written for the agent, not the sidebar.
name: '🟢 Get Green'
on:
  # Dispatched by weekly-update's `dispatch-workflow` safe output on test
  # failure (gh-aw's dispatch-workflow fires workflow_dispatch events).
  workflow_dispatch:
    inputs:
      branch:
        description: 'The update branch with the failing changes to fix'
        required: true
        type: string
      build-log:
        description: 'Last 100 lines of the failing build output'
        required: false
        type: string
        default: ''
      test-log:
        description: 'Last 100 lines of the failing test output'
        required: false
        type: string
        default: ''
      fix-model:
        description: 'Claude model for the fix (the escalation tier)'
        required: false
        type: string
        default: 'sonnet'
      fix-timeout-minutes:
        description: 'Timeout for the fix step'
        required: false
        type: number
        default: 15
      pr-base:
        description: 'Base branch for the PR'
        required: false
        type: string
        default: 'main'
      pr-title-prefix:
        description: 'PR title prefix'
        required: false
        type: string
        default: 'chore(deps): weekly dependency update'
      test-setup-script:
        description: 'Command to run before tests'
        required: false
        type: string
        default: 'pnpm run build'
      test-script:
        description: 'Test command'
        required: false
        type: string
        default: 'pnpm test'
      validate-file-patterns:
        description: 'Pipe-separated case-glob patterns of paths allowed to change'
        required: false
        type: string
        default: 'package.json|*/package.json|pnpm-lock.yaml|*/pnpm-lock.yaml|.npmrc|pnpm-workspace.yaml|.gitmodules|.config/repo/lockstep.json'

engine:
  id: claude

# Top-level, not `engine.model` — gh-aw deprecated the nested key in v0.83.x and
# the compiler warns on every build until it moves.
model: claude-sonnet-4-6

permissions:
  contents: read

# Sonnet is the pricier escalation tier — a higher per-run cap than the haiku update.
max-ai-credits: 3000

# Fallback pricing for any model missing from AWF's build-time-frozen
# ai-credits table — gh-aw v0.83.2, ADR-47687. Without it, max-ai-credits +
# an unknown model 400s every request: the 2026-07-25 fleet outage class.
# Priced at the opus tier, the highest this fleet would tolerate, so an
# unknown model is over-counted against the credit cap and trips the budget
# early — never under-counted.
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

network:
  allowed:
    - defaults
    - api.anthropic.com

steps:
  - uses: actions/checkout@v5.0.0
    with:
      ref: ${{ inputs.branch }}
      fetch-depth: '0'
      persist-credentials: false

safe-outputs:
  create-pull-request:
    title-prefix: 'chore(deps): weekly dependency update '
    draft: true
    labels: [dependencies, automation]
---

# Fix dependency-update test failures

A weekly dependency update was applied on branch `${{ inputs.branch }}`, but the
build/tests are failing. Fix the failures so the update can ship.

## Never write a credential into a report

Everything you emit — issue bodies, comments, pull-request descriptions, and the
`missing_data` and incomplete-result paths — is posted verbatim to a repository
that may be public. Never write a string shaped like a credential into any of
them.

That includes a value you invent to illustrate a point. A made-up key is
indistinguishable from a real one to a secret scanner, to a reader, and to a
crawler, so it opens a real alert that a human then has to investigate and
disprove. Writing "the key looked like `AKIA` followed by twenty characters"
costs nothing; writing a filled-in example costs someone an investigation.

Read the build and test output below with that in mind. It is raw CI output, so
it can contain a token some tool printed. Quoting a failing line straight back
into a report is the easy way to leak one. Quote the error, not the surrounding
output, and drop any fragment shaped like a key.

Describe the credential instead of reproducing it. Write "the API key is missing
from the environment", never the key itself and never a stand-in for it.

These are the shapes the fleet's own scanners block. Treat any string matching
one as unpublishable, and note the list is not exhaustive — an unfamiliar
vendor's key is still a key.

<!-- BEGIN GENERATED token-shapes: scripts/fleet/gen/aw-token-shapes.mts -->

- AWS access key ID (AKIA)
- Anthropic API key (sk-ant-)
- DigitalOcean PAT (dop_v1_)
- GitHub OAuth token (gho_)
- GitHub app server token (ghs_)
- GitHub fine-grained PAT
- GitHub personal access token (ghp_)
- GitHub refresh token (ghr_)
- GitHub user access token (ghu_)
- GitLab PAT (glpat-)
- Google API key (AIza)
- Hugging Face token (hf_)
- JWT
- Linear API token (lin_api_)
- OpenAI project key (sk-proj-)
- OpenAI/Anthropic-style secret key (sk-)
- Slack token (xox_-)
- Socket API key (sktsec_)
- Stripe live publishable (pk_live_)
- Stripe live restricted (rk_live_)
- Stripe live secret (sk_live_)
- Stripe test secret (sk_test_)
- Val Town token (vtwn_)
- npm access token (npm_)
- private key (PEM block)

<!-- END GENERATED token-shapes -->

## Context

Build output (last 100 lines):

```text
${{ inputs.build-log }}
```

Test output (last 100 lines):

```text
${{ inputs.test-log }}
```

## Steps

1. Diagnose and fix the failures. Make **atomic commits**. Do NOT revert the
   dependency updates themselves — fix the code/config that broke against the new
   versions. Do NOT push or open a PR yourself.

2. Confirm green through the deterministic executor — never by reading the test
   output yourself:

   ```bash
   pnpm run get-green -- \
     --setup "${{ inputs.test-setup-script }}" \
     --test "${{ inputs.test-script }}" \
     --base "${{ inputs.pr-base }}" \
     --patterns "${{ inputs.validate-file-patterns }}"
   ```

   `get-green.mts` runs the setup + test commands, prints the log tails, and
   classifies every changed path against the allowlist. Its EXIT CODE is the
   verdict: 0 means the branch may open a pull request, non-zero means it may
   not. That decision is not yours to make — a red branch has to reach a human,
   and an agent that talked itself into "close enough" is exactly what the exit
   code exists to prevent.

3. Open the pull request ONLY if step 2 exited 0. Use the `create_pull_request`
   safe output, title `${{ inputs.pr-title-prefix }} (<YYYY-MM-DD>)`, with a body
   noting the update and the fixes applied. The script prints any paths outside
   `${{ inputs.validate-file-patterns }}`; copy that list into the PR body so a
   reviewer sees what the fix touched beyond the manifests. If step 2 exited
   non-zero after your best effort, do NOT open a PR — leave the branch for human
   review and say what you tried.
