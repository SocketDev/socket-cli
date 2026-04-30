---
name: path-guard
description: Audit and fix path duplication in this Socket repo. Apply the strict "1 path, 1 reference" rule — every build/test/runtime/config path is constructed exactly once; everywhere else references the constructed value. Default mode finds and fixes; `check` mode reports only; `install` mode drops the gate + hook + rule into a fresh repo.
user-invocable: true
allowed-tools: Task, Read, Edit, Write, Grep, Glob, AskUserQuestion, Bash(pnpm run check:*), Bash(node scripts/check-paths:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(git:*)
---

# path-guard

**Mantra: 1 path, 1 reference.** A path is constructed exactly once; everywhere else references the constructed value. Re-constructing the same path twice is the violation, not referencing the constructed value many times.

## Modes

- `/path-guard` — full audit-and-fix conversion of the current repo (default).
- `/path-guard check` — read-only audit, report violations, no fixes.
- `/path-guard fix <id>` — fix a single finding from a prior `check` run, by index.
- `/path-guard install` — drop the gate + hook + rule + allowlist into a fresh repo (for new Socket repos).

## Three-level enforcement

The strategy lives in three artifacts that ship together:

1. **CLAUDE.md rule** — the mantra and detection rules in plain language. Every Socket repo's CLAUDE.md carries `## 1 path, 1 reference`. Synced from `.claude/skills/_shared/path-guard-rule.md`.
2. **Hook** — `.claude/hooks/path-guard/index.mts` runs `PreToolUse` on `Edit`/`Write` of `.mts`/`.cts` files. Blocks new violations at edit time. Mandatory across the fleet.
3. **Gate** — `scripts/check-paths.mts` runs in `pnpm check` (and CI). Whole-repo scan. Fails the build on any unsanctioned violation.

The hook and gate share their stage / build-root / mode / sibling-package vocabulary via `.claude/hooks/path-guard/segments.mts` — a single canonical source. Adding a new stage segment or fleet package means editing one file; the two consumers can never drift on what counts as a build-output path.

This skill is the *audit-and-fix workflow* that makes a repo conform initially and validates conformance over time.

## Detection rules

The gate enforces six rules. The hook enforces a subset (A and B) since it sees only one diff at a time.

| Rule | What it catches | Where checked |
|---|---|---|
| **A** | Multi-stage `path.join(...)` constructed inline. Two or more "stage" segments (Final, Release, Stripped, Compressed, Optimized, Synced, wasm, downloaded), or one stage + build-root + mode. | `.mts`/`.cts` files outside a `paths.mts`. Hook + gate. |
| **B** | Cross-package traversal: `path.join(*, '..', '<sibling-package>', 'build', ...)` reaching into a sibling's output instead of importing via `exports`. | `.mts`/`.cts` files. Hook + gate. |
| **C** | Workflow YAML constructs the same path string in 2+ steps outside a "Compute paths" step. | `.github/workflows/*.yml`. Gate. |
| **D** | Comment encodes a fully-qualified multi-stage path string (e.g. `# build/dev/darwin-arm64/out/Final/binary`). | `.github/workflows/*.yml`. Gate. |
| **F** | Same path shape constructed in 2+ different files. | All scanned files. Gate. |
| **G** | Hand-built multi-stage path constructed 2+ times in the same Makefile/Dockerfile/shell stage. | `Makefile`, `*.mk`, `*.Dockerfile`, `Dockerfile.*`, `*.sh`. Gate. |

Comments may describe path *structure* with placeholders (`<mode>/<arch>` or `${BUILD_MODE}/${PLATFORM_ARCH}`) but should not encode a complete literal path string. Code execution takes priority over docs: violations in `.mts`, Makefiles, Dockerfiles, workflow YAML, shell scripts are blocking.

## Mode: audit-and-fix (default)

When invoked as `/path-guard` with no arg:

1. **Setup** — spawn a worktree off `main` per `CLAUDE.md` parallel-sessions rule:
   ```bash
   git worktree add -b paths-audit ../<repo>-paths-audit main
   cd ../<repo>-paths-audit
   ```

2. **Audit** — run the gate to enumerate findings:
   ```bash
   pnpm run check:paths --json > /tmp/paths-findings.json
   pnpm run check:paths --explain   # human-readable
   ```

3. **Fix loop** — for each finding, apply the matching pattern below. After each fix, re-run the gate. Stop iterating when `pnpm run check:paths` exits 0.

4. **Verify** — run the full check suite + zizmor on any modified workflow:
   ```bash
   pnpm check
   for w in .github/workflows/*.yml; do zizmor "$w"; done
   ```

5. **Commit and push** — group fixes by logical category (workflows, code, Dockerfiles). Push directly to `main` for repos that allow direct push, or open a PR for repos that require it (socket-cli, socket-sdk-js, socket-registry per their CLAUDE.md / memory entries).

## Fix patterns

### Rule A — Multi-stage path constructed inline (in `.mts`/`.cts`)

**Bad**:
```ts
const finalBinary = path.join(PACKAGE_ROOT, 'build', BUILD_MODE, PLATFORM_ARCH, 'out', 'Final', 'binary')
```

**Fix**: move the construction into the package's `scripts/paths.mts` (or `lib/paths.mts`), or use a build-infra helper:
```ts
// In packages/foo/scripts/paths.mts:
export function getBuildPaths(mode, platformArch) {
  // ... constructs once ...
  return { outputFinalBinary: path.join(PACKAGE_ROOT, 'build', mode, platformArch, 'out', 'Final', binaryName) }
}

// In the consumer:
import { getBuildPaths } from './paths.mts'
const { outputFinalBinary } = getBuildPaths(mode, platformArch)
```

For binsuite tools (binpress/binflate/binject) the canonical helper is `getFinalBinaryPath(packageRoot, mode, platformArch, binaryName)` from `build-infra/lib/paths`. For download caches use `getDownloadedDir(packageRoot)`.

### Rule B — Cross-package traversal

**Bad**:
```ts
const liefDir = path.join(PACKAGE_ROOT, '..', 'lief-builder', 'build', mode, platformArch, 'out', 'Final', 'lief')
```

**Fix**: declare the workspace dep, expose `paths.mts` via the producer's `exports`, import the helper:

1. In producer's `package.json`:
   ```json
   "exports": {
     "./scripts/paths": "./scripts/paths.mts"
   }
   ```
2. In consumer's `package.json` `dependencies`:
   ```json
   "lief-builder": "workspace:*"
   ```
3. In consumer:
   ```ts
   import { getBuildPaths as getLiefBuildPaths } from 'lief-builder/scripts/paths'
   const { outputFinalDir } = getLiefBuildPaths(mode, platformArch)
   ```

### Rule C — Workflow path repetition

**Bad** (3 steps each rebuilding the same path):
```yaml
- name: Step A
  run: cd packages/foo/build/${BUILD_MODE}/${PLATFORM_ARCH}/out/Final && do-thing-1
- name: Step B
  run: cd packages/foo/build/${BUILD_MODE}/${PLATFORM_ARCH}/out/Final && do-thing-2
- name: Step C
  run: cd packages/foo/build/${BUILD_MODE}/${PLATFORM_ARCH}/out/Final && do-thing-3
```

**Fix**: add a "Compute <pkg> paths" step early in the job that constructs the path once, expose via `$GITHUB_OUTPUT`, reference downstream:

```yaml
- name: Compute foo paths
  id: paths
  env:
    BUILD_MODE: ${{ steps.build-mode.outputs.mode }}
    PLATFORM_ARCH: ${{ steps.platform-arch.outputs.platform_arch }}
  run: |
    PACKAGE_DIR="packages/foo"
    PLATFORM_BUILD_DIR="${PACKAGE_DIR}/build/${BUILD_MODE}/${PLATFORM_ARCH}"
    FINAL_DIR="${PLATFORM_BUILD_DIR}/out/Final"
    {
      echo "package_dir=${PACKAGE_DIR}"
      echo "platform_build_dir=${PLATFORM_BUILD_DIR}"
      echo "final_dir=${FINAL_DIR}"
    } >> "$GITHUB_OUTPUT"

- name: Step A
  env:
    FINAL_DIR: ${{ steps.paths.outputs.final_dir }}
  run: cd "$FINAL_DIR" && do-thing-1
# ... etc
```

For paths used inside `working-directory: packages/foo` steps, expose a `_rel` companion (e.g. `final_dir_rel=build/${BUILD_MODE}/${PLATFORM_ARCH}/out/Final`) and reference that.

### Rule D — Comment-encoded paths

**Bad**:
```yaml
# Path: packages/foo/build/dev/darwin-arm64/out/Final/binary
COPY --from=builder /build/.../out/Final/binary /out/Final/binary
```

**Fix**: cite the canonical `paths.mts` instead of duplicating the string:
```yaml
# Layout owned by packages/foo/scripts/paths.mts:getBuildPaths().
COPY --from=builder /build/packages/foo/build/${BUILD_MODE}/${PLATFORM_ARCH}/out/Final/binary /out/Final/binary
```

The comment may describe structure (`<mode>/<arch>`) but should not be a parsable literal path.

### Rule G — Dockerfile/Makefile/shell duplicate construction

**Bad** (Dockerfile reconstructs the path 3 times in the same stage):
```dockerfile
RUN mkdir -p build/${BUILD_MODE}/${PLATFORM_ARCH}/out/Final && \
    cp src build/${BUILD_MODE}/${PLATFORM_ARCH}/out/Final/output && \
    ls build/${BUILD_MODE}/${PLATFORM_ARCH}/out/Final/
```

**Fix**: declare an `ENV` once, reference everywhere:
```dockerfile
# Layout owned by packages/foo/scripts/paths.mts.
ENV FINAL_DIR=build/${BUILD_MODE}/${PLATFORM_ARCH}/out/Final
RUN mkdir -p "$FINAL_DIR" && cp src "$FINAL_DIR/output" && ls "$FINAL_DIR/"
```

Each Dockerfile `FROM` stage is its own scope — ENV from the build stage doesn't reach a subsequent `FROM scratch AS export` stage. The gate accounts for this.

## Mode: check (read-only)

When invoked as `/path-guard check`:

```bash
pnpm run check:paths --explain
```

Print the gate's findings without making any edits. Exit 0 if clean, 1 if findings present. Useful for CI / pre-merge inspection.

## Allowlisting a finding

When a genuine exemption is needed (rare — most "false positives" should be reported as gate bugs), add an entry to `.github/paths-allowlist.yml`. Two ways to pin the entry to a specific site:

- **`line:`** — exact line number. Strict; a single-line edit above shifts the entry off-target and the finding re-surfaces.
- **`snippet_hash:`** — 12-char SHA-256 prefix of the offending snippet (whitespace-normalized). Drift-resistant: survives reformatting, but any content-changing edit invalidates it. Get the hash:
  ```bash
  pnpm run check:paths --show-hashes
  ```

Both may be set — either matching is sufficient. Prefer `snippet_hash` over raw `line:` when the exemption is expected to outlive routine reformatting; prefer `line:` when you specifically *want* the entry to fall off after any nearby edit.

## Mode: install (new repo)

When invoked as `/path-guard install` on a Socket repo that doesn't yet have the gate:

1. Copy the gate file from this skill's reference dir:
   ```bash
   cp .claude/skills/path-guard/reference/check-paths.mts.tmpl scripts/check-paths.mts
   ```
2. Copy the empty allowlist:
   ```bash
   cp .claude/skills/path-guard/reference/paths-allowlist.yml.tmpl .github/paths-allowlist.yml
   ```
3. Add `"check:paths": "node scripts/check-paths.mts"` to `package.json`.
4. Wire `runPathHygieneCheck()` into `scripts/check.mts` (after the existing checks).
5. Append the rule snippet from `.claude/skills/_shared/path-guard-rule.md` to the repo's `CLAUDE.md` if a `1 path, 1 reference` section is missing.
6. Add the hook entry to `.claude/settings.json` `PreToolUse` matcher `Edit|Write`:
   ```json
   { "type": "command", "command": "node .claude/hooks/path-guard/index.mts" }
   ```
7. Run the gate against the repo. Triage findings as you would in audit-and-fix mode.

## Tie-in with quality-scan

The `/quality-scan` skill should call `pnpm run check:paths --json` as one of its sub-scans and surface findings as part of its A-F graded report. Failures roll into the overall quality grade. The full audit-and-fix workflow lives here; quality-scan just *detects* during periodic scans.

## Reference patterns

When converting a repo to the strategy, the patterns I keep reusing:

- **TS-first packages**: each package owns a `scripts/paths.mts` with `PACKAGE_ROOT`, `BUILD_ROOT`, `getBuildPaths(mode, platformArch)` returning at minimum `outputFinalDir` and `outputFinalBinary`/`outputFinalFile`.
- **Cross-package consumers**: `package.json` `exports` whitelists `./scripts/paths`. Consumer adds `"<producer>: workspace:*"` and imports.
- **Workflows**: each job has a "Compute <pkg> paths" step (`id: paths`) early in the job. Step outputs include `package_dir`, `platform_build_dir`, `final_dir`, named files. `_rel` companions when `working-directory:` is used.
- **Docker stages**: each `FROM` stage declares `ENV PLATFORM_BUILD_DIR=...` and `ENV FINAL_DIR=...` once. Subsequent RUN steps reference the variables.

The first repo (socket-btm) is the worked example. Read its `scripts/paths.mts` files and `.github/workflows/*.yml` for canonical patterns when applying the strategy elsewhere.
