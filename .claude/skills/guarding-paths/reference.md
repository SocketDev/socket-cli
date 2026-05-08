# guarding-paths — fix patterns

The patterns to apply for each detection rule. The orchestration story (modes, phases, allowlisting) lives in [`SKILL.md`](SKILL.md). The `install` mode copies file scaffolding from [`templates/`](templates/).

## Rule A — Multi-stage path constructed inline (in `.mts`/`.cts`)

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

For binsuite tools (binpress / binflate / binject) the canonical helper is `getFinalBinaryPath(packageRoot, mode, platformArch, binaryName)` from `build-infra/lib/paths`. For download caches use `getDownloadedDir(packageRoot)`.

## Rule B — Cross-package traversal

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

## Rule C — Workflow path repetition

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

## Rule D — Comment-encoded paths

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

## Rule G — Dockerfile / Makefile / shell duplicate construction

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

Each Dockerfile `FROM` stage is its own scope — `ENV` from the build stage doesn't reach a subsequent `FROM scratch AS export` stage. The gate accounts for this.

## Reference patterns (worked example)

The patterns to reuse when converting a repo to the strategy:

- **TS-first packages**: each package owns a `scripts/paths.mts` with `PACKAGE_ROOT`, `BUILD_ROOT`, `getBuildPaths(mode, platformArch)` returning at minimum `outputFinalDir` and `outputFinalBinary` / `outputFinalFile`.
- **Cross-package consumers**: `package.json` `exports` whitelists `./scripts/paths`. Consumer adds `"<producer>": "workspace:*"` and imports.
- **Workflows**: each job has a "Compute <pkg> paths" step (`id: paths`) early in the job. Step outputs include `package_dir`, `platform_build_dir`, `final_dir`, named files. `_rel` companions when `working-directory:` is used.
- **Docker stages**: each `FROM` stage declares `ENV PLATFORM_BUILD_DIR=...` and `ENV FINAL_DIR=...` once. Subsequent `RUN` steps reference the variables.

The first repo (socket-btm) is the worked example. Read its `scripts/paths.mts` files and `.github/workflows/*.yml` for canonical patterns when applying the strategy elsewhere.
