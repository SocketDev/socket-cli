---
name: updating-coverage
description: Refresh the coverage badge in the root README by running the repo's coverage script and rewriting the `![Coverage](https://img.shields.io/badge/coverage-<PCT>%25-brightgreen)` line. Sibling of `updating-security` / `updating-lockstep` under the `updating` umbrella.
user-invocable: true
allowed-tools: Read, Edit, Bash(pnpm run cover:*), Bash(pnpm run coverage:*), Bash(pnpm run test:cover:*), Bash(node:*), Bash(git:*), Bash(jq:*), Bash(cat:*)
---

# updating-coverage

Runs the repo's coverage script and rewrites the README badge so the published number matches reality. Invoked directly via `/update-coverage` or as a phase of the `updating` umbrella.

## When to use

- After landing a substantial change to test coverage (added a major
  feature with tests, removed a large untested module).
- Pre-release, to refresh the public badge.
- As part of `updating` umbrella flow when the repo declares a
  coverage script.

## What it does NOT do

- **Generate coverage from scratch.** This skill consumes the
  output of the repo's existing coverage tooling — vitest /
  c8 / istanbul / node-test coverage. If no coverage script is
  declared in `package.json`, the skill reports that and exits.
- **Compute coverage thresholds.** The badge reflects what the
  tooling reports; tightening the threshold is a separate decision
  in the repo's vitest/c8 config.
- **Modify nested READMEs.** Only the repo-root `README.md` is
  rewritten. Nested READMEs under `packages/*` have their own
  badges and lifecycles.

## Phases

| #   | Phase              | Outcome                                                                                                |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| 1   | Discovery          | Find the coverage script in `package.json` (`cover` / `coverage` / `test:cover`, in that preference).  |
| 2   | Run                | `pnpm run <script>`. Capture stdout. Fail loudly if the run errors.                                    |
| 3   | Parse              | Extract the percentage. Two paths — read `coverage/coverage-summary.json` if present, otherwise scrape `All files \| ...` line.|
| 4   | Rewrite            | Replace the `<PCT>` in the README badge URL with the parsed value (two decimals).                      |
| 5   | Commit             | `docs(readme): refresh coverage badge to N.NN%`. Direct-push per fleet norm.                           |

## Phase 1 — discovery

```sh
node -e '
const p = require("./package.json").scripts ?? {};
for (const name of ["cover", "coverage", "test:cover"]) {
  if (p[name]) { console.log(name); process.exit(0); }
}
process.exit(1);'
```

If no matching script exists, the skill emits `no coverage script found` and exits cleanly (this is not a failure mode — many fleet repos don't track coverage).

## Phase 2 — run

```sh
pnpm run <SCRIPT>
```

Use the standard pnpm runner so we pick up the repo's own env config (catalog versions, etc.).

## Phase 3 — parse

**Preferred path** — read `coverage/coverage-summary.json` (vitest / istanbul format):

```sh
jq -r '.total.lines.pct' coverage/coverage-summary.json
```

The number is a float with one decimal place. Two decimals is the canonical badge format — pad with `.00` when needed.

**Fallback path** — scrape the `All files | ...` line from coverage stdout:

```sh
pnpm run cover | tee /tmp/cover-output.txt
awk -F '|' '/^All files/ { gsub(/ /, "", $2); print $2 }' /tmp/cover-output.txt
```

Whichever column the tool prints first (statements vs lines) is acceptable — the badge is approximate by design. Document the column choice in the commit message.

## Phase 4 — rewrite

The canonical badge line in `README.md` is:

```markdown
![Coverage](https://img.shields.io/badge/coverage-<PCT>%25-brightgreen)
```

Use the Edit tool to replace the `<PCT>` placeholder with the actual percentage. The `%25` is URL-encoded `%`; leave it alone.

If the README has been canonicalized but the badge still reads `<PCT>` (e.g. just-canonicalized by the readme-skeleton work), Phase 4 substitutes; otherwise the existing number is replaced.

## Phase 5 — commit

```sh
git add README.md
git commit -m "docs(readme): refresh coverage badge to <N.NN>%"
git push origin <default-branch>
```

Direct-push per the fleet's `Commits & PRs → Push policy` rule; fall back to PR if the remote rejects.

## Output

When called via `/update-coverage`, emit a one-line summary:

```
updated coverage badge: 96.42% → 97.18% (source: coverage/coverage-summary.json)
```

When no coverage script exists or the percentage is unchanged, exit silently.

## Related

- `.claude/skills/updating/SKILL.md` — umbrella that calls this skill when applicable.
- `.claude/skills/updating-security/SKILL.md` — sibling under `updating`.
- `template/README.md` — canonical README skeleton ships the placeholder badge.
