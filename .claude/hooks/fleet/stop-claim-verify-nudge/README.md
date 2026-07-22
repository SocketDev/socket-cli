# stop-claim-verify-nudge

`Stop` hook. Fires at turn-end. Scans the last assistant turn for a SELF-CLAIM
that an action succeeded — "tests pass", "the build succeeds", "X is fixed",
"verified" — and checks whether a tool call THIS SESSION actually ran the
command that would back it. When the claim has no backing tool call, it emits a
stderr reminder: run it, or qualify the claim.

## Why

The fleet rule (CLAUDE.md "Judgment & self-evaluation" → "Verify before you
claim"): never assert "tests pass" / "builds" / "X exists" without a tool call
this session that ran or read it. This is the verify-before-**claim** sibling of
verify-before-**trust**: `excuse-detector` already catches relaying ANOTHER
agent's unverified count; this catches the assistant's OWN unbacked success
claim — the failure mode where a turn ends "done, tests pass" with no test run.

## Categories + backing signals

A claim fires only when NONE of its backing signals appears in any Bash command
run this session:

| Claim                    | Backed by                                   |
| ------------------------ | ------------------------------------------- |
| tests pass / green       | `vitest`, `pnpm test`, `node --test`        |
| build succeeds / clean   | `pnpm build`, `run build`, `rolldown`       |
| typechecks / no type err | `tsgo`, `tsc`, `pnpm run check`             |
| lint passes / clean      | `oxlint`, `pnpm run lint`, `pnpm run check` |

Claims inside a code fence — an example, a quoted plan — are ignored.

## Not a blocker

Stop hooks fire after the turn ended — there is nothing to refuse. The reminder
surfaces the unbacked claim at the turn that made it, so the next turn runs the
check or qualifies. Exit code is always 0.

The rule lives in [`CLAUDE.md`](../../../CLAUDE.md) under "Judgment &
self-evaluation"; detail in
[`docs/agents.md/fleet/judgment-and-self-evaluation.md`](../../../docs/agents.md/fleet/judgment-and-self-evaluation.md).
