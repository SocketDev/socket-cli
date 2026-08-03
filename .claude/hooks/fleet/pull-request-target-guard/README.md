# pull-request-target-guard

`PreToolUse(Edit|Write)` blocker for `.github/workflows/*.yml` that combines the three high-risk patterns:

1. `on: pull_request_target` — runs in the BASE repo's context with secrets.
2. `actions/checkout` with `ref: ${{ github.event.pull_request.head.* }}` — checks out the FORK's code (attacker-controlled).
3. Subsequent execute-fork-code step (`pnpm i`, `npm i`, `yarn`, `bun i`, `pip install`, `cargo build`, `go build`, `make`, etc.).

When all three are present, a fork PR can exfiltrate the base repo's secrets via a malicious `prepare` / `postinstall` script or build step. `--ignore-scripts` neutralizes installs but not builds — the hook only treats install-script-bypassed installs as safe; build steps still trip.

## Coverage relative to zizmor

[zizmor](https://docs.zizmor.sh/audits/) already flags `pull_request_target` use via `dangerous-triggers` (High, default-on) plus several collateral audits (`bot-conditions`, `github-env`, `template-injection`, `overprovisioned-secrets`, `artipacked`).

This hook adds the **specific exploitation path**: not "you used a dangerous trigger" but "you used the dangerous trigger AND did the exact thing that exfiltrates secrets." Surfaces the issue at edit time before zizmor would catch it at commit/CI time.

## Bypass

`Allow pr-target-execution bypass` in a recent user turn. Rare — the safer patterns (split workflows, `labeled`-gated triggers, never check out fork code in privileged context) cover ~all legitimate use cases.

## Reference

The threat write-up that prompted this hook: <https://bsky.app/profile/43081j.com/post/3mlnme43qnc2e>

The rule lives in [`CLAUDE.md`](../../../CLAUDE.md) under "Public-surface hygiene".
