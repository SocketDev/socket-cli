# Tooling

The CLAUDE.md `### Tooling` section is the short list. This file is the full set of rules and their rationale.

## Package manager

`pnpm`. Run scripts via `pnpm run foo --flag`, never `foo:bar`. After `package.json` edits, `pnpm install`.

## No `npx` / `dlx` / `<pm> exec`

NEVER use `npx`, `pnpm dlx`, `yarn dlx`, NOR `pnpm`/`npm`/`yarn exec`. Run `node_modules/.bin/<tool>` or `pnpm run <script>`. Enforced by `.claude/hooks/fleet/no-pm-exec-guard/`; bypass `Allow pm-exec bypass`.

## No `--experimental-strip-types`

NEVER pass `--experimental-strip-types` to `node`. Runners are `.mts` executed by a Node version that strips types natively, or via the repo's own toolchain. The experimental flag changes parsing/semantics and is forbidden (`.claude/hooks/fleet/no-strip-types-guard/`).

## No `tsx` / `ts-node`, no `corepack`, no `cd <subpkg> && pnpm`

Three adjacent verboten shapes, each with its own guard:

- **`tsx` / `ts-node`.** Blocked whether run as a binary (`tsx foo.mts`, `ts-node script.ts`) or as a Node loader (`node --import tsx`, `node --loader tsx`, `node --require ts-node/register`). The `.node-version` Node strips TypeScript types natively, so a loader adds a dependency, a startup cost, and a second TS-execution semantics that drifts from production Node. Enforced by `.claude/hooks/fleet/no-tsx-guard/`.
- **corepack.** `corepack enable` / `corepack prepare` / `corepack use` / `corepack install` are blocked; `corepack --version`/`--help`/`disable` provision nothing and are left alone. The fleet pins pnpm in `external-tools.json` and installs it via download + Subresource-Integrity; corepack instead fetches a package manager from the registry at activation time, outside that gate. Enforced by `.claude/hooks/fleet/no-corepack-guard/`.
- **`cd <subpkg> && pnpm ...`.** Running a package manager from a workspace subpackage resolves against that package's local view (missing workspace-root config, hoisted bins, the lockfile's graph) and leaves the persistent Bash cwd parked there for every later command. Use `pnpm --filter <pkg> <script>` from the root instead. Enforced by `.claude/hooks/fleet/operate-from-repo-root-guard/` (bypass `Allow repo-root bypass`); it is narrow enough to leave a bare `cd` alone, a worktree path, or a sibling-repo escape.

A `pnpm --filter <name> ...` that matches zero packages exits 0 with "No projects matched the filters", a silent no-op that has false-greened a build twice on a typo'd package name. `.claude/hooks/fleet/pnpm-filter-zero-match-nudge/` nudges (never blocks) when that string appears in the tool output, suggesting `pnpm ls --filter <name> --depth -1` to verify the name.

## Never pipe install/check/test/build to `tail`/`head`

The Socket Firewall (SFW) footer carries malware/soak warnings; piping `pnpm install`/`check`/`test`/`build` output to `tail` or `head` hides it. Let the full output through (`.claude/hooks/fleet/no-tail-install-out-guard/`).

## Search: `fff` MCP, not `ripgrep` / `grep`

For file + content search in a git-indexed tree, reach for the **fff** MCP tools (`ffgrep` content search, `fffind` path search, `fff-multi-grep`) before `ripgrep` / `grep` / `rg`. fff (`.mcp.json` → `fff-mcp`, a resident Rust index installed by `tools` + pinned in `external-tools.json`) keeps the index + file cache warm for the whole session, sub-10ms queries vs 3-9s per ripgrep spawn on a large tree, and ranks definitions first with frecency + git-aware annotations, so the agent lands on the right code in fewer roundtrips and less context. `ripgrep` / `grep` stay fine for one-off shell use and inside scripts; this rule is about the agent's interactive search loop. Ask the agent to "use fff" if a session's client didn't auto-pick the tools.

A Python project uses [`uv`](https://docs.astral.sh/uv/) (Astral), pinned in `external-tools.json` (currently `0.11.21`). uv is the Python analog of the fleet's pnpm model: a hash-verified `uv.lock` plus an `exclude-newer` soak. The dev shortcut for one-off CLI tools stays `pipx install <pkg>==<ver>` (pinned). Never bare `pip`/`pip3` (`.claude/hooks/fleet/prefer-pipx-over-pip-guard/`).

A project opts into uv with a `[tool.uv]` table in `pyproject.toml`. Such a project MUST commit a `uv.lock` and pin the soak; `scripts/fleet/check/uv-lockfiles-are-current.mts` (in `check --all`) fails otherwise. Both the check and any future guard read `.claude/hooks/fleet/_shared/uv-config.mts`.

- **Lockfile.** `uv lock` writes `uv.lock` with per-dependency hashes; uv verifies them on install, so no separate `--require-hashes`. Commit it like `pnpm-lock.yaml`.
- **Reproducible CI.** `uv sync --locked` installs strictly from the lock and errors if it's stale (the `--frozen-lockfile` analog). `uv sync --frozen` skips the staleness check. `uv lock --check` asserts the lock is current with no side effects.
- **Soak.** Pin `[tool.uv] exclude-newer` to the 7-day window (the `minimumReleaseAge` analog). uv then refuses any package published more recently, blocking freshly-published malware:

```toml
[tool.uv]
exclude-newer = "7 days"
```

- **Malware scan (optional).** `UV_MALWARE_CHECK=1` makes `uv sync` run a lightweight OSV scan of the lockfile.

uv is pre-1.0 (`0.x`), adopted as a noted exception to the stable-1.0+ rule because it is de-facto stable, Astral-backed, Apache-2.0 / MIT, and ships as a single static binary. It replaces the unpinned `pip3 install --break-system-packages` pattern in Dockerfiles, which has no lockfile or soak.

## zsh does not word-split

The fleet's interactive shell is zsh, and zsh does NOT word-split an unquoted
parameter expansion (no `SH_WORD_SPLIT`). A variable built as a space-joined
list passes as a single argument:

```bash
files=$(find test -name '*.test.mts' | tr '\n' ' ')
vitest run $files            # zsh: ONE argument, matches nothing
```

Paired with a tool that exits 0 on zero
matches (`vitest` `passWithNoTests`, `rg -l`, `xargs -r`), the failure is
invisible: the command "succeeds" having done nothing. Pass a list through
one of the forms zsh actually splits: command substitution
(`vitest run $(cat /tmp/list)`), forced splitting (`vitest run ${=files}`),
or a pipe into `xargs`. `.claude/hooks/fleet/zsh-word-split-guard/` BLOCKS when
a Bash command both builds a list-shaped variable and later expands it unquoted
as a standalone argument; bypass with `Allow zsh-word-split bypass`. It blocks
rather than advises because an EMPTY list drops the argument entirely, so the
tool falls back to its default input: `rg -c pat $files` with `files` unset
scans the whole tree and answers confidently about the wrong thing.

## ripgrep: `-r` never clusters

rg's `-r` (`--replace`) takes a value, so inside a short-flag cluster it consumes the REST of the cluster as the replacement text: `rg -rln <pattern>` parses as `rg --replace 'ln' <pattern>`. Every match is rewritten to the literal text `ln` instead of listing files with line numbers, and the command still exits 0, so the corruption is easy to miss. Spell `-r` separately (`rg -l -n`), use long flags, or pass `--replace '<text>'` only when a replacement is meant. `-r` last in a cluster (`-lnr <text>`) and standalone `-r <text>` read the next argument as the replacement and are fine. BLOCKED by `.claude/hooks/fleet/rg-replace-flag-guard/`, bypass slug `rg-replace-cluster`.

## Reserved `scripts/` dir names

Script tiers are `scripts/fleet/` + `scripts/repo/`; name any other dir for its job, never a build/output concept (`build`, `dist`, `node_modules`, `coverage`, `cache`). Bypass `Allow reserved-script-dir bypass` (`.claude/hooks/fleet/reserved-script-dir-guard/`).

## CDN allowlist

A `curl`/`wget`/`fetch` to an off-allowlist host is blocked. Fetch only from approved public package registries / CDNs (`.claude/hooks/fleet/_shared/cdn-allowlist.mts` seed; public hosts only, NEVER an internal `*.svc.cluster.local`). Bypass `Allow cdn-allowlist bypass` (`.claude/hooks/fleet/cdn-allowlist-guard/`).

## Package-manager auto-update OFF

Every package manager the fleet uses for tooling (`brew`/`choco`/`winget`/`scoop`/`npm`/`pnpm`) must have auto-update disabled, so an invocation can't change a tool version mid-task or pull an unsoaked package. Knobs set by `setup-security-tools`, audited in `check --all`, enforced at invocation. Bypass `Allow package-manager-auto-update bypass` (or `Allow <name> auto-update bypass` per manager) (`.claude/hooks/fleet/package-manager-auto-update-guard/`).

## Homebrew supply-chain hardening (macOS)

Homebrew 6.0.0 added two opt-in supply-chain controls. The fleet requires both, plus the version floor they depend on. A `brew` below 6.0.0 or with a knob unset is blocked at invocation (`.claude/hooks/fleet/brew-supply-chain-guard/`), audited in `check --all` (`scripts/fleet/check/brew-supply-chain-is-hardened.mts`), and set by `setup-security-tools` (persists both knobs into the managed shell-rc block). All three read `.claude/hooks/fleet/_shared/brew-supply-chain.mts`.

- **`HOMEBREW_REQUIRE_TAP_TRUST=1`** - refuse to evaluate a third-party tap's code until it is explicitly trusted (`brew trust user/repo`, or `--formula`/`--cask`/`--command` for a single item). Closes the tap-as-RCE surface. Official taps stay trusted by default. See <https://docs.brew.sh/Tap-Trust>.
- **`HOMEBREW_CASK_OPTS_REQUIRE_SHA=1`** - refuse a cask whose download has no pinned checksum (`sha256 :no_check`). See <https://docs.brew.sh/Supply-Chain-Security>.

Both env knobs are silently ignored by an older Homebrew, so the **≥6.0.0 version floor is the real gate**. The guard reads the installed version from `brew --version`; on a machine below the floor every `brew` invocation is blocked until `brew update && brew upgrade` clears it. Bypass `Allow brew-supply-chain bypass`. This is a distinct concern from auto-update (which owns `HOMEBREW_NO_AUTO_UPDATE`): two single-purpose guards on `brew`, one per concern.

## Sparkle GUI-app auto-update OFF (macOS)

macOS GUI apps the fleet uses for tooling that self-update via the [Sparkle](https://sparkle-project.org/) framework (e.g. OrbStack, bundle `dev.kdrag0n.MacVirt`) must have auto-update disabled. A Sparkle install can swap a tool version under a running build or scan, and it rides the app's own update channel outside the soak gate. Set by `setup-security-tools`, audited in `check --all` (`scripts/fleet/check/sparkle-auto-update-is-disabled.mts`); both read `.claude/hooks/fleet/_shared/sparkle-auto-update.mts`. There's no PreToolUse guard: a GUI app self-updates with no Bash invocation to gate, so persist plus audit are the surfaces.

The disable writes two Sparkle prefs into the app's defaults domain, since a user-level `defaults write` overrides the Info.plist default:

```sh
defaults write dev.kdrag0n.MacVirt SUAutomaticallyUpdate -bool false
defaults write dev.kdrag0n.MacVirt SUEnableAutomaticChecks -bool false
```

`SUEnableAutomaticChecks=false` stops the background update check; `SUAutomaticallyUpdate=false` stops silent install of a found update. Add a new Sparkle app by appending to `SPARKLE_APPS` in `.claude/hooks/fleet/_shared/sparkle-auto-update.mts` (id, name, bundle-id domain); the persist and audit pick it up automatically.

## Lint/fix scope: modified by default, `--all` for waves

`pnpm run lint` and `pnpm run fix` default to **modified scope**, only files
git sees as changed (plus `--staged` in pre-commit). A repo-wide autofix
campaign run that way is a **silent no-op on the whole backlog**: the run exits
green having fixed nothing outside your edits (two delegated wave runs reported
success while fixing zero backlog files, 2026-07-07). For a wave, pass `--all`:
`pnpm run lint --fix --all` (`pnpm run fix --all` forwards it and adds the
doctor). The `template/` tree is OFF the default lint surface everywhere.
In the wheelhouse it only lints under `LINT_DOGFOOD=1`, so a wave that must
reach canonical sources is `LINT_DOGFOOD=1 pnpm run lint --fix --all`. Every
scoped `--fix` run now ends with a loud reminder naming the wave form
(`fixScopeReminder` in `scripts/fleet/lint.mts`).

## Docs lead with pnpm

User-facing install commands in fenced code blocks must show the pnpm form first (`pnpm install <pkg>`, `pnpm add <pkg>`). npm / yarn fallbacks are fine but come after, or in a separate block introduced as a fallback. The pre-commit `scanDocsPnpmFirst` scanner emits a warning (not a hard fail) for `.md` / `.mdx` blocks that lead with npm or yarn without a pnpm leader. Suppress per-block with `socket-lint: allow pnpm-first` (HTML comment above the fence or any line inside it).

## New dependencies + soak

Every new dep added to `package.json` runs a Socket-score check at edit time. Low-scoring deps block (enforced by `.claude/hooks/fleet/check-new-deps/`). The 7-day `minimumReleaseAge` soak is malware protection. Never add to `pnpm-workspace.yaml` `minimumReleaseAge.exclude[]` (bypass `Allow soak-time bypass`, alias `Allow minimumReleaseAge bypass`, for emergency CVE patches; enforced by `.claude/hooks/fleet/minimum-release-age-guard/`).

Every per-package soak-bypass entry (the `'pkg@1.2.3'` exact-pin form) MUST carry a `# published: YYYY-MM-DD | removable: YYYY-MM-DD` annotation as the LAST comment line above the bullet. `published` is the version's npm publish date; `removable` is `published + 7d` so a periodic cleanup can drop entries that no longer need the bypass (enforced by `.claude/hooks/fleet/soak-exclude-date-guard/` at edit time + `scripts/fleet/check/soak-excludes-have-dates.mts` at commit time).

**Add a soak-bypass ONLY with the writer, never by hand:** `node scripts/fleet/soak-bypass.mts <pkg>@<version>`. It fetches the authoritative npm publish date, writes the dated `'name@version'` pin to `pnpm-workspace.yaml` (canonical, since pnpm reads it directly), AND appends the bare-name line to `.npmrc` (for npm >= v12, which matches soak-excludes by NAME or glob only, no `@version`, see [npm/cli#9532](https://github.com/npm/cli/pull/9532)), keeping both package managers in lockstep from one command. `.npmrc` itself is cascade-GENERATED (`scripts/repo/gen/npmrc.mts` in the source repo, from the manifest `EXPECTED_RELEASE_AGE_EXCLUDE` + `SOCKET_PACKAGE_PATTERNS`), so the local append is the ephemeral unblock. The durable fleet-wide form is the manifest entry, which the next cascade renders into every repo's `.npmrc`.

The wheelhouse's own canonical annotation source (`release-age-annotations.mts`, cascaded into every member's `.npmrc`) is a second, earlier place the same pin-to-annotation parity must hold. `.claude/hooks/fleet/soak-pin-needs-annotation-guard/` blocks adding a version-pinned entry to `scripts/repo/sync-scaffolding/manifest/workspace.mts` without a matching `{ published, removable }` annotation, catching the mismatch at edit time instead of a later cascade crash.

An edit to `package.json`'s dependency blocks or `pnpm-workspace.yaml`'s `catalog`/`overrides`/`minimumReleaseAgeExclude` needs two follow-ups before it lands: regenerate the lockfile (`pnpm i` or `pnpm i --lockfile-only`) so `pnpm install --frozen-lockfile` passes in CI, and update the canonical sources several CI gates derive from. `.claude/hooks/fleet/dep-derived-source-nudge/` (PostToolUse) nudges both at the moment of the edit, since forgetting either trips CI separately in a multi-round-trip trap. A modified or staged `pnpm-lock.yaml` anywhere in the tree after a `git`/`pnpm` command gets the same reminder from `.claude/hooks/fleet/dirty-lockfile-nudge/`: run `pnpm i` to reconcile before committing the pair.

Vitest `include` globs must not match `node:test` files. Mismatched runners produce confusing "no test suite found" errors (enforced by `.claude/hooks/fleet/vitest-vs-node-test-guard/`).

## Dependency dedup

No avoidable cross-major duplicate in the install tree, and every package
with a hardened `@socketregistry/*` drop-in is redirected to it via
`pnpm-workspace.yaml` `overrides:`. `scripts/fleet/check/dependencies-are-deduped.mts`
(in `check --all`) fails on either violation; `/fleet:deduping-dependencies`
collapses a found duplicate.

## VS Code auto-run-on-open tasks are never committed

A `.vscode/tasks.json` (or a `*.code-workspace` with an embedded `tasks`
block) declaring `"runOptions": { "runOn": "folderOpen" }` makes VS Code
execute the task the instant the folder opens, with no click and no review:
a known drive-by / supply-chain RCE vector a malicious dependency, PR, or
cascade could ship. `.vscode/` is gitignored fleet-wide (only `settings.json`
is re-included), so this is normally unreachable, but `.claude/hooks/fleet/vscode-folder-open-task-guard/`
blocks it as the backstop for an explicitly force-added file and covers the
`*.code-workspace` shape the gitignore doesn't catch.

## Bundler

`rolldown`, NOT `esbuild`. The fleet standardizes on rolldown for direct bundling (see `template/base/.config/fleet/rolldown/` and the plugins under `template/base/.config/repo/rolldown/`). Transitive esbuild deps (e.g. via vitest) are unavoidable today. The rule is no _new direct_ esbuild use anywhere in the fleet.

## Engine-gate folding (`engine-gate-fold`)

`.config/repo/rolldown/engine-gate-fold.mts` (`createEngineGateFoldPlugin`) precomputes semver-vs-runtime engine gates in bundled (vendored) code from the `engines.node` of the package being built. Vendored deps ship gates like `useNative = node.satisfies('>=16.7.0')` (the @npmcli/fs `lib/common/node.js` shape) whose losing branch, usually a polyfill, is dead weight the bundler can't drop because the gate looks dynamic. Motivating incident: socket-packageurl-js's bundled `dist/exists.js` crashed at require-time on exactly that vendored gate. <!-- docs-refs-ignore: package-internal paths in other packages/repos -->

- **Statically-safe shapes only, string-literal ranges only**: `satisfies(process.version, 'R')` / `semver.satisfies(process.version, 'R')` and comparator forms `gte|gt|lte|lt(process.version, 'V')` when the callee provably binds to the `semver` package, plus `helper.satisfies('R')` when the callee resolves to a vendored node-version helper module structurally verified to wrap `semver.satisfies(process.version, range)`. Anything dynamic stays untouched.
- **Verdicts are interval math against `engines.node`** (read once at plugin creation; the factory throws without a valid range): engines ⊆ gate-range → literal `true`; provably disjoint → literal `false`; partial overlap → untouched. Unbounded floors are honest: `>=99` under engines `>=18` is a partial overlap, a future node 99 exists in both sets, not a false fold. Provable `false` comes from upper-bounded gates (`lt(process.version, '18.0.0')` under `>=18`) or bounded engines unions (`^18 || ^20` vs `>=99`).
- **The literal lets rolldown DCE drop the dead branch** (and its polyfill imports). Every folded site is logged (module id + gate source + verdict). Silent transforms are banned.
- **Wire it into the repo's `rolldown.config.mts` `plugins`**: `createEngineGateFoldPlugin()` (reads `engines.node` from cwd; pass `{ packageDir }` otherwise). Requires `semver` catalog-pinned in devDependencies and `define-guarded.mts` alongside (it imports its AST helpers). The cascade delivers the file to every repo carrying `.config/repo/rolldown/define-guarded.mts` (CONDITIONAL_FILES marker).

## Factory-collision guards (`factory-collision`)

`.config/repo/rolldown/factory-collision.mts` guards the nested-bundle factory-collision class: re-bundling a file that is ITSELF a bundler output, a pre-bundled dependency like socket-lib's `dist/external/npm-pack.js`, carries pre-suffixed CJS factory bindings such as `require_node$2`, and rolldown's identifier deconflicter can rename another `require_node` onto exactly that pre-existing name in the same emitted scope. The later `var` declaration silently clobbers the earlier, so an unrelated binding resolves to the wrong module at runtime. Motivating incidents: socket-cli's dlx crash, where Arborist's `pacote` rebound to libnpmpack via a colliding `require_lib$10`, and socket-packageurl-js's `dist/exists.js` require-time crash, where two `var require_node$2` in one scope turned `node.satisfies` into a class. <!-- docs-refs-ignore: dist paths inside other repos' bundles -->

Two independent guards; adopt either or both in the repo's `rolldown.config.mts` `plugins`:

- **`createPrebundleRenamePlugin({ prebundlePattern })` is the fix** - the proven socket-cli mechanics, generalized. It rewrites `require_*$N` factory names inside files matching `prebundlePattern` to a `$`-free form (`require_lib$36` → `require_lib_v36`) the deconflicter can never generate, and realpath-normalizes resolved ids so a symlink-aliased prebundle (pnpm's `@socketsecurity/lib` + `lib-stable` aliases point at one real package) can't enter the graph twice and force the deconflict at all. Place it FIRST in `plugins` so its `resolveId` hook sees every resolution; custom `resolveId` hooks that hand-compute paths should return `toRealPath(p)` themselves.
- **`createCollisionDetectorPlugin()` is the backstop** - a post-render `generateBundle` check that fails the build when any emitted chunk declares the same `var require_*` binding twice in one scope. Cheap: a regex pass filters chunks that can't collide, only suspects pay for the scope-aware AST scan. Wire it even where the rename plugin isn't adopted. A silent wrong-module rebinding is strictly worse than a red build.
- **Delivery**: same CONDITIONAL_FILES channel as engine-gate-fold. Every repo carrying `.config/repo/rolldown/define-guarded.mts` receives the file on sync.

## Compile-time defines (`INLINED_*`)

Build-inlined constants use the `process.env.INLINED_*` naming convention (mirrors socket-cli: `INLINED_VERSION`, `INLINED_NAME`, …). The `INLINED_` prefix flags at a glance that a value is substituted at build time, not read from the real environment at runtime.

Substitution is done by `template/base/.config/repo/rolldown/define-guarded.mts` (`defineGuardedPlugin`), an esbuild-`define`-equivalent that only rewrites _read_ positions: it never touches assignment targets, `delete` / `++` / `--` operands, or dynamic `process.env[expr]` access (so `delete process.env.DEBUG` stays valid, unlike oxc's built-in `define`).

- **Source must use quoted bracket access**: `process.env['INLINED_EXTENSION_VERSION']`. `process.env` is an index-signature type, so TypeScript (TS4111) forbids dot access. The plugin normalizes dot and quoted-bracket access to the same dotted define key, so one `'process.env.INLINED_X'` key matches `process.env.INLINED_X`, `process.env['INLINED_X']`, and `process.env["INLINED_X"]`.
- **Define key is the dotted form**: `defineGuardedPlugin({ 'process.env.INLINED_X': JSON.stringify(value) })`. Values are already-quoted source text (same contract as esbuild / oxc `define`).
- **`magic-string` is the fallback**: `defineGuarded` does its surgical rewrites with MagicString. When the build opts into rolldown's `experimental.nativeMagicString` (set `experimental: { nativeMagicString: true }` + `output.sourcemap: true` in the rolldown config), the `transform` hook receives a Rust-backed native MagicString on `meta.magicString` and the plugin uses it. Note: the API is the same, with no JS `toString()`/`generateMap()` round-trip. Without the flag, `meta.magicString` is absent and it constructs a JS `magic-string` instance. So `magic-string` stays catalog-pinned (`pnpm-workspace.yaml`) and a member adopting the plugin keeps `"magic-string": "catalog:"` in devDependencies as the fallback path.

## Backward compatibility

FORBIDDEN to maintain. Remove when encountered.

## `packageManager` field

Retired: there is NO `packageManager` field, and corepack is disabled fleet-wide. `scripts/fleet/sync-package-manager-pins.mts` is the code-as-law: it derives every pin from `external-tools.json`'s `tools.{pnpm,npm}.version`, deletes any legacy `packageManager` it finds, and writes:

- `devEngines.packageManager` - pnpm at the major-bounded SemVer range derived from the floor, `11.0.5` → `>=11.0.0 <12.0.0`, with `onFail: error`. This is the enforced manager pin: a mismatched pnpm is refused, and the fleet provisions pnpm out-of-band, so nothing ever downloads a package manager on the fly. Note: the setup action reads `external-tools.json` in CI, and local uses the racked pnpm.
- `engines.pnpm` - the `>=<floor>` floor.
- `engines.npm` - the `>=<npm-version>` floor.

`pnpm-workspace.yaml` keeps `managePackageManagerVersions: false` plus `pmOnFail: warn` as a belt: pnpm's legacy `packageManager` self-check stays off and is moot without the field. Integrity needs no field-level hash either: pnpm 11 stores it in `pnpm-lock.yaml`, the integrity source of truth.

Drift is directional. A pin behind a newer `external-tools.json` warns and continues: a cascade reconciles it during a rollout window, and hard-failing would block unrelated member PRs. A pin ahead of the source, or otherwise inconsistent, fails. `packageManager` removal and any `devEngines.packageManager` reshape are advisory, never a hard fail. Run the sync after a bump. `scripts/fleet/external-tools/update.mts --apply` calls it, and `pnpm run update` reaches it through the `update/external-tools.mts` lane; the `package-manager-pins-are-synced` check gates drift in CI.

## Bumping a versioned tool fleet-wide (pnpm, zizmor, sfw)

**Entry point: `scripts/repo/cascade-fleet.mts`** bumps one tool's pinned version and commits it. Run from the wheelhouse repo:

```bash
node scripts/repo/cascade-fleet.mts --pnpm 11.3.0 [--dry-run] [--self]
```

The bump stage (`pipeline-stages.mts#runBump` → `tools/<tool>.mts#applyToRegistry`) downloads every platform binary from upstream, recomputes sha256 ourselves (integrity = binary-download + own-checksum, never trust in upstream-published values), writes socket-registry's `.config/repo/external-tools.json`, and commits. Tools with a `sourceDir` override (node, npm) write the wheelhouse root instead (`.node-version` / `package.json` engines).

**Propagation is the sync-scaffolding cascade, not this script.** external-tools.json is a cascaded file. After a bump, run the cascade to fan it out to every member. The former registry-hosted reconcile / gate / propagate stages (which pinned members to a socket-registry SHA) were retired with the socket-registry shared-source model; fleet actions now live in each repo as `.github/actions/fleet/*`, referenced by local `./` path, so there is no cross-repo pin to rewrite. (`--skip-ci-wait` / `--ci-timeout` are vestigial no-ops from the retired gate stage.)

### Soak gate

The bump honors the 7-day `minimumReleaseAge` cooldown via `--soak-days <n>` (default 7). Pulling a same-day release requires explicit bypass. See `bypass-phrases.md` row `Allow soak-time bypass` (alias `Allow minimumReleaseAge bypass`).

## Monorepo internal `engines.node`

Only the workspace root needs `engines.node`. Private (`"private": true`) sub-packages in `packages/*` don't need their own `engines.node` field. The field is dead, drift-prone, and removing it is the cleaner play. Public-published sub-packages, the npm-published ones with no `"private": true`, keep their `engines.node` because external consumers see it.

## Config files in `.config/`

Place tool / test / build configs in `.config/`: `taze.config.mts`, `vitest.config.mts`, `esbuild.config.mts`, `tsconfig.base.json`. That last one is the abstract compiler-options layer, fleet-canonical and byte-identical across the fleet. New abstract configs go in `.config/` by default.

Repo root keeps only what _must_ be there: package manifests + lockfile (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`), the linter / formatter dotfiles whose tools require root placement (`.oxlintrc.json`, `.oxfmtrc.json`, `.npmrc`, `.gitignore`, `.node-version`), and every **concrete** tsconfig (`tsconfig.json`, `tsconfig.check.json`, `tsconfig.dts.json`, `tsconfig.test.json`, etc.; anything with `include`/`exclude`/`files`). Concrete tsconfigs live at the package root so tsc + IDE language-servers discover them natively at cwd. Burying them in `.config/` breaks the lookup. In monorepos the concrete `tsconfig.json` lives at each `packages/<pkg>/`. Concrete configs `extend` `./.config/tsconfig.base.json` (single-repo at root) or `../../.config/tsconfig.base.json` (monorepo per-package).

## Runners are `.mts`, not `.sh`

Every executable script (skill runner, hook handler, fleet automation) is TypeScript via `node <file>.mts`. Bash works on macOS/Linux but breaks on Windows. `bash` isn't on Windows PATH by default and `if [ ... ]` / `${VAR:-default}` aren't portable. The fleet runs on developer machines (mixed macOS / Linux / Windows / WSL) and CI (Linux), so cross-platform is a hard requirement. Use `@socketsecurity/lib/spawn` (`spawn`, `isSpawnError`) instead of `child_process`. It ships consistent error shapes (`SpawnError`), `stdioString: true` for buffered stdout, and integrates with the rest of the lib. Reach for `_shared/scripts/*.mts` for cross-skill helpers (default-branch resolution, report formatting); reach for `<skill>/run.mts` for skill-specific implementation. Reserve `.sh` for tiny one-shot snippets that have no Windows audience (e.g., a `bin/` wrapper). The `lib/` vs `scripts/` distinction matches `@socketsecurity/lib` (public, importable surface) vs per-package `scripts/` (private, internal automation). Skill helpers are internal, hence `scripts/`.

## Soak time

(pnpm-workspace.yaml `minimumReleaseAge`, default 7 days). Never add packages to `minimumReleaseAgeExclude` in CI. Locally, ASK before adding (security control), then add it with `node scripts/fleet/soak-bypass.mts <pkg>@<version>` (never by hand; see "New dependencies + soak" above for why: it keeps `pnpm-workspace.yaml` and `.npmrc` in lockstep).

## External repo clones

When reviewing or referencing an external GitHub repo (not a fleet member), clone it locally so an agent can read, search, and index it, rather than fetching through the GitHub web API.

### What

Clone to `~/.socket/_wheelhouse/repo-clones/<org>-<repo>/`, where `<org>-<repo>` is lowercase + dash-cased (e.g. `justrach-codedb`). Resolve the directory via `getSocketRepoClonesDir()` from `@socketsecurity/lib/paths/socket`. Never clone into `~/projects/`. That path is for fleet-member checkouts, and the fleet's sibling-walk tooling (cascade `--all`, fleet-roster discovery) would mistake a reference clone for a member repo.

### Why

Agents need a local tree to run `grep`/`read`/index operations efficiently. A standardized path keeps reference clones discoverable across sessions and safely isolated from the fleet-member space.

### How to apply

Clone the smallest practical way, blobless + shallow:

```bash
git clone --depth=1 --single-branch --filter=blob:none <url> <dest>
```

- `--depth=1` - no history.
- `--single-branch` - skip other refs.
- `--filter=blob:none` - blobless partial clone; file blobs fetched lazily on first access, so the initial download is tree-metadata only.

Treeless (`--filter=tree:0`) is smaller but refetches trees on every walk (slow, breaks offline). Blobless is the smallest-practical balance.

This is distinct from a submodule (nested, pinned-in-parent) and a worktree (second working dir of an existing local repo). A reference clone is a standalone checkout.

### Enforcement

`.claude/hooks/fleet/clone-reviewed-repo-nudge/` nudges when reviewing an external repo with no local clone, and when a `git clone` of an external repo omits the smallest-practical flags.

## Every `git clone` is shallow and single-branch

The `--depth=1` (or `--depth 1`) plus `--single-branch` pair above isn't only a reference-clone convention. A bare `git clone <url>` with neither flag downloads full history and every ref, which is almost never the intent for an agent that only needs the current tree. `.claude/hooks/fleet/shallow-clone-guard/` blocks any `git clone` missing either flag (`git clone --help`/`-h` pass through unblocked). Bypass: `Allow shallow-clone bypass`.

## Upstream submodules: always shallow

Every entry in `.gitmodules` MUST set `shallow = true`. Every `git submodule update --init` call (postinstall.mts, CI, manual) MUST pass `--depth 1 --single-branch`. Upstream repos like yarnpkg/berry, oven-sh/bun, rust-lang/cargo are multi-GB with full history. We only ever need the pinned SHA's tree. A non-shallow init can take 30+ minutes and waste GB of disk on every fresh clone. There is no scenario where the fleet needs upstream submodule history.

## `-stable` self-import in tooling

A fleet repo that publishes `@socketsecurity/<X>` resolves the bare `@socketsecurity/<X>` specifier to its OWN local `src/`, the pnpm workspace link, which is work-in-progress and may be mid-edit or broken. Build scripts and git-hooks must run against a known-good PUBLISHED copy, so the fleet pins a `@socketsecurity/<X>-stable` catalog alias (`npm:@socketsecurity/<X>@<last-published>`). Tooling imports the `-stable` alias; only the package's own source consumers use the bare name.

Scope: files under `scripts/**` or `.claude/hooks/**` (test files exempt). The owned package name is read from the nearest ancestor `package.json` `name`. Only the repo's OWN package is flagged. For example, in socket-lib, `@socketsecurity/lib/...` must become `@socketsecurity/lib-stable/...`, but `@socketsecurity/registry/...` is left alone (socket-lib doesn't own registry).

Bump the `-stable` alias in lockstep with the plain catalog pin on every release. They point at the same package, one tracking workspace/source the other the published snapshot.

**Why:** Past incident: socket-lib's git-hooks imported `@socketsecurity/lib/logger/default` (bare). In socket-lib that resolves to local `src/`; during a version straddle the `logger/default` subpath didn't exist in the working tree yet, so every commit threw `ERR_PACKAGE_PATH_NOT_EXPORTED`. The `-stable` alias would have resolved to the published package that already had the subpath.

Enforced by the fixable `socket/prefer-stable-self-import` oxlint rule (rewrites the package segment, preserving the subpath). The deterministic published-dependency surface for scripted/AI-driven tooling follows [Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices): generated edits build against a stable contract, not a moving local-src target.

## Docker runtime (macOS)

Repos with Dockerfile-based cross-builds (socket-btm's `glibc`/`musl`
node-smol images) need a local Docker engine. On macOS the recommended
runtime is **[OrbStack](https://docs.orbstack.dev/)** ([download](https://orbstack.dev/download)),
a faster, lighter drop-in for Docker Desktop (lower memory, near-instant
start, native `docker` CLI compatibility). macOS-only; Linux dev hosts use
the distro's native Docker/Podman and don't need it. It's a recommended
dev convenience, not a build requirement. CI builds run on Linux runners
with native Docker, so OrbStack only affects local Mac iteration. Repos
that consume it pin it in their own `.config/repo/external-tools.json` (per-repo, not
template) and may wire a `brew install --cask orbstack` onboarding step.

## Local CI runs (`agent-ci`)

[`@redwoodjs/agent-ci`](https://agent-ci.dev/#quick-start) runs a repo's
GitHub Actions workflows locally in a Linux container (official runner
binary, bind-mounted deps for near-instant startup, pauses-on-failure for
debugging). Optional, local-dev only; needs a Docker runtime (see above).

**Run it through the fleet dlx, never raw `npx`** (the `NEVER npx` rule
applies; `@socketsecurity/lib/dlx/package`'s `dlxPackage` + `executePackage`
download + integrity-verify the pinned package through Socket Firewall):

```mts
import { dlxPackage, executePackage } from '@socketsecurity/lib/dlx/package'
// version resolves from the repo's .config/repo/external-tools.json `agent-ci` pin
```

**Limitations** ([compatibility](https://agent-ci.dev/compatibility)): it
**skips reusable workflows** (`workflow_call`), has no GH-secret access, no
concurrency groups, and a simplified job-`if` evaluator. The fleet `ci.yml`
is self-contained: its jobs call local `./.github/actions/fleet/*` composite
actions (which agent-ci runs), never a cross-repo reusable workflow, so
agent-ci runs the full lint / type / test matrix. Repos that adopt it pin
the version in their own `.config/repo/external-tools.json`.

## npm 2FA registry ops

`npm deprecate` / `publish` / `access` / `owner` / `unpublish` / `dist-tag`
require a one-time password from an authenticator, and npm only prompts for
it on an **interactive TTY**. The `!` / headless channel has no TTY, so the
prompt is swallowed and the command dies with `EOTP`. Tell the user to run
the op in a **real terminal** where the prompt can appear; fall back to
`--otp=<code>` only when no TTY is available and the user supplies a fresh
code. Reminder hook: `.claude/hooks/fleet/npm-otp-flow-nudge/`.
