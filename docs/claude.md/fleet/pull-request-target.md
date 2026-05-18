# `pull_request_target` is privileged

`pull_request_target` runs in the BASE repo's context with the BASE repo's secrets — that's the threat model. Two combinations are forbidden:

1. **Checkout fork code + execute it.** `actions/checkout` of `${{ github.event.pull_request.head.* }}` followed by any step that runs the checked-out code (`pnpm i`, `npm i`, `pnpm build`, `cargo build`, `make`, `node scripts/*`, etc.) gives the fork's PR author arbitrary code execution in a privileged context. They can exfil the workflow's secrets via the runner.
2. **Even without execution, fork content can shape the workflow.** A fork's `package.json` `scripts.preinstall` or a fork-modified `.npmrc` runs during `pnpm i`. Treat all fork-supplied files as untrusted input.

## Safer patterns

### Split-workflow (preferred)

- A `pull_request` workflow does the build in the fork's context (no BASE secrets).
- It uploads the result as an artifact (`actions/upload-artifact`).
- A `workflow_run` workflow (triggered by the prior workflow's completion) downloads the artifact, optionally re-signs it, and posts the PR comment with the BASE-repo token.

Crucially: the `workflow_run` step **does not check out fork code**. It only consumes the artifact produced by the unprivileged build.

### `types: [labeled]` gate

If you genuinely need `pull_request_target` semantics (e.g. to access a secret-driven comment-poster), gate it on `types: [labeled]` so only a maintainer who manually labels the PR can trigger the privileged run. This shifts the threat model to maintainer review: they MUST read the diff before applying the label.

## Enforcement

The `.claude/hooks/pull-request-target-guard/` hook scans workflow YAML for the combo and blocks edits that introduce it. The hook is byte-identical across fleet repos; the rule is the contract, the hook is the enforcer.
