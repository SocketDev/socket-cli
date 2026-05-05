---
name: updating-xport
description: Acts on `xport.json` drift for repos that carry the xport lock-step manifest. Reads `pnpm run xport --json`, then for each row acts per-kind — auto-bump `version-pin` rows (low-risk mechanical updates), advisory-only for `file-fork` / `feature-parity` / `spec-conformance` / `lang-parity` (upstream semantics need human judgment). Invoked by the `updating` umbrella skill; can also be invoked standalone.
user-invocable: true
allowed-tools: Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(diff:*), Read, Edit, Grep, Glob---

# updating-xport

<task>
Act on drift findings in `xport.json`. Auto-apply mechanical version-pin bumps; surface everything else as advisory notes for human review. Commit each actioned row as its own atomic commit so the PR reviewer can accept/reject per-row.
</task>

<context>
**xport** is a cross-project lock-step manifest. Not every repo has one; this skill exits cleanly when `xport.json` is absent. See `xport.schema.json` (deployed via `socket-repo-template/sync-scaffolding.mjs`) for the five row kinds.

The harness at `scripts/xport.mts` emits JSON reports with `severity ∈ {ok, drift, error}` per row. This skill consumes that JSON.

**Per-kind action policy:**

| Kind | Drift signal | Action |
|------|--------------|--------|
| `version-pin` | Upstream commits on default ref since pinned SHA | **Auto-bump** per `upgrade_policy`: `track-latest` → advance to latest stable tag; `major-gate` → advance patch/minor only; `locked` → advisory only |
| `file-fork` | Upstream file changed since `forked_at_sha` | **Advisory** — note in PR body; do NOT auto-merge (forks carry local deltas that need human review) |
| `feature-parity` | Parity score below `criticality/10` floor | **Advisory** — note in PR body; human decides implement vs downgrade criticality |
| `spec-conformance` | Spec submodule moved | **Advisory** — note in PR body; human decides whether to bump `spec_version` |
| `lang-parity` | Port divergence / `rejected` anti-pattern reintroduced | **Advisory** — note in PR body; humans fix the port or update the manifest |

The common rule: **version-pin is mechanical** (safe to auto-apply with `track-latest`/`major-gate` policies); everything else is **advisory** (upstream semantics and local deltas matter, humans decide).
</context>

<constraints>
**Requirements:**
- Start with clean working directory (check via `git status --porcelain`)
- Run from repo root
- Exit 0 cleanly if `xport.json` is absent (the repo doesn't use xport)
- Conventional commit format: `chore(deps): bump <upstream> to <tag>`
- Update `.gitmodules` version comments when submodule tags change (pattern: `# <name>-<version>` on the line above the submodule block)
- Target stable releases only (filter `-rc`, `-alpha`, `-beta`, `-dev`, `-snapshot`, `-nightly`, `-preview`)

**Forbidden:**
- Never auto-edit `file-fork`, `feature-parity`, `spec-conformance`, or `lang-parity` rows' tracked state
- Never bump a `locked` version-pin without human approval
- Never skip the tag-stability filter
- Never use `npx`, `pnpm dlx`, `yarn dlx` — use `pnpm exec` or `pnpm run`

**CI mode** (`CI=true` or `GITHUB_ACTIONS`): skip per-row test validation (workflow validates at the end); emit advisory summary to `$GITHUB_OUTPUT` when present.

**Interactive mode** (default): validate each auto-bump with `pnpm test` before committing the next.
</constraints>

<instructions>

## Phase 1 — Pre-flight

```bash
test -f xport.json || { echo "no xport.json; skill n/a"; exit 0; }
test -f xport.schema.json || { echo "xport.schema.json missing — malformed scaffolding"; exit 1; }
test -f scripts/xport.mts || { echo "scripts/xport.mts missing — malformed scaffolding"; exit 1; }

git status --porcelain | grep -v '^??' && { echo "dirty tree; aborting"; exit 1; } || true

[ "$CI" = "true" ] || [ -n "$GITHUB_ACTIONS" ] && CI_MODE=true || CI_MODE=false
```

## Phase 2 — Collect drift

```bash
pnpm run xport --json > /tmp/xport-report.json
```

Parse `reports[]` from the JSON. Split into:

- **auto** — rows where `severity == "drift"` AND `kind == "version-pin"` AND `upgrade_policy` ∈ `{ "track-latest", "major-gate" }`
- **advisory** — everything else with `severity != "ok"`

If both lists empty: exit 0 with "no xport drift".

## Phase 3 — Auto-bump version-pin rows

For each row in **auto** list, in manifest declaration order:

**3a. Resolve the upstream submodule + fetch tags**

```bash
SUBMODULE=$(jq -r --arg a "$UPSTREAM_ALIAS" '.upstreams[$a].submodule' xport.json)
cd "$SUBMODULE"
git fetch origin --tags --quiet
OLD_SHA=$(git rev-parse HEAD)
```

**3b. Find the target tag**

Examine existing `pinned_tag` to identify the tag scheme, then match:

- `v1.2.3` (v-prefixed semver)
- `1.2.3` (bare semver)
- `<prefix>-1.2.3` (project-prefixed)
- `<prefix>_1_2_3` (underscore style; curl, liburing)

For `major-gate` policy: parse major version from `LATEST` vs current `pinned_tag`. If majors differ, skip — add to advisory with note "major bump needs human review".

**3c. Check out + capture new SHA**

```bash
NEW_SHA_FOR_CHECK=$(git rev-parse "$LATEST")
[ "$OLD_SHA" = "$NEW_SHA_FOR_CHECK" ] && { cd -; continue; }
git checkout "$LATEST" --quiet
NEW_SHA=$(git rev-parse HEAD)
cd -
```

**3d. Update `xport.json` + `.gitmodules`**

Use `jq` for structured edit:

```bash
jq --arg id "$ROW_ID" --arg sha "$NEW_SHA" --arg tag "$LATEST" \
  '(.rows[] | select(.id == $id) | .pinned_sha) = $sha
   | (.rows[] | select(.id == $id) | .pinned_tag) = $tag' \
  xport.json > xport.json.tmp && mv xport.json.tmp xport.json
```

Update `.gitmodules` version comment via Edit tool (NOT sed per CLAUDE.md) — replace `# <prefix>-<old>` with `# <prefix>-<new>` on the comment line above the submodule block.

**3e. Validate + commit**

```bash
# Confirm xport harness accepts the new state
pnpm run xport --json > /tmp/xport-post.json
jq --arg id "$ROW_ID" '.reports[] | select(.id == $id) | .severity' /tmp/xport-post.json
# expect "ok"

if [ "$CI_MODE" = "false" ]; then
  pnpm test || {
    echo "tests failed; rolling back $ROW_ID"
    git checkout xport.json .gitmodules "$SUBMODULE"
    continue
  }
fi

git add xport.json .gitmodules "$SUBMODULE"
git commit -m "chore(deps): bump $UPSTREAM_ALIAS to $LATEST"
```

Record bumped row in summary accumulator.

## Phase 4 — Compose advisory notes

For each row in **advisory**, accumulate a markdown line:

```
- **file-fork** `<id>`: `<local>` — <N> upstream commit(s) since <forked_at_sha[0:12]>. Review diff, cherry-pick if applicable, bump forked_at_sha.
- **feature-parity** `<id>`: parity score <score> below floor <floor>. Implement or downgrade criticality with reason.
- **spec-conformance** `<id>`: upstream spec repo moved. Review for breaking changes before bumping spec_version.
- **lang-parity** `<id>`: <details from messages[]>.
- **version-pin** `<id>`: major bump to <LATEST> — policy=major-gate requires human review.
- **version-pin** `<id>`: upgrade_policy=locked — skipped.
```

## Phase 5 — Report + emit

Final human-readable report to stdout:

```
## updating-xport report

**Auto-bumped:** <N> row(s)
<list>

**Advisory (human review):** <M> row(s)
<list>
```

In CI mode, emit the advisory block to `$GITHUB_OUTPUT` (base64-encoded) under key `xport-advisory` so the weekly-update workflow can include it in the PR body:

```bash
if [ -n "$GITHUB_OUTPUT" ]; then
  echo "xport-advisory=$(printf '%s' "$ADVISORY" | base64 | tr -d '\n')" >> "$GITHUB_OUTPUT"
fi
```

Emit a HANDOFF block per `_shared/report-format.md`:

```
=== HANDOFF: updating-xport ===
Status: {pass|fail}
Findings: {auto_bumped: N, advisory: M}
Summary: {one-line description}
=== END HANDOFF ===
```

</instructions>

## Success Criteria

- All actionable `version-pin` rows bumped atomically (one commit per row)
- Advisory rows collected for PR body / workflow output
- No edits to non-version-pin row state
- `pnpm run xport` exits 0 or 2 at end (never 1 — no schema errors introduced)
- `.gitmodules` version comments synchronized with `pinned_tag`

## Commands

- `pnpm run xport --json` — drift report (consumed by this skill)
- `jq` — parse + edit `xport.json` (structured JSON edits)
- `git submodule status` — verify submodule state after bumps

## When to use

- Invoked by the `updating` umbrella skill (weekly-update workflow)
- Standalone: `/updating-xport` when syncing just the xport manifest
- After manual submodule bumps, to refresh `xport.json` metadata
