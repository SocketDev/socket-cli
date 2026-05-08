---
name: guarding-paths
description: Audits and fixes path duplication in a Socket repo. Applies the strict "1 path, 1 reference" rule — every build/test/runtime/config path is constructed exactly once; everywhere else references the constructed value. Default mode finds and fixes; `check` mode reports only; `install` mode drops the gate + hook + rule into a fresh repo. Use when path drift surfaces from `pnpm check`, when a new sibling package needs path conventions, or when bootstrapping a fresh Socket repo.
user-invocable: true
allowed-tools: Task, Read, Edit, Write, Grep, Glob, AskUserQuestion, Bash(pnpm run check:*), Bash(node scripts/check-paths:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(git:*)
---

# guarding-paths

**Mantra: 1 path, 1 reference.** A path is constructed exactly once; everywhere else references the constructed value. Re-constructing the same path twice is the violation; referencing the constructed value many times is fine.

## Modes

| Invocation | Effect |
|---|---|
| `/guarding-paths` | Full audit-and-fix on the current repo (default). |
| `/guarding-paths check` | Read-only audit; report violations; no fixes. |
| `/guarding-paths fix <id>` | Fix a single finding from a prior `check` run, by index. |
| `/guarding-paths install` | Drop the gate + hook + rule + allowlist into a fresh repo. |

## Three-level enforcement

The strategy lives in three artifacts that ship together:

1. **CLAUDE.md rule** — the mantra and detection rules in plain language. Every fleet repo's CLAUDE.md carries `## 1 path, 1 reference`. Synced from [`_shared/path-guard-rule.md`](../_shared/path-guard-rule.md).
2. **Hook** — `.claude/hooks/path-guard/index.mts` runs `PreToolUse` on `Edit` / `Write` of `.mts` / `.cts` files. Blocks new violations at edit time.
3. **Gate** — `scripts/check-paths.mts` runs in `pnpm check` (and CI). Whole-repo scan. Fails the build on any unsanctioned violation.

The hook and gate share their stage / build-root / mode / sibling-package vocabulary via `.claude/hooks/path-guard/segments.mts` — a single canonical source. Adding a new stage segment or fleet package means editing one file; the two consumers can never drift on what counts as a build-output path.

This skill is the **audit-and-fix workflow** that makes a repo conform initially and validates conformance over time.

## Detection rules

The gate enforces six rules. The hook enforces a subset (A and B), since it sees only one diff at a time.

| Rule | What it catches | Where checked |
|---|---|---|
| **A** | Multi-stage `path.join(...)` constructed inline. Two or more "stage" segments (Final, Release, Stripped, Compressed, Optimized, Synced, wasm, downloaded), or one stage + build-root + mode. | `.mts` / `.cts` files outside a `paths.mts`. Hook + gate. |
| **B** | Cross-package traversal: `path.join(*, '..', '<sibling-package>', 'build', ...)` reaching into a sibling's output instead of importing via `exports`. | `.mts` / `.cts` files. Hook + gate. |
| **C** | Workflow YAML constructs the same path string in 2+ steps outside a "Compute paths" step. | `.github/workflows/*.yml`. Gate. |
| **D** | Comment encodes a fully-qualified multi-stage path string (e.g. `# build/dev/darwin-arm64/out/Final/binary`). | `.github/workflows/*.yml`. Gate. |
| **F** | Same path shape constructed in 2+ different files. | All scanned files. Gate. |
| **G** | Hand-built multi-stage path constructed 2+ times in the same Makefile / Dockerfile / shell stage. | `Makefile`, `*.mk`, `*.Dockerfile`, `Dockerfile.*`, `*.sh`. Gate. |

Comments may describe path *structure* with placeholders (`<mode>/<arch>` or `${BUILD_MODE}/${PLATFORM_ARCH}`) but should not encode a complete literal path string. Violations in `.mts`, Makefiles, Dockerfiles, workflow YAML, and shell scripts are blocking; comments come second.

## Mode: audit-and-fix (default)

| # | Phase | Outcome |
|---|---|---|
| 1 | Setup | Spawn worktree off `origin/$BASE` (default-branch fallback). |
| 2 | Audit | `pnpm run check:paths --json > /tmp/paths-findings.json`; `pnpm run check:paths --explain` for human-readable. |
| 3 | Fix loop | For each finding, apply the matching pattern from [`reference.md`](reference.md). Re-run the gate after each fix. Stop when `pnpm run check:paths` exits 0. |
| 4 | Verify | `pnpm check` + `zizmor` on any modified workflow. |
| 5 | Commit + push | Per-rule commits, atomic. Push directly to `$BASE` for repos that allow it; PR for socket-cli / socket-sdk-js / socket-registry. |
| 6 | Cleanup | `git worktree remove ../<repo>-paths-audit`. `git worktree list` should show only the primary afterward. |

Worktree setup uses the default-branch fallback from CLAUDE.md:

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
if [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/main;   then BASE=main;   fi
if [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/master; then BASE=master; fi
BASE="${BASE:-main}"
git worktree add -b paths-audit ../<repo>-paths-audit "$BASE"
```

## Mode: check (read-only)

```bash
pnpm run check:paths --explain
```

Prints findings without making edits. Exit 0 if clean, 1 if findings present. Useful for CI / pre-merge inspection.

## Mode: install (new repo)

For Socket repos that don't yet have the gate:

1. Copy the gate file:
   ```bash
   cp .claude/skills/guarding-paths/templates/check-paths.mts.tmpl scripts/check-paths.mts
   ```
2. Copy the empty allowlist:
   ```bash
   cp .claude/skills/guarding-paths/templates/paths-allowlist.yml.tmpl .github/paths-allowlist.yml
   ```
3. Add `"check:paths": "node scripts/check-paths.mts"` to `package.json`.
4. Wire `runPathHygieneCheck()` into `scripts/check.mts` (after the existing checks).
5. Append the rule snippet from [`_shared/path-guard-rule.md`](../_shared/path-guard-rule.md) to the repo's `CLAUDE.md` if a `1 path, 1 reference` section is missing.
6. Add the hook entry to `.claude/settings.json` `PreToolUse` matcher `Edit|Write`:
   ```json
   { "type": "command", "command": "node .claude/hooks/path-guard/index.mts" }
   ```
7. Run the gate against the repo. Triage findings as you would in audit-and-fix mode.

## Allowlisting a finding

Genuine exemptions are rare — most "false positives" should be reported as gate bugs. When needed, add an entry to `.github/paths-allowlist.yml`. Two ways to pin:

- **`line:`** — exact line number. Strict; a single-line edit above shifts the entry off-target and the finding re-surfaces.
- **`snippet_hash:`** — 12-char SHA-256 prefix of the offending snippet (whitespace-normalized). Drift-resistant — survives reformatting, but any content-changing edit invalidates it. Get the hash via `pnpm run check:paths --show-hashes`.

Both may be set — either matching is sufficient. Prefer `snippet_hash` over raw `line:` when the exemption is expected to outlive routine reformatting; prefer `line:` when you specifically *want* the entry to fall off after any nearby edit.

## Commit cadence

- **Per-rule fix → its own commit.** Rule A fix in `packages/foo/` and Rule C workflow fix go in separate commits even when found in the same audit pass.
- **Re-run the gate before each commit.** A green `pnpm run check:paths` is the entry criterion.
- **Don't leave a partial fix uncommitted across phases.** Commit what's done on `chore/paths-audit-wip` if the audit gets interrupted.

Conventional commit shape: `fix(paths): rule A — extract foo build paths into scripts/paths.mts`.

## Tie-in with `scanning-quality`

`/scanning-quality` calls `pnpm run check:paths --json` as one of its sub-scans and surfaces findings in its A-F report. The full audit-and-fix workflow lives here; `scanning-quality` only *detects* during periodic scans.

## Fix patterns

Per-rule fix templates (Rules A through G) plus the worked-example reference patterns from socket-btm: [`reference.md`](reference.md). File scaffolding for `install` mode lives in [`templates/`](templates/).
