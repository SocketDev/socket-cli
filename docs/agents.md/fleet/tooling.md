# Tooling

The CLAUDE.md `### Tooling` section is the short list. This file is the full set of rules and their rationale.

## Package manager

`pnpm`. Run scripts via `pnpm run foo --flag`, never `foo:bar`. After `package.json` edits, `pnpm install`.

## No `npx` / `dlx` / `<pm> exec`

NEVER use `npx`, `pnpm dlx`, `yarn dlx`, NOR `pnpm`/`npm`/`yarn exec`. Run `node_modules/.bin/<tool>` or `pnpm run <script>`. Enforced by `.claude/hooks/fleet/no-pm-exec-guard/`; bypass `Allow pm-exec bypass`.

## No `--experimental-strip-types`

NEVER pass `--experimental-strip-types` to `node`. Runners are `.mts` executed by a Node version that strips types natively, or via the repo's own toolchain — the experimental flag changes parsing/semantics and is forbidden (`.claude/hooks/fleet/no-strip-types-guard/`).

## Never pipe install/check/test/build to `tail`/`head`

The Socket Firewall (SFW) footer carries malware/soak warnings; piping `pnpm install`/`check`/`test`/`build` output to `tail` or `head` hides it. Let the full output through (`.claude/hooks/fleet/no-tail-install-out-guard/`).

## Search: `fff` MCP, not `ripgrep` / `grep`

For file + content search in a git-indexed tree, reach for the **fff** MCP tools (`ffgrep` content search, `fffind` path search, `fff-multi-grep`) before `ripgrep` / `grep` / `rg`. fff (`.mcp.json` → `fff-mcp`, a resident Rust index installed by `setup-tools` + pinned in `external-tools.json`) keeps the index + file cache warm for the whole session — sub-10ms queries vs 3-9s per ripgrep spawn on a large tree — and ranks definitions first with frecency + git-aware annotations, so the agent lands on the right code in fewer roundtrips and less context. `ripgrep` / `grep` stay fine for one-off shell use and inside scripts; this rule is about the agent's interactive search loop. Ask the agent to "use fff" if a session's client didn't auto-pick the tools.

A Python project uses [`uv`](https://docs.astral.sh/uv/) (Astral), pinned in `external-tools.json` (currently `0.11.21`). uv is the Python analog of the fleet's pnpm model: a hash-verified `uv.lock` plus an `exclude-newer` soak. The dev shortcut for one-off CLI tools stays `pipx install <pkg>==<ver>` (pinned). Never bare `pip`/`pip3` (`.claude/hooks/fleet/prefer-pipx-over-pip-guard/`).

A project opts into uv with a `[tool.uv]` table in `pyproject.toml`. Such a project MUST commit a `uv.lock` and pin the soak; `scripts/fleet/check/uv-lockfiles-are-current.mts` (in `check --all`) fails otherwise. Both the check and any future guard read `_shared/uv-config.mts`.

- **Lockfile.** `uv lock` writes `uv.lock` with per-dependency hashes; uv verifies them on install, so no separate `--require-hashes`. Commit it like `pnpm-lock.yaml`.
- **Reproducible CI.** `uv sync --locked` installs strictly from the lock and errors if it's stale (the `--frozen-lockfile` analog). `uv sync --frozen` skips the staleness check. `uv lock --check` asserts the lock is current with no side effects.
- **Soak.** Pin `[tool.uv] exclude-newer` to the 7-day window (the `minimumReleaseAge` analog) — uv then refuses any package published more recently, blocking freshly-published malware:

```toml
[tool.uv]
exclude-newer = "7 days"
```

- **Malware scan (optional).** `UV_MALWARE_CHECK=1` makes `uv sync` run a lightweight OSV scan of the lockfile.

uv is pre-1.0 (`0.x`) — adopted as a noted exception to the stable-1.0+ rule because it is de-facto stable, Astral-backed, Apache-2.0 / MIT, and ships as a single static binary. It replaces the unpinned `pip3 install --break-system-packages` pattern in Dockerfiles, which has no lockfile or soak.

## Reserved `scripts/` dir names

Script tiers are `scripts/fleet/` + `scripts/repo/`; name any other dir for its job, never a build/output concept (`build`, `dist`, `node_modules`, `coverage`, `cache`). Bypass `Allow reserved-script-dir bypass` (`.claude/hooks/fleet/reserved-script-dir-guard/`).

## CDN allowlist

A `curl`/`wget`/`fetch` to an off-allowlist host is blocked — fetch only from approved public package registries / CDNs (`_shared/cdn-allowlist.mts` seed; public hosts only, NEVER an internal `*.svc.cluster.local`). Bypass `Allow cdn-allowlist bypass` (`.claude/hooks/fleet/cdn-allowlist-guard/`).

## Package-manager auto-update OFF

Every package manager the fleet uses for tooling (`brew`/`choco`/`winget`/`scoop`/`npm`/`pnpm`) must have auto-update disabled, so an invocation can't change a tool version mid-task or pull an unsoaked package. Knobs set by `setup-security-tools`, audited in `check --all`, enforced at invocation. Bypass `Allow package-manager-auto-update bypass` (or `Allow <name> auto-update bypass` per manager) (`.claude/hooks/fleet/package-manager-auto-update-guard/`).

## Homebrew supply-chain hardening (macOS)

Homebrew 6.0.0 added two opt-in supply-chain controls. The fleet requires both, plus the version floor they depend on — a `brew` below 6.0.0 or with a knob unset is blocked at invocation (`.claude/hooks/fleet/brew-supply-chain-guard/`), audited in `check --all` (`scripts/fleet/check/brew-supply-chain-is-hardened.mts`), and set by `setup-security-tools` (persists both knobs into the managed shell-rc block). All three read `_shared/brew-supply-chain.mts`.

- **`HOMEBREW_REQUIRE_TAP_TRUST=1`** — refuse to evaluate a third-party tap's code until it is explicitly trusted (`brew trust user/repo`, or `--formula`/`--cask`/`--command` for a single item). Closes the tap-as-RCE surface. Official taps stay trusted by default. See <https://docs.brew.sh/Tap-Trust>.
- **`HOMEBREW_CASK_OPTS_REQUIRE_SHA=1`** — refuse a cask whose download has no pinned checksum (`sha256 :no_check`). See <https://docs.brew.sh/Supply-Chain-Security>.

Both env knobs are silently ignored by an older Homebrew, so the **≥6.0.0 version floor is the real gate**. The guard reads the installed version from `brew --version`; on a machine below the floor every `brew` invocation is blocked until `brew update && brew upgrade` clears it. Bypass `Allow brew-supply-chain bypass`. This is a distinct concern from auto-update (which owns `HOMEBREW_NO_AUTO_UPDATE`) — two single-purpose guards on `brew`, one per concern.

## Sparkle GUI-app auto-update OFF (macOS)

macOS GUI apps the fleet uses for tooling that self-update via the [Sparkle](https://sparkle-project.org/) framework (e.g. OrbStack, bundle `dev.kdrag0n.MacVirt`) must have auto-update disabled. A Sparkle install can swap a tool version under a running build or scan, and it rides the app's own update channel outside the soak gate. Set by `setup-security-tools`, audited in `check --all` (`scripts/fleet/check/sparkle-auto-update-is-disabled.mts`); both read `_shared/sparkle-auto-update.mts`. There's no PreToolUse guard: a GUI app self-updates with no Bash invocation to gate, so persist plus audit are the surfaces.

The disable writes two Sparkle prefs into the app's defaults domain — a user-level `defaults write` overrides the Info.plist default:

```sh
defaults write dev.kdrag0n.MacVirt SUAutomaticallyUpdate -bool false
defaults write dev.kdrag0n.MacVirt SUEnableAutomaticChecks -bool false
```

`SUEnableAutomaticChecks=false` stops the background update check; `SUAutomaticallyUpdate=false` stops silent install of a found update. Add a new Sparkle app by appending to `SPARKLE_APPS` in `_shared/sparkle-auto-update.mts` (id, name, bundle-id domain); the persist and audit pick it up automatically.

## Lint/fix scope: modified by default, `--all` for waves

`pnpm run lint` and `pnpm run fix` default to **modified scope** — only files
git sees as changed (plus `--staged` in pre-commit). A repo-wide autofix
campaign run that way is a **silent no-op on the whole backlog**: the run exits
green having fixed nothing outside your edits (two delegated wave runs reported
success while fixing zero backlog files, 2026-07-07). For a wave, pass `--all`:
`pnpm run lint --fix --all` (`pnpm run fix --all` forwards it and adds the
doctor). The `template/` tree is OFF the default lint surface everywhere —
in the wheelhouse it only lints under `LINT_DOGFOOD=1`, so a wave that must
reach canonical sources is `LINT_DOGFOOD=1 pnpm run lint --fix --all`. Every
scoped `--fix` run now ends with a loud reminder naming the wave form
(`fixScopeReminder` in `scripts/fleet/lint.mts`).

## Docs lead with pnpm

User-facing install commands in fenced code blocks must show the pnpm form first (`pnpm install <pkg>`, `pnpm add <pkg>`). npm / yarn fallbacks are fine but come after, or in a separate block introduced as a fallback. The pre-commit `scanDocsPnpmFirst` scanner emits a warning (not a hard fail) for `.md` / `.mdx` blocks that lead with npm or yarn without a pnpm leader. Suppress per-block with `socket-lint: allow pnpm-first` (HTML comment above the fence or any line inside it).

## New dependencies + soak

Every new dep added to `package.json` runs a Socket-score check at edit time. Low-scoring deps block (enforced by `.claude/hooks/fleet/check-new-deps/`). The 7-day `minimumReleaseAge` soak is malware protection. Never add to `pnpm-workspace.yaml` `minimumReleaseAge.exclude[]` (bypass `Allow soak-time bypass`, alias `Allow minimumReleaseAge bypass`, for emergency CVE patches; enforced by `.claude/hooks/fleet/minimum-release-age-guard/`).

Every per-package soak-bypass entry (the `'pkg@1.2.3'` exact-pin form) MUST carry a `# published: YYYY-MM-DD | removable: YYYY-MM-DD` annotation as the LAST comment line above the bullet. `published` is the version's npm publish date; `removable` is `published + 7d` so a periodic cleanup can drop entries that no longer need the bypass (enforced by `.claude/hooks/fleet/soak-exclude-date-guard/` at edit time + `scripts/fleet/check/soak-excludes-have-dates.mts` at commit time).

**Add a soak-bypass ONLY with the writer, never by hand:** `node scripts/fleet/soak-bypass.mts <pkg>@<version>`. It fetches the authoritative npm publish date, writes the dated `'name@version'` pin to `pnpm-workspace.yaml` (canonical — pnpm reads it directly), AND regenerates the name-only mirror block in `.npmrc` (for npm >= v12, which matches soak-excludes by NAME or glob only, no `@version` — [npm/cli#9532](https://github.com/npm/cli/pull/9532)), keeping both package managers in lockstep from one command. Hand-editing either the pnpm pin or the `.npmrc` mirror reddens `scripts/fleet/check/npmrc-versioned-soak-mirror-is-derived.mts` — that check is the code-as-law contract that the two files agree.

Vitest `include` globs must not match `node:test` files. Mismatched runners produce confusing "no test suite found" errors (enforced by `.claude/hooks/fleet/vitest-vs-node-test-guard/`).

## Bundler

`rolldown`, NOT `esbuild`. The fleet standardizes on rolldown for direct bundling (see `template/.config/rolldown/`). Transitive esbuild deps (e.g. via vitest) are unavoidable today. The rule is no _new direct_ esbuild use anywhere in the fleet.

## Compile-time defines (`INLINED_*`)

Build-inlined constants use the `process.env.INLINED_*` naming convention (mirrors socket-cli: `INLINED_VERSION`, `INLINED_NAME`, …). The `INLINED_` prefix flags at a glance that a value is substituted at build time, not read from the real environment at runtime.

Substitution is done by `template/.config/rolldown/define-guarded.mts` (`defineGuardedPlugin`), an esbuild-`define`-equivalent that only rewrites _read_ positions — it never touches assignment targets, `delete` / `++` / `--` operands, or dynamic `process.env[expr]` access (so `delete process.env.DEBUG` stays valid, unlike oxc's built-in `define`).

- **Source must use quoted bracket access**: `process.env['INLINED_EXTENSION_VERSION']`. `process.env` is an index-signature type, so TypeScript (TS4111) forbids dot access. The plugin normalizes dot and quoted-bracket access to the same dotted define key, so one `'process.env.INLINED_X'` key matches `process.env.INLINED_X`, `process.env['INLINED_X']`, and `process.env["INLINED_X"]`.
- **Define key is the dotted form**: `defineGuardedPlugin({ 'process.env.INLINED_X': JSON.stringify(value) })`. Values are already-quoted source text (same contract as esbuild / oxc `define`).
- **`magic-string` is the fallback**: `defineGuarded` does its surgical rewrites with MagicString. When the build opts into rolldown's `experimental.nativeMagicString` (set `experimental: { nativeMagicString: true }` + `output.sourcemap: true` in the rolldown config), the `transform` hook receives a Rust-backed native MagicString on `meta.magicString` — same API, no JS `toString()`/`generateMap()` round-trip — and the plugin uses it. Without the flag, `meta.magicString` is absent and it constructs a JS `magic-string` instance. So `magic-string` stays catalog-pinned (`pnpm-workspace.yaml`) and a member adopting the plugin keeps `"magic-string": "catalog:"` in devDependencies as the fallback path.

## Backward compatibility

FORBIDDEN to maintain. Remove when encountered.

## `packageManager` field

The fleet pins `packageManager` to a **forgiving floor**, `pnpm@>=<floor>` (currently `pnpm@>=11.0.5`), matching the `engines.pnpm` floor. `pnpm-workspace.yaml` sets `managePackageManagerVersions: false` plus `pmOnFail: warn`, so pnpm treats the field as a minimum hint rather than a version lock: it never switches pnpm versions and only warns on a mismatch. The exact pnpm for CI comes from the setup action (`external-tools.json`), not this field. `derivePins` (`sync-package-manager-pins.mts`) emits the floor from root `engines.pnpm`, and the cascade propagates both pins via `sync.mts package-manager --fleet`. A `packageManager` drift is always benign (`isBehindSource`) because the field is only a hint; the enforced gate is `engines.pnpm`.

pnpm 11 stores the integrity hash in `pnpm-lock.yaml` — a separate YAML document — rather than inline. The lockfile is the integrity source of truth, and a legacy `pnpm@<version>+sha512.<hex>` migrates on first install.

## Bumping a versioned tool fleet-wide (pnpm, zizmor, sfw)

**Entry point: `scripts/repo/cascade-fleet.mts`** — bumps one tool's pinned version and commits it. Run from the wheelhouse repo:

```bash
node scripts/repo/cascade-fleet.mts --pnpm 11.3.0 [--dry-run] [--self]
```

The bump stage (`pipeline-stages.mts#runBump` → `tools/<tool>.mts#applyToRegistry`) downloads every platform binary from upstream, recomputes sha256 ourselves (integrity = binary-download + own-checksum, never trust in upstream-published values), writes `external-tools.json`, and commits. Tools with a `sourceDir` override (node, npm) write the wheelhouse root instead (`.node-version` / `package.json` engines).

**Propagation is the sync-scaffolding cascade, not this script.** external-tools.json is a cascaded file — after a bump, run the cascade to fan it out to every member. The former registry-hosted reconcile / gate / propagate stages (which pinned members to a socket-registry SHA) were retired with the socket-registry shared-source model; fleet actions now live in each repo as `.github/actions/fleet/*`, referenced by local `./` path, so there is no cross-repo pin to rewrite. (`--skip-ci-wait` / `--ci-timeout` are vestigial no-ops from the retired gate stage.)

### Soak gate

The bump honors the 7-day `minimumReleaseAge` cooldown via `--soak-days <n>` (default 7). Pulling a same-day release requires explicit bypass. See `bypass-phrases.md` row `Allow soak-time bypass` (alias `Allow minimumReleaseAge bypass`).

## Monorepo internal `engines.node`

Only the workspace root needs `engines.node`. Private (`"private": true`) sub-packages in `packages/*` don't need their own `engines.node` field. The field is dead, drift-prone, and removing it is the cleaner play. Public-published sub-packages — the npm-published ones with no `"private": true` — keep their `engines.node` because external consumers see it.

## Config files in `.config/`

Place tool / test / build configs in `.config/`: `taze.config.mts`, `vitest.config.mts`, `esbuild.config.mts`, `tsconfig.base.json` — the abstract compiler-options layer, fleet-canonical, byte-identical across the fleet. New abstract configs go in `.config/` by default.

Repo root keeps only what _must_ be there: package manifests + lockfile (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`), the linter / formatter dotfiles whose tools require root placement (`.oxlintrc.json`, `.oxfmtrc.json`, `.npmrc`, `.gitignore`, `.node-version`), and every **concrete** tsconfig (`tsconfig.json`, `tsconfig.check.json`, `tsconfig.dts.json`, `tsconfig.test.json`, etc.; anything with `include`/`exclude`/`files`). Concrete tsconfigs live at the package root so tsc + IDE language-servers discover them natively at cwd. Burying them in `.config/` breaks the lookup. In monorepos the concrete `tsconfig.json` lives at each `packages/<pkg>/`. Concrete configs `extend` `./.config/tsconfig.base.json` (single-repo at root) or `../../.config/tsconfig.base.json` (monorepo per-package).

## Runners are `.mts`, not `.sh`

Every executable script (skill runner, hook handler, fleet automation) is TypeScript via `node <file>.mts`. Bash works on macOS/Linux but breaks on Windows. `bash` isn't on Windows PATH by default and `if [ ... ]` / `${VAR:-default}` aren't portable. The fleet runs on developer machines (mixed macOS / Linux / Windows / WSL) and CI (Linux), so cross-platform is a hard requirement. Use `@socketsecurity/lib/spawn` (`spawn`, `isSpawnError`) instead of `child_process`. It ships consistent error shapes (`SpawnError`), `stdioString: true` for buffered stdout, and integrates with the rest of the lib. Reach for `_shared/scripts/*.mts` for cross-skill helpers (default-branch resolution, report formatting); reach for `<skill>/run.mts` for skill-specific implementation. Reserve `.sh` for tiny one-shot snippets that have no Windows audience (e.g., a `bin/` wrapper). The `lib/` vs `scripts/` distinction matches `@socketsecurity/lib` (public, importable surface) vs per-package `scripts/` (private, internal automation). Skill helpers are internal, hence `scripts/`.

## Soak time

(pnpm-workspace.yaml `minimumReleaseAge`, default 7 days). Never add packages to `minimumReleaseAgeExclude` in CI. Locally, ASK before adding (security control), then add it with `node scripts/fleet/soak-bypass.mts <pkg>@<version>` (never by hand — see "New dependencies + soak" above for why: it keeps `pnpm-workspace.yaml` and `.npmrc` in lockstep).

## External repo clones

When reviewing or referencing an external GitHub repo (not a fleet member), clone it locally so an agent can read, search, and index it — rather than fetching through the GitHub web API.

### What

Clone to `~/.socket/_wheelhouse/repo-clones/<org>-<repo>/`, where `<org>-<repo>` is lowercase + dash-cased (e.g. `justrach-codedb`). Resolve the directory via `getSocketRepoClonesDir()` from `@socketsecurity/lib/paths/socket`. Never clone into `~/projects/` — that path is for fleet-member checkouts, and the fleet's sibling-walk tooling (cascade `--all`, fleet-roster discovery) would mistake a reference clone for a member repo.

### Why

Agents need a local tree to run `grep`/`read`/index operations efficiently. A standardized path keeps reference clones discoverable across sessions and safely isolated from the fleet-member space.

### How to apply

Clone the smallest practical way — blobless + shallow:

```bash
git clone --depth=1 --single-branch --filter=blob:none <url> <dest>
```

- `--depth=1` — no history.
- `--single-branch` — skip other refs.
- `--filter=blob:none` — blobless partial clone; file blobs fetched lazily on first access, so the initial download is tree-metadata only.

Treeless (`--filter=tree:0`) is smaller but refetches trees on every walk (slow, breaks offline) — blobless is the smallest-practical balance.

This is distinct from a submodule (nested, pinned-in-parent) and a worktree (second working dir of an existing local repo). A reference clone is a standalone checkout.

### Enforcement

`.claude/hooks/fleet/clone-reviewed-repo-nudge/` — nudges when reviewing an external repo with no local clone, and when a `git clone` of an external repo omits the smallest-practical flags.

## Upstream submodules: always shallow

Every entry in `.gitmodules` MUST set `shallow = true`. Every `git submodule update --init` call (postinstall.mts, CI, manual) MUST pass `--depth 1 --single-branch`. Upstream repos like yarnpkg/berry, oven-sh/bun, rust-lang/cargo are multi-GB with full history. We only ever need the pinned SHA's tree. A non-shallow init can take 30+ minutes and waste GB of disk on every fresh clone. There is no scenario where the fleet needs upstream submodule history.

## `npm-run-all2` + `node --run` opt-in

The fleet pins `npm-run-all2: 9.0.0` in the wheelhouse catalog. Every repo that depends on it MUST also declare the top-level `"npm-run-all2": { "nodeRun": true }` key in its own `package.json`. That key tells npm-run-all2 9.x to execute each script via `node --run` instead of the package manager CLI. `run-s build:*` and `run-p test:*` chains skip the per-script pnpm startup cost, which is non-trivial for N-script fan-outs. Inherited limitations from `node --run` (no `pre`/`post` lifecycle hooks; no `npm_*` env injection: `NODE_RUN_SCRIPT_NAME` + `NODE_RUN_PACKAGE_JSON_PATH` replace them; `node_modules/.bin` still on PATH) are acceptable for the fleet because none of our canonical scripts rely on those features. Enforced by `scripts/sync-scaffolding/checks/package-npm-run-all2-noderun.mts`: `npm_run_all2_node_run_missing` findings auto-fix.

## Backward compatibility (npm-run-all2)

FORBIDDEN to maintain. Remove when encountered.

## `-stable` self-import in tooling

A fleet repo that publishes `@socketsecurity/<X>` resolves the bare `@socketsecurity/<X>` specifier to its OWN local `src/` — the pnpm workspace link — which is work-in-progress and may be mid-edit or broken. Build scripts and git-hooks must run against a known-good PUBLISHED copy, so the fleet pins a `@socketsecurity/<X>-stable` catalog alias (`npm:@socketsecurity/<X>@<last-published>`). Tooling imports the `-stable` alias; only the package's own source consumers use the bare name.

Scope: files under `scripts/**` or `.claude/hooks/**` (test files exempt). The owned package name is read from the nearest ancestor `package.json` `name`. Only the repo's OWN package is flagged — e.g. in socket-lib, `@socketsecurity/lib/...` must become `@socketsecurity/lib-stable/...`, but `@socketsecurity/registry/...` is left alone (socket-lib doesn't own registry).

Bump the `-stable` alias in lockstep with the plain catalog pin on every release — they point at the same package, one tracking workspace/source the other the published snapshot.

**Why:** Past incident — socket-lib's git-hooks imported `@socketsecurity/lib/logger/default` (bare). In socket-lib that resolves to local `src/`; during a version straddle the `logger/default` subpath didn't exist in the working tree yet, so every commit threw `ERR_PACKAGE_PATH_NOT_EXPORTED`. The `-stable` alias would have resolved to the published package that already had the subpath.

Enforced by the fixable `socket/prefer-stable-self-import` oxlint rule (rewrites the package segment, preserving the subpath). The deterministic published-dependency surface for scripted/AI-driven tooling follows [Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) — generated edits build against a stable contract, not a moving local-src target.

## Docker runtime (macOS)

Repos with Dockerfile-based cross-builds (socket-btm's `glibc`/`musl`
node-smol images) need a local Docker engine. On macOS the recommended
runtime is **[OrbStack](https://docs.orbstack.dev/)** ([download](https://orbstack.dev/download)) —
a faster, lighter drop-in for Docker Desktop (lower memory, near-instant
start, native `docker` CLI compatibility). macOS-only; Linux dev hosts use
the distro's native Docker/Podman and don't need it. It's a recommended
dev convenience, not a build requirement — CI builds run on Linux runners
with native Docker, so OrbStack only affects local Mac iteration. Repos
that consume it pin it in their own `external-tools.json` (per-repo, not
template) and may wire a `brew install --cask orbstack` onboarding step.

## Local CI runs (`agent-ci`)

[`@redwoodjs/agent-ci`](https://agent-ci.dev/#quick-start) runs a repo's
GitHub Actions workflows locally in a Linux container (official runner
binary, bind-mounted deps for near-instant startup, pauses-on-failure for
debugging). Optional, local-dev only; needs a Docker runtime (see above).

**Run it through the fleet dlx, never raw `npx`** (the `NEVER npx` rule
applies — `@socketsecurity/lib/dlx/package`'s `dlxPackage` + `executePackage`
download + integrity-verify the pinned package through Socket Firewall):

```mts
import { dlxPackage, executePackage } from '@socketsecurity/lib/dlx/package'
// version resolves from the repo's external-tools.json `agent-ci` pin
```

**Limitations** ([compatibility](https://agent-ci.dev/compatibility)) — it
**skips reusable workflows** (`workflow_call`), has no GH-secret access, no
concurrency groups, and a simplified job-`if` evaluator. The fleet `ci.yml`
is self-contained: its jobs call local `./.github/actions/fleet/*` composite
actions (which agent-ci runs), never a cross-repo reusable workflow — so
agent-ci runs the full lint / type / test matrix. Repos that adopt it pin
the version in their own `external-tools.json`.

## npm 2FA registry ops

`npm deprecate` / `publish` / `access` / `owner` / `unpublish` / `dist-tag`
require a one-time password from an authenticator, and npm only prompts for
it on an **interactive TTY**. The `!` / headless channel has no TTY, so the
prompt is swallowed and the command dies with `EOTP`. Tell the user to run
the op in a **real terminal** where the prompt can appear; fall back to
`--otp=<code>` only when no TTY is available and the user supplies a fresh
code. Reminder hook: `.claude/hooks/fleet/npm-otp-flow-nudge/`.
