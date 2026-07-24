# updating-lockstep reference

Long-form details for the `updating-lockstep` skill — phase scripts, per-kind action policy, advisory format, and CI-mode emission. The orchestration story lives in [`SKILL.md`](SKILL.md).

## Per-kind action policy

| Kind               | Drift signal                                           | Action                                                                                                                                               |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version-pin`      | Upstream commits on default ref since pinned SHA       | **Auto-bump** per `upgrade_policy`: `track-latest` → advance to latest stable tag; `major-gate` → advance patch/minor only; `locked` → advisory only |
| `file-fork`        | Upstream file changed since `forked_at_sha`            | **Advisory** — note in PR body; do NOT auto-merge (forks carry local deltas that need human review)                                                  |
| `feature-parity`   | Parity score below `criticality/10` floor              | **Advisory** — note in PR body; human decides implement vs downgrade criticality                                                                     |
| `spec-conformance` | Spec submodule moved                                   | **Advisory** — note in PR body; human decides whether to bump `spec_version`                                                                         |
| `lang-parity`      | Port divergence / `rejected` anti-pattern reintroduced | **Advisory** — note in PR body; humans fix the port or update the manifest                                                                           |

The umbrella rule: **`version-pin` is mechanical** (safe to auto-apply with `track-latest` / `major-gate` policies); everything else is **advisory** (upstream semantics and local deltas matter, humans decide).

## Phase scripts

### Phase 1 — Pre-flight

```bash
test -f lockstep.json || { echo "no lockstep.json; skill n/a"; exit 0; }
test -f lockstep.schema.json || { echo "lockstep.schema.json missing — malformed scaffolding"; exit 1; }
test -f scripts/fleet/lockstep.mts || { echo "scripts/fleet/lockstep.mts missing — malformed scaffolding"; exit 1; }

git status --porcelain | grep -v '^??' && { echo "dirty tree; aborting"; exit 1; } || true

[ "$CI" = "true" ] || [ -n "$GITHUB_ACTIONS" ] && CI_MODE=true || CI_MODE=false
```

### Phase 2 — Collect + plan drift

```bash
pnpm run lockstep --json > /tmp/lockstep-report.json
node scripts/fleet/lockstep/auto-bump.mts --plan --report /tmp/lockstep-report.json --tags /tmp/tags.json
```

`auto-bump.mts --plan` partitions the report into:

- **auto** — version-pin rows with an actionable `upgrade_policy` (`track-latest` / `major-gate`) AND a resolvable newer stable tag. Each carries the already-resolved `targetTag`.
- **advisory** — everything else with `severity != "ok"`, plus any version-pin that can't auto-bump (locked, no-newer-tag, or a major bump gated by `major-gate`) — surfaced as an advisory line, never silently dropped.

`--tags <tags.json>` is `{ "<upstream>": ["<tag>", …] }`: the fetched tags per upstream — `git -C <submodule> tag` after `git fetch --tags`; omit it and the auto list resolves no targets — the rows fall to advisory with "no parseable stable tags". If both lists are empty: exit 0 with "no lockstep drift". The partition + the entire tag-scheme/semver/major-gate resolution, the old Phase 3a/3b inline jq, live in the engine — see its unit tests for the four tag schemes.

### Phase 3 — Auto-bump version-pin rows

For each row in the **auto** list, in manifest declaration order:

**3a. Resolve the upstream submodule + fetch tags**

```bash
SUBMODULE=$(jq -r --arg a "$UPSTREAM_ALIAS" '.upstreams[$a].submodule' lockstep.json)
cd "$SUBMODULE"
git fetch origin --tags --quiet
OLD_SHA=$(git rev-parse HEAD)
```

**3b. Find the target tag — already resolved by the planner.**

The Phase-2 `auto-bump.mts --plan` output carries each auto row's `targetTag`,
resolved by the engine's tag resolver: it filters pre-release tags (the
stability filter below), detects the scheme (`v1.2.3` / `1.2.3` /
`<prefix>-1.2.3` / `<prefix>_1_2_3`), semver-sorts within the current prefix,
and applies the policy (`major-gate` surfaces a major jump as advisory rather
than bumping). Use `targetTag` from the plan — don't re-derive it in shell.

**3c. Check out + capture new SHA**

```bash
NEW_SHA_FOR_CHECK=$(git rev-parse "$LATEST")
[ "$OLD_SHA" = "$NEW_SHA_FOR_CHECK" ] && { cd -; continue; }
git checkout "$LATEST" --quiet
NEW_SHA=$(git rev-parse HEAD)
cd -
```

**3d. Update `lockstep.json` + `.gitmodules`**

Use `jq` for the structured edit:

```bash
jq --arg id "$ROW_ID" --arg sha "$NEW_SHA" --arg tag "$LATEST" \
  '(.rows[] | select(.id == $id) | .pinned_sha) = $sha
   | (.rows[] | select(.id == $id) | .pinned_tag) = $tag' \
  lockstep.json > lockstep.json.tmp && mv lockstep.json.tmp lockstep.json
```

Update the submodule ref + its `.gitmodules` version comment through the canonical owner — don't hand-edit the comment (that re-implements `gen/gitmodules-hash.mts`):

```bash
node scripts/fleet/gen/gitmodules-hash.mts --set "$SUBMODULE" "$LATEST"
```

It bumps the gitlink and rewrites the `# <name>-<version>` comment in one place, so the comment can't drift from the pinned ref.

**3e. Validate + commit**

```bash
# Confirm lockstep harness accepts the new state.
pnpm run lockstep --json > /tmp/lockstep-post.json
jq --arg id "$ROW_ID" '.reports[] | select(.id == $id) | .severity' /tmp/lockstep-post.json
# expect "ok"

if [ "$CI_MODE" = "false" ]; then
  pnpm test || {
    echo "tests failed; rolling back $ROW_ID"
    git checkout lockstep.json .gitmodules "$SUBMODULE"
    continue
  }
fi

git add lockstep.json .gitmodules "$SUBMODULE"
git commit -m "chore(deps): bump $UPSTREAM_ALIAS to $LATEST"
```

Record the bumped row in the summary accumulator.

### Phase 4 — Advisory composition

For each row in **advisory**, accumulate a markdown line:

```
- **file-fork** `<id>`: `<local>` — <N> upstream commit(s) since <forked_at_sha[0:12]>. Review diff, cherry-pick if applicable, bump forked_at_sha.
- **feature-parity** `<id>`: parity score <score> below floor <floor>. Implement or downgrade criticality with reason.
- **spec-conformance** `<id>`: upstream spec repo moved. Review for breaking changes before bumping spec_version.
- **lang-parity** `<id>`: <details from messages[]>.
- **version-pin** `<id>`: major bump to <LATEST> — policy=major-gate requires human review.
- **version-pin** `<id>`: upgrade_policy=locked — skipped.
```

### Phase 5 — Report + emit

Final human-readable report to stdout:

```
## updating-lockstep report

**Auto-bumped:** <N> row(s)
<list>

**Advisory (human review):** <M> row(s)
<list>
```

In CI mode, emit the advisory block to `$GITHUB_OUTPUT` (base64-encoded) under key `lockstep-advisory` so the weekly-update workflow can include it in the PR body:

```bash
if [ -n "$GITHUB_OUTPUT" ]; then
  echo "lockstep-advisory=$(printf '%s' "$ADVISORY" | base64 | tr -d '\n')" >> "$GITHUB_OUTPUT"
fi
```

Emit a HANDOFF block per [`_shared/report-format.md`](../_shared/report-format.md):

```
=== HANDOFF: updating-lockstep ===
Status: {pass|fail}
Findings: {auto_bumped: N, advisory: M}
Summary: {one-line description}
=== END HANDOFF ===
```

## Tag-stability filter

Always filter pre-release / nightly / preview tags. The skill targets stable releases only:

- `-rc`, `-rc.\d+`
- `-alpha`, `-alpha.\d+`
- `-beta`, `-beta.\d+`
- `-dev`
- `-snapshot`
- `-nightly`
- `-preview`
