---
name: optimizing-submodules
description: Determines and applies the minimal sparse-checkout for each .gitmodules submodule so a vendored upstream pulls only the subtrees this repo consumes, not its whole tree. Use when adding a submodule, when a submodule drags a large tree into clones, or when the submodules-are-sparse-or-annotated check fails. The determination is AI-assisted (analyze what consumes the submodule); the apply + verify + enforcement are scripted.
user-invocable: true
allowed-tools: Bash(git config:*), Bash(git submodule:*), Bash(git -C:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(du:*), Bash(node scripts/fleet/git-partial-submodule.mts:*), Bash(node scripts/fleet/check/submodules-are-sparse-or-annotated.mts:*), Read, Grep, Glob
model: claude-sonnet-4-6
---

# optimizing-submodules

A vendored `upstream/<name>` submodule is rarely consumed in full. It is a parser reference, a test corpus, one subdir of a build, or a pin-only crate whose code actually comes from a registry. Without a `sparse-checkout`, the whole upstream tree lands in every clone (test262 alone is ~270 MB, typescript-go's `testdata/baselines` is 283 MB). This skill restricts each submodule to what the repo reads.

The `submodules-are-sparse-or-annotated` gate (`scripts/fleet/check/`) fails `check --all` for any submodule that is neither sparse nor annotated `# full-checkout: <reason>`. This skill is how you satisfy it.

## The discipline: determine → apply → verify

**The determination is judgment (AI-assisted); the application is law (scripted).** Propose the pattern by analysis, prove it by building.

### 1. Determine (analyze what consumes the submodule)

`rg` the repo for references to `upstream/<name>/` paths — **from files OUTSIDE the submodule's own directory**. Cover:

- Rust: `Cargo.toml` **path/git** deps (a `version = "=x"` crates.io pin is NOT consumption — the code comes from the registry, the submodule is reference-only), `build.rs`.
- C/C++: `CMakeLists.txt`, `binding.gyp` (which subdir does `add_subdirectory` / a `*_DIR` var point at?).
- Go: `go.mod` (a registry module is not the submodule).
- JS/TS: imports, `package.json` (a `workspace:*` fork supersedes the submodule), vitest configs.
- Test corpora: the conformance runner under `test/` / `test/scripts/` — find the **exact fixture subdir** it walks (`readdirSync`/`join` of `tests/`, `src/`, `test_parsing/`, …).
- Build/bench scripts under `scripts/` and `packages/*/scripts/`.

**Trap — internal self-references.** A vendored crate's own files reference each other (e.g. blake3's `b3sum/Cargo.toml` has `path = ".."`, blake3's `c/blake3_c_rust_bindings/build.rs` compiles `c/*.c`). Those are the submodule consuming itself, NOT your repo consuming it. Only references from **outside** `upstream/<name>/` count. Getting this wrong over-checks (the false "full checkout needed" verdict).

Outcomes per submodule:
- **Subtree-consumed** → the minimal pattern (e.g. `c`, `src`, `tests files-toml-1.0.0`, `files`).
- **Reference-only** (pin tracking, crates.io/npm dep, lockstep metadata, a doc cites it) → a minimal `README.md` (or the specific cited files) so the dir isn't empty but pulls ~nothing.
- **Genuinely whole-tree** (a crate built from its entire source with no separable subtree) → no sparse; annotate the block `# full-checkout: <reason>`.

### 2. Apply (scripted)

Write the pattern into `.gitmodules` (this is what `git-partial-submodule.mts clone` honors):

```bash
git config -f .gitmodules submodule."<name>".sparse-checkout "<space-separated patterns>"
```

For a populated submodule, also re-narrow the working tree and persist:

```bash
git -C <path> sparse-checkout set <patterns>
node scripts/fleet/git-partial-submodule.mts save-sparse <path>   # writes the field from the live state
```

`add --sparse` (clone sparse) and `restore-sparse` (re-apply the recorded field) are the other primitives.

### 3. Verify (prove it by building — this step is law, not habit)

A too-narrow pattern breaks the build only at use, so static analysis can pass it through. The verify is enforced by code, not left to discretion. Declare the consumer in `.gitmodules` next to the sparse pattern:

```
verify = pnpm --filter @x/parser test     # the command that builds against the subtree
verify = none                              # reference-only — nothing builds against it
```

Then prove it: `verify-submodule-sparse.mts --run <name|path>` sparse-clones the submodule per its recorded pattern and runs the declared `verify =` command. Green → the pattern is build-sufficient. Fail → it's too narrow (a needed path isn't checked out); widen and re-run.

```bash
node scripts/fleet/verify-submodule-sparse.mts --run <name|path>   # prove one
node scripts/fleet/verify-submodule-sparse.mts --run-all           # CI / on-cadence (heavy: clone + build each)
node scripts/fleet/verify-submodule-sparse.mts --check             # gate: every sparse block declares a verify =
```

The `--check` gate (in `check --all`) fails any sparse block with no `verify =` — a pattern with no declared consumer is unproven, so it can't land. That is what makes the verify law: you cannot add a sparse pattern without naming how it is build-proven.

## Removing a submodule

```bash
git submodule deinit -f <path>
git rm <path>
git config -f .gitmodules --remove-section submodule."<name>"   # if any residue remains
```

Commit `.gitmodules` + the gitlink removal together.

## Gate

`node scripts/fleet/check/submodules-are-sparse-or-annotated.mts` — green when every block is sparse or `# full-checkout:`-annotated. Run it after the sweep; it is in `check --all`.
