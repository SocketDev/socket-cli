# enterprise-push-reminder

A **Claude Code PostToolUse hook** that fires after a `git push` rejected by the Socket enterprise ruleset, and surfaces the canonical bypass: the repo's `temporarily-doesnt-touch-customers` custom property.

## Why this exists

Some SocketDev repos sit under an enterprise-level GitHub ruleset on `refs/heads/main` that rejects direct pushes with:

```
remote: - Required workflow '<name>' is not satisfied
remote: - Changes must be made through a pull request.
```

These rules sit ABOVE per-repo admin. The fleet escape hatch — the wheelhouse-canonical mechanism — is the per-repo custom property `temporarily-doesnt-touch-customers === "true"`. When set, `canSkipReviewGate()` in `socket-wheelhouse/scripts/_shared/repo-properties.mts` allows direct push for routine cascade work.

The hook makes this discoverable. Without it, the rejection error leaves the operator (or the next assistant turn) guessing which of "open a PR / `gh pr merge --admin` / disable the ruleset / something else" is right. The property is the actual answer for routine work.

## What it does

1. PostToolUse on every `Bash` call.
2. Filters to commands matching `\bgit\s+push\b`.
3. Inspects `tool_response` for the enterprise-ruleset rejection pattern (both `Repository rule violations found` AND `Changes must be made through a pull request` must be present — single-match would false-fire on generic push errors).
4. On match: writes a stderr reminder to Claude with:
   - The property name + required literal-string value (`"true"`)
   - The current property value (queried via `gh api repos/{owner}/{repo}/properties/values`)
   - A link to the repo's properties page in the GitHub UI
   - A pointer to `docs/claude.md/fleet/push-policy.md` for full rationale

The hook **does not** modify the property or retry the push. The operator decides whether the bypass is appropriate for the current change set.

## Exit semantics

- Exit 0 with stderr message on match (informational, doesn't block).
- Exit 0 silent on any non-match path (wrong tool, wrong command, no ruleset error).
- Exit 0 silent on any internal error (fail-open — a bad hook deploy can't suppress legitimate push errors).

## When NOT to expect a reminder

- The push succeeded.
- The push failed for a non-ruleset reason (auth, conflict, signature mismatch).
- The push wasn't actually `git push` (e.g. `gh push` or `git-lfs push`).
- The repo isn't under the Socket enterprise ruleset.

The pattern requires both error lines for a tight match — generic "permission denied" or "branch protection" failures don't trip it.

## See also

- `docs/claude.md/fleet/push-policy.md` — full rationale + operator flow.
- `scripts/_shared/repo-properties.mts` — `canSkipReviewGate()` implementation used by the cascade.
- `.claude/hooks/fleet/pr-vs-push-default-reminder/` — sibling hook for the reverse case (Claude opening a PR when direct push would have worked).
