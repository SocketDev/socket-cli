# Insecure-defaults scan

Look for fail-open security defaults, hardcoded credentials, and "lazy default" patterns that ship as production behavior.

## Mission

Identify configurations where the **default** path is the unsafe one — the value used when the user / env / config didn't say otherwise. A default that fails open is a default that ships.

## Scan targets

- All `.env.example`, `.env.template`, `*.config.{js,mjs,ts,mts}` files.
- Constructor / function defaults: `function foo(opt = { secure: false })`, `class Foo { constructor(opt = {}) { … }`.
- Boolean-default parameters where the safe choice is `true` and the code defaults to `false` (or vice versa).
- Environment-variable fallbacks: `process.env.X || 'fallback'` — is the fallback safe?
- Hook / middleware order: is the auth check skippable when a flag is missing?
- Workflow `if:` conditions that skip security gates on non-default branches.

## Patterns to flag

| Pattern                                                         | Why flagged                               |
| --------------------------------------------------------------- | ----------------------------------------- |
| `verify: false`, `strict: false`, `safe: false` as default      | Defaults to permissive                    |
| `process.env.AUTH \|\| 'dev'`                                   | Fallback to dev mode in absence of config |
| `if (!process.env.SECURITY_ENABLED)` skipping a check           | Inverts the safe default                  |
| Hardcoded test tokens / fixtures in non-test paths              | Will ship if the gate fails               |
| `permissive: true`, `bypass: true` defaults                     | Should require explicit opt-in            |
| `// TODO: validate` next to a missing validation                | Marks the gap                             |
| Workflow `if:` that excludes `pull_request` from security scans | Skips on the highest-risk path            |

## Method

1. Walk the targets enumerated above.
2. For each match, capture: file:line, the default value, the safe alternative, the impact if the default ships.
3. Cross-check against fleet rules from CLAUDE.md — a rule violation makes the finding Critical regardless of upstream behavior.
4. Don't flag test fixtures clearly under `__fixtures__/`, `test/`, `tests/`, or `*.test.{js,ts,mts}` — those are scoped to tests by convention.

## Output shape

```
### Insecure Defaults

- file:line
  Setting: <name>
  Default: <unsafe value>
  Safe: <safer alternative>
  Severity: <Critical | High | Medium>
  Impact: <one sentence>
  Fix: <imperative — change to safer value, or require explicit opt-in>
```

## Severity rubric

- **Critical** — secret leaked / auth skipped / encryption disabled by default.
- **High** — security check made optional, or default does not enforce a fleet rule.
- **Medium** — observability / audit defaults that mask incidents.

## Source

Pattern adapted from Trail of Bits' `insecure-defaults` plugin (https://github.com/trailofbits/skills/tree/main/plugins/insecure-defaults). Their version targets compiled languages and config DSLs; ours is JavaScript / TypeScript / YAML for the fleet's surface.
