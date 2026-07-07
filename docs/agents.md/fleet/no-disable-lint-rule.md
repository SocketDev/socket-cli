# Don't disable lint rules

## The rule

Lint rules exist to catch real classes of bug or style drift. Adding `"some-rule": "off"` (or `"warn"`) to any of these files weakens the gate **for every file matching that selector**, not just the one violation that triggered the temptation:

- `.config/fleet/oxlintrc.json`
- `.config/fleet/oxlintrc.dogfood.json`
- `template/.config/oxlintrc.json`
- `template/.config/oxlintrc.dogfood.json`
- Any `.eslintrc*` or `eslint.config.*`

The fleet rule: **fix the underlying code**. The lint config is reserved for fleet-wide policy changes; individual call-site exemptions belong in code.

## What to do instead

### Single call-site exemption

When ONE line genuinely needs to violate a rule (e.g. a third-party callback signature forces an unused parameter), use a per-line disable comment with a reason:

```ts
// oxlint-disable-next-line no-unused-vars -- chrome.tabs API signature
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // tabId IS unused but the API signature requires the slot
})
```

The reason after `--` is mandatory. `git blame` will surface it to the next reader who wonders why.

### Justify the disable per usage, not per import

A disable on an `import` statement suppresses the rule for **every** binding the import brings in and **every** site that uses them. Before adding one, read every usage of the flagged binding — a multi-binding import flagged once often has one legitimate site and one real violation hiding behind the same suppression.

**Why:** a test imports a constant like `HOST_NAME` from `src/` and gets flagged by `no-src-import-in-test-expect`. A blanket import-line disable goes on with the reason "HOST_NAME is the actual, not an expected-value builder." That reason is only half true:

```ts
expect(HOST_NAME).toBe('dev.socket.trusted_publisher_host')  // HOST_NAME is the ACTUAL — fine from src/
expect(manifest['name']).toBe(HOST_NAME)                      // HOST_NAME is the EXPECTED — a real violation
```

The stated reason was false for the second line, where the disable silently suppressed a genuine "src binding builds the expected value" bug. The fix is a code change, not a disable: assert the second line against the **literal** the constant equals (`'dev.socket.trusted_publisher_host'`), leaving `HOST_NAME` used only as the actual. The rule then passes on its own terms.

The discipline: **prefer a code fix over a disable**, and when a disable is truly needed, verify the reason holds at *every* site the suppression covers. If the binding is sometimes a real violation, narrow the usage (use a literal, split the import) rather than blanket-disable.

### File-class exemption via override

When an entire directory needs a rule disabled (e.g. test files don't care about `socket/no-default-export`), use an `overrides` block in the config. ONLY when the rule doesn't apply to that class of file:

```json
{
  "overrides": [
    {
      "files": ["**/test/**", "**/tests/**"],
      "rules": {
        "socket/no-default-export": "off"
      }
    }
  ]
}
```

This is still a weakening, but a SCOPED one with documented justification. Add a comment explaining WHY the rule doesn't apply.

### Anti-pattern: don't disable globally

Wrong:

```json
{
  "rules": {
    "socket/export-top-level-functions": "off"
  }
}
```

This silences the rule for the entire repo. Every future file becomes a potential offender. If the rule doesn't fit your codebase shape, the rule is wrong. Fix the rule (in `.config/fleet/oxlint-plugin/fleet/<name>/`), not the consumer.

## Bypass

`Allow disable-lint-rule bypass`: type this verbatim in a recent message before the edit. Use sparingly:

1. New fleet-wide policy: the maintainer decides a rule should be disabled across all consumers. This is a fleet-level decision, not a per-task one.
2. Genuine override for a file class that the existing config doesn't yet model (e.g. a new directory of vendored code). After bypass, the next step is to update the rule itself OR add a documented overrides block.

## Why this matters

Past incident: an autofix wave touched a fleet config file and `prefer-non-capturing-group` was disabled globally to clear the noise. Six months later, an unrelated regex in a security-sensitive parser had a capturing-group bug that would have been caught. The disabled rule was forgotten. No signal to remove it.

The per-line comment with a reason is the audit trail. Global disables don't have one.

## Related rules

- `oxlint-disable-next-line` is allowed only with a `-- <reason>` suffix (enforced by the `no-file-scope-oxlint-disable` rule).
- Bypass phrases follow the canonical `Allow <X> bypass` format; see [`bypass-phrases.md`](./bypass-phrases.md).
- `Fix it, don't defer` (in CLAUDE.md): see a lint error? Fix the code, not the rule.
