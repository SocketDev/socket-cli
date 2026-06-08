# Tooling

The CLAUDE.md `### Tooling` section is the short list. This file is the full set of rules and their rationale.

## Package manager

`pnpm`. Run scripts via `pnpm run foo --flag`, never `foo:bar`. After `package.json` edits, `pnpm install`.

## No `npx` / `dlx`

NEVER use `npx`, `pnpm dlx`, or `yarn dlx`. Use `pnpm exec <package>` or `pnpm run <script>` # socket-lint: allow npx

## Docs lead with pnpm

User-facing install commands in fenced code blocks must show the pnpm form first (`pnpm install <pkg>`, `pnpm add <pkg>`). npm / yarn fallbacks are fine but come after, or in a separate block introduced as a fallback. The pre-commit `scanDocsPnpmFirst` scanner emits a warning (not a hard fail) for `.md` / `.mdx` blocks that lead with npm or yarn without a pnpm leader. Suppress per-block with `socket-lint: allow pnpm-first` (HTML comment above the fence or any line inside it).

## New dependencies + soak

Every new dep added to `package.json` runs a Socket-score check at edit time. Low-scoring deps block (enforced by `.claude/hooks/fleet/check-new-deps/`). The 7-day `minimumReleaseAge` soak is malware protection. Never add to `pnpm-workspace.yaml` `minimumReleaseAge.exclude[]` (bypass `Allow soak-time bypass`, alias `Allow minimumReleaseAge bypass`, for emergency CVE patches; enforced by `.claude/hooks/fleet/minimum-release-age-guard/`).

Every per-package soak-bypass entry (the `'pkg@1.2.3'` exact-pin form) MUST carry a `# published: YYYY-MM-DD | removable: YYYY-MM-DD` annotation as the LAST comment line above the bullet. `published` is the version's npm publish date; `removable` is `published + 7d` so a periodic cleanup can drop entries that no longer need the bypass (enforced by `.claude/hooks/fleet/soak-exclude-date-guard/` at edit time + `scripts/fleet/check/soak-excludes-have-dates.mts` at commit time).

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

Bare `pnpm@<version>` is correct for pnpm 11+. pnpm 11 stores the integrity hash in `pnpm-lock.yaml` (separate YAML document) instead of inlining it in `packageManager`. On install pnpm rewrites the field to its bare form and migrates legacy inline hashes automatically. Don't fight the strip. Older repos may still ship `pnpm@<version>+sha512.<hex>`. Leave it; pnpm migrates on first install. The lockfile is the integrity source of truth.

## Bumping a versioned tool fleet-wide (pnpm, zizmor, sfw)

🚨 **Single entry point: `socket-wheelhouse/scripts/fleet/cascade-fleet.mts`.** Run from the wheelhouse repo:

```bash
node socket-wheelhouse/scripts/fleet/cascade-fleet.mts \
  --pnpm 11.3.0 \
  [--skip-ci-wait] \
  [--dry-run]
```

This is a four-stage orchestrator. Don't reach for any of the lower-level scripts directly unless one of the stages bailed and you're recovering:

| Stage | Does                                                                                                                                                                                                                                                                                                                                                                                                                       | Driven by                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| A     | Bumps `socket-registry/external-tools.json`: downloads every platform binary from upstream, recomputes sha256 ourselves (integrity model is binary-download + own-checksum, not trust in upstream-published values), writes the file. Commits to registry.                                                                                                                                                                 | `tools/pnpm.mts#applyToRegistry` (+ `zizmor.mts`, `sfw.mts`) |
| B     | Delegates to `socket-registry/scripts/cascade-workflows.mts`: recursively bumps every SHA pin in registry's own workflows (`setup-and-install` → `setup` → `checkout`), converging to a fixed point. Commits to registry.                                                                                                                                                                                                   | `pipeline.mts#stageB`                                        |
| C     | Pushes registry main; polls GitHub Actions for the cascade SHA's CI to land green. Aborts the whole cascade if registry CI fails. Fleet repos must not pin to a broken registry. Skipped via `--skip-ci-wait`.                                                                                                                                                                                                             | `pipeline.mts#stageC`                                        |
| D     | For every primary fleet checkout: runs `cleanup-stranded.mts --against <stageBSha>` (no-layering rule discards prior unpushed cascade commits), rewrites every `setup-and-install@<old-sha>` reference to the new registry SHA via diff-based pin matching, optionally runs the tool's per-fleet step (pnpm bumps `packageManager` + `engines.pnpm`), runs `pnpm run format` to fold pre-existing drift, commits + pushes. | `pipeline.mts#stageD`                                        |

### Soak gate

Stage A honors the 7-day `minimumReleaseAge` cooldown via `--soak-days <n>` (default 7). Pulling a same-day release requires explicit bypass. See `bypass-phrases.md` row `Allow soak-time bypass` (alias `Allow minimumReleaseAge bypass`).

### Recovery from an interrupted cascade

If Stage A+B+C landed (registry has a new tip) but Stage D didn't run, pass `--force-fanout` to skip Stages A+B+C and use the current registry HEAD as the propagation SHA. This is the only sanctioned way to "resume" a cascade. Manually invoking `cascade-workflows.mts` then `cascade-fleet.mts` without the resume flag would re-run Stages A+B+C and produce a no-op commit / extra runner minutes.

### What this does NOT do

- It does NOT bump `socket-wheelhouse/external-tools.json` (the wheelhouse's own at-repo-root copy, consumed by `scripts/install-sfw.mts`). The live source of truth for cascade purposes is `socket-registry/external-tools.json`. The wheelhouse file uses a different schema (tools nested under `.tools.<name>` with `sha256` field; registry uses top-level keys with `integrity` field) and a different consumer (the local SFW installer + zizmor setup). When SFW or zizmor bumps, the wheelhouse file's checksums go stale. Today refreshing them is manual (run `node scripts/update-external-tools.mts` from the wheelhouse repo). Wiring this into the cascade orchestrator is a known gap. For now, treat wheelhouse's external-tools.json as a "sibling source of truth" that needs its own update step after a tool bump.
- It does NOT bump `.node-version`. Node bumps follow a different cadence (the Node ecosystem doesn't ship the same per-platform binary model; `.node-version` is just a string).

## Monorepo internal `engines.node`

Only the workspace root needs `engines.node`. Private (`"private": true`) sub-packages in `packages/*` don't need their own `engines.node` field. The field is dead, drift-prone, and removing it is the cleaner play. Public-published sub-packages (the npm-published ones with no `"private": true`) keep their `engines.node` because external consumers see it.

## Config files in `.config/`

Place tool / test / build configs in `.config/`: `taze.config.mts`, `vitest.config.mts`, `tsconfig.base.json` (the abstract compiler-options layer, fleet-canonical, byte-identical across the fleet), `esbuild.config.mts`. New abstract configs go in `.config/` by default.

Repo root keeps only what _must_ be there: package manifests + lockfile (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`), the linter / formatter dotfiles whose tools require root placement (`.oxlintrc.json`, `.oxfmtrc.json`, `.npmrc`, `.gitignore`, `.node-version`), and every **concrete** tsconfig (`tsconfig.json`, `tsconfig.check.json`, `tsconfig.dts.json`, `tsconfig.test.json`, etc.; anything with `include`/`exclude`/`files`). Concrete tsconfigs live at the package root so tsc + IDE language-servers discover them natively at cwd. Burying them in `.config/` breaks the lookup. In monorepos the concrete `tsconfig.json` lives at each `packages/<pkg>/`. Concrete configs `extend` `./.config/tsconfig.base.json` (single-repo at root) or `../../.config/tsconfig.base.json` (monorepo per-package).

## Runners are `.mts`, not `.sh`

Every executable script (skill runner, hook handler, fleet automation) is TypeScript via `node <file>.mts`. Bash works on macOS/Linux but breaks on Windows. `bash` isn't on Windows PATH by default and `if [ ... ]` / `${VAR:-default}` aren't portable. The fleet runs on developer machines (mixed macOS / Linux / Windows / WSL) and CI (Linux), so cross-platform is a hard requirement. Use `@socketsecurity/lib/spawn` (`spawn`, `isSpawnError`) instead of `child_process`. It ships consistent error shapes (`SpawnError`), `stdioString: true` for buffered stdout, and integrates with the rest of the lib. Reach for `_shared/scripts/*.mts` for cross-skill helpers (default-branch resolution, report formatting); reach for `<skill>/run.mts` for skill-specific implementation. Reserve `.sh` for tiny one-shot snippets that have no Windows audience (e.g., a `bin/` wrapper). The `lib/` vs `scripts/` distinction matches `@socketsecurity/lib` (public, importable surface) vs per-package `scripts/` (private, internal automation). Skill helpers are internal, hence `scripts/`.

## Soak time

(pnpm-workspace.yaml `minimumReleaseAge`, default 7 days). Never add packages to `minimumReleaseAgeExclude` in CI. Locally, ASK before adding (security control).

## Upstream submodules: always shallow

Every entry in `.gitmodules` MUST set `shallow = true`. Every `git submodule update --init` call (postinstall.mts, CI, manual) MUST pass `--depth 1 --single-branch`. Upstream repos like yarnpkg/berry, oven-sh/bun, rust-lang/cargo are multi-GB with full history. We only ever need the pinned SHA's tree. A non-shallow init can take 30+ minutes and waste GB of disk on every fresh clone. There is no scenario where the fleet needs upstream submodule history.

## `npm-run-all2` + `node --run` opt-in

The fleet pins `npm-run-all2: 9.0.0` in the wheelhouse catalog. Every repo that depends on it MUST also declare the top-level `"npm-run-all2": { "nodeRun": true }` key in its own `package.json`. That key tells npm-run-all2 9.x to execute each script via `node --run` instead of the package manager CLI. `run-s build:*` and `run-p test:*` chains skip the per-script pnpm startup cost, which is non-trivial for N-script fan-outs. Inherited limitations from `node --run` (no `pre`/`post` lifecycle hooks; no `npm_*` env injection: `NODE_RUN_SCRIPT_NAME` + `NODE_RUN_PACKAGE_JSON_PATH` replace them; `node_modules/.bin` still on PATH) are acceptable for the fleet because none of our canonical scripts rely on those features. Enforced by `scripts/sync-scaffolding/checks/package-npm-run-all2-noderun.mts`: `npm_run_all2_node_run_missing` findings auto-fix.

## Backward compatibility

FORBIDDEN to maintain. Remove when encountered.

## `-stable` self-import in tooling

A fleet repo that publishes `@socketsecurity/<X>` resolves the bare `@socketsecurity/<X>` specifier to its OWN local `src/` (the pnpm workspace link), which is work-in-progress and may be mid-edit or broken. Build scripts and git-hooks must run against a known-good PUBLISHED copy, so the fleet pins a `@socketsecurity/<X>-stable` catalog alias (`npm:@socketsecurity/<X>@<last-published>`). Tooling imports the `-stable` alias; only the package's own source consumers use the bare name.

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
**skips reusable workflows** (so the fleet `ci.yml`'s
`SocketDev/socket-registry/.github/workflows/*` uses are skipped with a
warning), has no GH-secret access, no concurrency groups, and a simplified
job-`if` evaluator. Useful for the self-contained `ci.yml` jobs (lint /
type / test matrix), not the provenance/release reusable workflows. Repos
that adopt it pin the version in their own `external-tools.json`.

## npm 2FA registry ops

`npm deprecate` / `publish` / `access` / `owner` / `unpublish` / `dist-tag`
require a one-time password from an authenticator, and npm only prompts for
it on an **interactive TTY**. The `!` / headless channel has no TTY, so the
prompt is swallowed and the command dies with `EOTP`. Tell the user to run
the op in a **real terminal** where the prompt can appear; fall back to
`--otp=<code>` only when no TTY is available and the user supplies a fresh
code. Reminder hook: `.claude/hooks/fleet/npm-otp-flow-reminder/`.
