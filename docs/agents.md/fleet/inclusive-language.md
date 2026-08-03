# Inclusive language reference

The fleet uses precise, neutral terms over historical metaphors that imply hierarchy or exclusion. The substitutes are not euphemisms — they're more _accurate_ (a list of allowed values genuinely is an "allowlist"; "whitelist" is a metaphor that hides what the list does).

## Substitution table

| Replace                          | With                                                |
| -------------------------------- | --------------------------------------------------- |
| `whitelist` / `whitelisted`      | `allowlist` / `allowed` / `allowlisted`             |
| `blacklist` / `blacklisted`      | `denylist` / `denied` / `blocklisted` / `blocked`   |
| `master` (branch, process, copy) | `main` (branch); `primary` / `controller` (process) |
| `slave`                          | `replica`, `worker`, `secondary`, `follower`        |
| `grandfathered`                  | `legacy`, `pre-existing`, `exempted`                |
| `sanity check`                   | `quick check`, `confidence check`, `smoke test`     |
| `dummy` (placeholder)            | `placeholder`, `stub`                               |

## Where to apply

- **Code**: identifiers, comments, string literals.
- **Docs**: READMEs, CLAUDE.md, markdown.
- **Config**: YAML, JSON.
- **History**: commit messages, PR titles/descriptions.
- **CI logs** you control.

## Two narrow exceptions

The legacy term must remain only when changing it would break something external:

- **Third-party APIs / upstream code**: when interfacing with an external API field literally named `whitelist`, keep the field name; rename your local variable. Example: `const allowedDomains = response.whitelist`.
- **Vendored upstream sources**: don't rewrite vendored code under `vendor/**`, `upstream/**`, or `**/fixtures/**`. Patch around it if needed.

## When to fix

When you encounter a legacy term during unrelated work, fix it inline — don't defer.
