---
# Shared reusable get-green — gh-aw sonnet-tier worker dispatched by
# weekly-update when a dependency update breaks tests. Edit this .md, then
# `gh aw compile` → get-green.lock.yml (commit BOTH +
# .github/aw/actions-lock.json).
#
# The two-model escalation (haiku update → sonnet fix) is expressed as two
# workflows because gh-aw is one engine/model per workflow.
on:
  # Dispatched by weekly-update's `dispatch-workflow` safe output on test
  # failure (gh-aw dispatch fires workflow_dispatch, not workflow_call).
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
        default: 'package.json|*/package.json|pnpm-lock.yaml|*/pnpm-lock.yaml|.npmrc|pnpm-workspace.yaml|.gitmodules|.config/lockstep.json'

engine:
  id: claude
  model: claude-sonnet-4-5

permissions:
  contents: read

# Sonnet is the pricier escalation tier — a higher per-run cap than the haiku update.
max-ai-credits: 3000

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

## Context

Build output (last 100 lines):

```
${{ inputs.build-log }}
```

Test output (last 100 lines):

```
${{ inputs.test-log }}
```

## Steps

1. Diagnose and fix the failures. Make **atomic commits**. Do NOT revert the
   dependency updates themselves — fix the code/config that broke against the new
   versions. Do NOT push or open a PR yourself.

2. Re-run the test setup + tests to confirm green:

   ```
   ${{ inputs.test-setup-script }}
   ${{ inputs.test-script }}
   ```

3. If tests now pass, open the pull request via the `create_pull_request` safe
   output (title `${{ inputs.pr-title-prefix }} (<YYYY-MM-DD>)`, a body noting the
   update + the fixes applied). Keep changes within
   `${{ inputs.validate-file-patterns }}` plus whatever source files the fix
   required; call out any out-of-allowlist files in the PR body. If tests still
   fail after your best effort, do NOT open a PR — leave the branch for human review.
