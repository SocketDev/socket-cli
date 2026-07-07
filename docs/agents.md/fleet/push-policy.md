# Push policy

## The rule

Default to `git push origin <branch>` on the current branch (typically `main`). If the push is rejected (branch protection requires a PR, conflicts, signature/identity rejection), open a PR via `gh pr create` against the default base. Don't pre-open PRs "to be safe"; the direct-push happy path is faster for the operator. Don't force-push to recover; resolve the cause (rebase to fix conflicts, fix the commit identity, etc.).

A reminder fires when `gh pr create` is invoked without an explicit user directive ("PR this", "open a PR"). Enforced by `.claude/hooks/fleet/pr-vs-push-default-nudge/`.

## Enterprise-ruleset escape hatch

Some SocketDev repos sit under an enterprise-level ruleset (Socket enterprise → ruleset attached to `refs/heads/main`) that rejects direct pushes with:

```
remote: - Required workflow '<name>' is not satisfied
remote: - Changes must be made through a pull request.
```

These two rules sit ABOVE per-repo admin permission. Repository-level admins cannot bypass them. Only members of the ruleset's explicit `bypass_actors` list can push around them.

The fleet has a documented escape hatch: the **`temporarily-doesnt-touch-customers` custom property** on the repo.

### How it works

Two repo custom properties gate the cascade's review-skip path:

- `doesnt-touch-customers`: permanent. Customer-facing surface is zero. Direct push doesn't risk surprising a customer.
- `temporarily-doesnt-touch-customers`: short-lived. Same as above but signals an in-flight remediation window.

When either is set to the literal string `"true"`, the cascade's `canSkipReviewGate()` check (in `socket-wheelhouse/scripts/_shared/repo-properties.mts`) allows direct push for routine cascade work. Anything else (`"false"`, `"Choose the value"` placeholder, missing entirely, API failure) falls back to "open a PR".

The strict `=== "true"` match is deliberate. A misconfigured token, transient API blip, or unset placeholder defaults to the safer "open a PR" path rather than silently pushing to main.

### Operator flow when push is blocked

1. Push fails with the enterprise-ruleset error pattern above.
2. The `enterprise-push-nudge` Stop-hook surfaces the bypass mechanism inline.
3. Operator goes to https://github.com/SocketDev/`<repo>`/settings/properties and flips `temporarily-doesnt-touch-customers`to`true`.
4. Re-run `git push origin main`. It succeeds.
5. After the in-flight remediation window closes, operator flips the property back to `false` (re-engaging the ruleset).

The bypass is manual (UI flip) on purpose. Automated bypass would defeat the property's role as an attestation that the operator has consciously decided customer-facing risk is zero for this window.

### Why not just `gh pr merge --admin`?

Admin-merge is a valid alternative but creates a transient PR + branch that needs cleanup. The property-flip path is cleaner for cascade work where the intent is "this is routine maintenance, no review-gate value would be added."

For one-off pushes where review-gating IS the right answer, use the PR + admin-merge flow per the cross-repo handoff convention.

## Reading the hook's reminder

When the `enterprise-push-nudge` hook fires after a failed push, it surfaces:

- The exact error pattern from the push output
- The property name and the literal value required (`"true"`, not `true`, not `True`)
- A link to this doc and to the repo's properties page
- The current state of the property (queried via `gh api repos/<owner>/<repo>/properties/values`)

The hook is informational only. It does not modify the property or retry the push. The operator decides whether the bypass is appropriate for the current change set.
