/**
 * @file Check --all step registry — path hygiene, lock-step refs, and the
 *   multi-ecosystem soak/dependency/trust-gate supply-chain surface. One of
 *   three domain-split siblings of check-steps.mts (the others: hooks-and-
 *   docs, release-and-docs); see that file for the assembled order.
 */

import { TSCONFIG_CHECK_PATH } from '../paths.mts'
import { run, type CheckStep } from './check-steps.mts'

export function buildPathsAndSupplyChainSteps(): CheckStep[] {
  return [
    // The only hook disable is the canonical "Allow <X> bypass" phrase. A
    // SOCKET_*_DISABLED env var / disabledEnvVar field / isHookDisabled() call
    // lets a session silently neuter a guard. The edit-time
    // no-env-kill-switch-guard blocks NEW ones; this full-scan complement fails
    // the gate if any hook file (index/README/test) still NAMES one — code,
    // comment, message, or doc. Back-catalog sweep: 2026-06-06.
    () => run('node', ['scripts/fleet/check/env-kill-switches-are-absent.mts']),
    // No INTERNAL / PRIVATE path (`.claude/plans|reports/…`, `socket-<repo>/.claude/…`,
    // `/Users/<name>/…`, `../socket-<repo>/…`) inside a SOURCE-code comment. The
    // edit-time no-private-path-in-source-guard + socket/no-private-path-in-source
    // block NEW ones; this full-scan complement fails the gate if any tracked
    // source file already carries one. Incident: a scaffolding-repo .claude/plans/
    // path leaked into a public napi-rs source comment.
    () => run('node', ['scripts/fleet/check/private-paths-are-absent.mts']),
    // Every `pnpm run <x>` that invokes `node <path>.mts` must resolve to a real
    // file — a renamed/deleted script leaves the package.json entry (and the
    // CANONICAL_SCRIPT_BODIES synthesizer source) dead, failing only when someone
    // runs it. Past incident (2026-06-06): a check rename left doctor:auth
    // pointing at a deleted file and no gate caught it.
    () => run('node', ['scripts/fleet/check/script-paths-resolve.mts']),
    // Root `scripts/` is a namespace only: fleet and repo automation must
    // declare ownership by living below scripts/fleet/ or scripts/repo/.
    () => run('node', ['scripts/fleet/check/root-scripts-are-segregated.mts']),
    // Windows-portability classes (unshelled .cmd spawns, URL .pathname as a
    // filesystem path, hand-rolled platform literals) — each shipped a real
    // windows-only CI failure that failed OPEN (the bump-order pre-release
    // gate silently vanished on windows for the guard's whole life). Ratchets
    // down from the introduction baseline. docs/agents.md/fleet/windows-gotchas.md
    () => run('node', ['scripts/fleet/check/source-is-windows-portable.mts']),
    // Sibling of script-paths-resolve for prose: every `node <script>` reference
    // in a SKILL.md or command .md must resolve to a real file — a renamed/moved
    // script leaves the doc instruction dead. Past incident (2026-06-06):
    // setup-repo/SKILL.md cited 3 setup scripts that didn't exist.
    () => run('node', ['scripts/fleet/check/doc-references-resolve.mts']),
    // Sibling of doc-references-resolve for the `pnpm run` surface those two skip:
    // every `pnpm run <name>` a SKILL.md / reference.md / command .md cites must
    // resolve to a real package.json script (exact, or a `*`/`:`-prefix match), so
    // a renamed/dropped script can't leave a dead `pnpm run` citation shipping
    // fleet-wide. Skips `allowed-tools:` frontmatter (Bash() permission globs).
    () => run('node', ['scripts/fleet/check/pnpm-run-citations-resolve.mts']),
    // A package's `exports` map and its public file surface must agree: every
    // exports target resolves to a real file (no stale map entry that throws
    // ERR_MODULE_NOT_FOUND for consumers), and every public built file (privacy
    // taxonomy applied — not external/, not _-prefixed) is reachable through some
    // exports entry (no orphaned public module). Complements files[] allowlist
    // hygiene and runtime require-ability; this is the map ↔ files check.
    () => run('node', ['scripts/fleet/check/public-files-are-exported.mts']),
    // Every external-tools.json / bundle-tools.json must match the shared
    // TypeBox schema (scripts/fleet/lib/external-tools-schema.mts). These files
    // pin tool versions + integrities; an unvalidated shape drift surfaces only
    // at runtime as an undefined-at-runtime throw mid-build/install. Past
    // incident: a drifted tool entry left an INLINED_* env var empty and hung a
    // pre-commit test run.
    () => run('node', ['scripts/fleet/check/external-tools-are-valid.mts']),
    // Fail-closed telemetry scan: no dependency or external tool ships a telemetry
    // / analytics SDK (Sentry/PostHog/Segment/Datadog/OTEL-SDK/langfuse/…) that
    // isn't in the reviewed baseline. A dep update or a new tool that ADDS one is
    // caught here and forced through review. Pairs with update.mts (re-checks on
    // every software update) + the per-tool lockdown gates (e.g. headroom).
    () => run('node', ['scripts/fleet/check/telemetry-deps-are-reviewed.mts']),
    // The universal no-phone-home env (FLEET_ENV) is set in this environment —
    // telemetry + update-notifier opt-outs across npm/pnpm/Claude Code. Deployed
    // by setup-security-tools (dev shell-rc) + the reusable CI workflow env.
    () => run('node', ['scripts/fleet/check/telemetry-env-is-disabled.mts']),
    // Internal GitHub Action / reusable-workflow SHA pins are current w.r.t. their
    // CLOSURE — the pinned unit's own files PLUS its declared `# cascade-data-deps:`
    // (e.g. external-tools.json read via ${GITHUB_ACTION_PATH}/../…). A data-edge
    // change once invalidated a pinned pnpm version with no `uses:` line to catch
    // it, reddening fleet CI. No-ops where there are no internal pins (the
    // wheelhouse, pure consumers); also fails any escaping read missing a
    // `# cascade-data-deps:` declaration.
    () => run('node', ['scripts/fleet/check/action-pins-are-current.mts']),
    // Every .gitmodules submodule is sparse-checkout'd to its consumed subtree
    // or annotated `# full-checkout: <reason>`. A vendored upstream drags its
    // whole tree into every clone otherwise. Determination is the
    // optimizing-submodules skill; this gate keeps the result from regressing.
    () =>
      run('node', [
        'scripts/fleet/check/submodules-are-sparse-or-annotated.mts',
        '--quiet',
      ]),
    // Every top-level `upstream/<name>` reference submodule is shallow
    // single-branch (`shallow = true` + `branch = <ref>`) so a clone pulls only
    // the tracked branch tip, not full history. Complements the sparse gate
    // above (which owns nested subtree-consumed submodules). See
    // docs/agents.md/fleet/upstream-references.md.
    () =>
      run('node', [
        'scripts/fleet/check/upstream-submodules-are-shallow-single-branch.mts',
        '--quiet',
      ]),
    // Companion: every sparse submodule declares a `verify =` consumer (the
    // command that build-proves the pattern) or `verify = none` (reference-only).
    // A sparse pattern with no declared consumer is unproven — the verify is
    // run separately (heavy: clone + build) via verify-submodule-sparse --run.
    () => run('node', ['scripts/fleet/verify-submodule-sparse.mts', '--check']),
    // researching-recency SKILL.md must quote the engine's output markers
    // verbatim (badge, evidence envelope, footer fences) so the model's
    // pass-through/synthesis instructions match what the engine emits.
    () =>
      run('node', [
        'scripts/fleet/check/researching-recency-contract-is-current.mts',
      ]),
    // `.mcp.json` is the one committed server inventory. Codex and OpenCode
    // consume generated project-local projections; this gate catches a manual
    // edit, missing adapter, or credential-bearing canonical config before the
    // MCP surfaces silently diverge across agent clients.
    () =>
      run('node', ['scripts/fleet/check/mcp-client-configs-are-current.mts']),
    // Invoke tsc through node directly (typescript is a root devDep, so the bin
    // is always linked at the repo root). Going through `pnpm exec` would prepend
    // pnpm's verify-deps-before-run + prepare preamble and the sfw firewall line;
    // tsc is silent on success, so that preamble would be the ONLY output and a
    // green run reads as "nothing happened" — the diagnostics get buried.
    () =>
      run('node', [
        'node_modules/typescript/bin/tsc',
        '--noEmit',
        '-p',
        TSCONFIG_CHECK_PATH,
      ]),
    // Path-hygiene check (1 path, 1 reference). Mantra-driven gate;
    // see .claude/skills/path-guard/ + .claude/hooks/fleet/path-guard/.
    () =>
      run('node', ['scripts/fleet/check/paths-are-canonical.mts', '--quiet']),
    // Separator-sensitive ops on un-normalized path vars — the commit-time
    // belt for the trees oxlint doesn't reach (live hooks); the AST rule
    // socket/normalize-path-before-match is the write-time twin. Backlog
    // cleared to zero 2026-07-07; any finding here is a regression.
    () =>
      run('node', [
        'scripts/fleet/check/paths-are-normalized-before-match.mts',
        '--quiet',
      ]),
    // Lock-step reference hygiene. Opt-in gate that exits clean when the
    // repo-owned .config/repo/lock-step-refs.json (legacy top-level
    // .config/lock-step-refs.json) is absent; for repos that ship
    // cross-language ports (acorn quadruplet, socket-btm mcp/*.cpp),
    // it validates every `Lock-step with <Lang>: <path>` comment resolves
    // to an existing file. Forms documented in
    // docs/agents.md/fleet/parser-comments.md §5–6.
    () =>
      run('node', [
        'scripts/fleet/check/lock-step-refs-resolve.mts',
        '--quiet',
      ]),
    // Lock-step header byte-equality. Same opt-in. Where the path-refs
    // gate above catches stale REFERENCES, this one catches drift in the
    // top-of-file `BEGIN LOCK-STEP HEADER` / `END LOCK-STEP HEADER` block
    // — the intent tripwire across the quadruplet. Spec:
    // docs/agents.md/fleet/parser-comments.md §7.
    () =>
      run('node', [
        'scripts/fleet/check/lock-step-headers-match.mts',
        '--quiet',
      ]),
    // Soak-window parity: the ONE soak value (SOAK_DAYS) must match every
    // surface that can't import it — pnpm-workspace.yaml `minimumReleaseAge`
    // (minutes) and `.npmrc` `min-release-age` (days). taze's config imports
    // SOAK_DAYS directly, so it can't drift; this catches a hand-edited data file.
    () => run('node', ['scripts/fleet/check/soak-time-is-consistent.mts']),
    // Fail-closed Go soak gate: every own go.mod require (bar a GO_SOAK_EXCLUDES
    // entry) must pin a version published >= SOAK_DAYS ago, verified against the
    // GOPROXY publish time. Go has no native min-release-age, so this IS the
    // enforcement — a fresh dep fails the gate. No-op where there's no go.mod.
    () => run('node', ['scripts/fleet/check/go-deps-are-soaked.mts']),
    // Cargo soak-config parity: every repo must carry the canonical
    // .cargo/config.toml (min-publish-age = SOAK_DAYS days, resolver deny) — it
    // cascades unconditionally, so this parity check runs unconditionally too.
    // A repo with an own Cargo.toml must ALSO carry a committed Cargo.lock — the
    // unstable keys are inert on stable cargo, so the lock is the build-time
    // enforcement and the nightly updater is the only thing that moves it.
    () => run('node', ['scripts/fleet/check/cargo-soak-config-is-current.mts']),
    // Brew install pinning: an enrolled repo (repo-root Brewfile present — the
    // opt-in signal; doctor --fix generates it) must keep that Brewfile in sync
    // with its real `.github/` install sites, every tap pin aged >= SOAK_DAYS
    // (one soaked tap SHA soaks every formula in it), and no bare `brew install`
    // outside the pinned-bundle path. No-op without a Brewfile, so an unenrolled
    // member never reddens.
    () => run('node', ['scripts/fleet/check/brew-install-is-pinned.mts']),
    // Soak-exclude date-annotation gate — pairs with
    // .claude/hooks/fleet/soak-exclude-date-guard/. Catches
    // pnpm-workspace.yaml `minimumReleaseAgeExclude` entries that landed
    // via non-Claude paths without the canonical
    // `# published: YYYY-MM-DD | removable: YYYY-MM-DD` annotation.
    () => run('node', ['scripts/fleet/check/soak-excludes-have-dates.mts']),
    // .npmrc's Socket soak-exclude block is DERIVED from SOCKET_PACKAGE_PATTERNS
    // (the one source), never hand-copied. Fails on drift; the cascade --fixes it.
    () =>
      run('node', [
        'scripts/fleet/check/npmrc-socket-soak-excludes-are-derived.mts',
      ]),
    // Fleet soak-exclude parity. Wheelhouse-only at runtime — the script
    // no-ops when `scripts/sync-scaffolding/manifest.mts` is absent (i.e.
    // in every cascaded fleet repo). Enforces that every versioned soak
    // entry in wheelhouse's own pnpm-workspace.yaml also lives in
    // `EXPECTED_RELEASE_AGE_EXCLUDE`. Without parity, the cascade omits
    // these entries from downstream repos and every fleet `pnpm install`
    // rejects the transitive dep. Past incident (cascade@4ec6212c):
    // @oxc-project/types@0.133.0 was in wheelhouse's soak block but not
    // EXPECTED_RELEASE_AGE_EXCLUDE — every fleet repo went red on the
    // next install.
    () => run('node', ['scripts/fleet/check/fleet-soak-exclude-parity.mts']),
    // Every `-stable` catalog alias must pin the same version as its floating
    // base entry (`@socketsecurity/lib-stable` → `@socketsecurity/lib`).
    // "Update a Socket package = update its -stable alias too." A desync means
    // imports of the `-stable` surface resolve an older build than the catalog
    // ships. Scans both the live workspace + the fleet catalog source.
    () => run('node', ['scripts/fleet/check/stable-aliases-match-base.mts']),
    // Baseline catalog coverage. Wheelhouse-only (no-ops where the
    // sync-scaffolding manifest is absent). Every `catalog:` dep the fleet
    // package.json baseline (CANONICAL_CATALOG_DEPS) writes onto a member must be
    // a key of EXPECTED_CATALOG_ENTRIES or OPTIONAL_CATALOG_ENTRIES — otherwise
    // the cascade writes the member a `"<dep>": "catalog:"` ref with no catalog
    // entry and its `pnpm install` dies with ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC
    // (hit on socket-mcp + socket-registry: @types/semver et al.). Pairs with the
    // catalog injector in checks/workspace-config-catalog.mts.
    () =>
      run('node', [
        'scripts/fleet/check/baseline-catalog-deps-are-covered.mts',
      ]),
    // Every static bare-specifier import in a .claude/hooks/{fleet,repo} file
    // must resolve to a package.json dependencies/devDependencies entry — the
    // general form of the baseline-catalog-deps-are-covered incident above
    // (check-new-deps imported two -stable packages the root package.json never
    // declared, so every member installed a hook whose imports weren't on disk).
    () => run('node', ['scripts/fleet/check/hook-imports-are-declared.mts']),
    // Every pnpm `patchedDependencies` entry is justified: a rationale comment,
    // an existing .patch file, and a corresponding `overrides:` force pin. A
    // patch is opaque + high-trust; an unannotated or force-less one is suspect.
    // See docs/agents.md/fleet/pnpm-patching.md (the patch-for-compat dedup lever).
    () => run('node', ['scripts/fleet/check/dedup-patches-are-justified.mts']),
    // Avoidable dependency duplication (CLAUDE.md dedup discipline). Parses
    // pnpm-lock.yaml and reports packages resolved at >1 major (collapse
    // candidates — informational) and any package carrying a known
    // @socketregistry hardened drop-in that isn't redirected via overrides:
    // (a free hardening + dedup win — hard failure). The code-as-law surface
    // the deduping-dependencies skill cites; the safe-collapse judgment stays
    // in the skill's decision tree.
    () => run('node', ['scripts/fleet/check/dependencies-are-deduped.mts']),
    // Every fleet/repo CLI entrypoint must FAIL SOFT (use runMain / a .catch),
    // never crash the user with a raw unhandled-rejection stack trace.
    () => run('node', ['scripts/fleet/check/entry-scripts-are-fail-soft.mts']),
    // No package.json may use a `link:` protocol dependency — non-portable,
    // outside the lockfile integrity guarantees, breaks the zero-dep bundle
    // contract. Use workspace: (in-repo) or catalog: (centrally pinned).
    () =>
      run('node', [
        'scripts/fleet/check/package-deps-have-no-link-protocol.mts',
      ]),
    // Per-platform tail packages match their naming domain: binaries (bin/
    // payload) use pnpm pack-app triplets (linux-x64, glibc unsuffixed); ABI/
    // NAPI .node addons use napi-rs targets (linux-x64-gnu, ABI explicit). The
    // payload shape decides the domain; a mismatched suffix makes the artifact
    // kind illegible to loaders + allowlists.
    () =>
      run('node', [
        'scripts/fleet/check/platform-tails-match-naming-domain.mts',
      ]),
    // Whole-tree BYTE-size cap (2 MB/file) — catches an accidentally committed
    // binary / data dump / build artifact. Distinct from socket/max-file-lines
    // (per-file LINE count for source). Skips build/cache/vendor dirs.
    () =>
      run('node', [
        'scripts/fleet/check/tracked-files-are-within-size-cap.mts',
      ]),
    // Commit-time twin of cdn-allowlist-guard: no source line references a host
    // off the public-CDN/registry allowlist (catches a bare CDN domain the
    // edit-time guard's fetch-attached detection misses).
    () => run('node', ['scripts/fleet/check/cdn-allowlist-is-respected.mts']),
    // Commit-time twin of package-manager-auto-update-guard: every installed
    // package manager has auto-update disabled (no silent self-bump).
    () =>
      run('node', [
        'scripts/fleet/check/package-manager-auto-update-is-disabled.mts',
      ]),
    // No _shared/ module shared across fleet trees has been re-forked (drift in a
    // cross-tree shared helper). The commit-time gate behind the DRY invariant.
    () => run('node', ['scripts/fleet/check/scanner-parity.mts']),
    // Supply-chain trust-gate floors + the pnpm trust-expansion opt-out, for
    // the non-Claude edit path. Mirrors the trust-downgrade-guard +
    // npmrc-trust-optout-guard hooks (shared detection via
    // _shared/{trust-gates,npmrc-trust}.mts): asserts pnpm-workspace.yaml keeps
    // minimumReleaseAge >= 10080 / trustPolicy: no-downgrade / blockExoticSubdeps:
    // true, and that no tracked script/workflow/.npmrc sets
    // PNPM_CONFIG_NPMRC_AUTH_FILE / a repo-local NPM_CONFIG_USERCONFIG or a
    // `${ENV}` beside an auth/registry key.
    () => run('node', ['scripts/fleet/check/trust-gates-are-not-weakened.mts']),
    // Homebrew supply-chain posture (macOS). Asserts brew >= 6.0.0 with
    // tap-trust + cask-SHA enforcement; `absent` (no brew) is a pass — CI
    // runners lack brew. Shares detection with the brew-supply-chain-guard
    // hook + setup-security-tools via _shared/brew-supply-chain.mts.
    () =>
      run('node', ['scripts/fleet/check/brew-supply-chain-is-hardened.mts']),
    // Sparkle GUI-app auto-update OFF (macOS). Asserts apps that self-update via
    // Sparkle (e.g. OrbStack, bundle dev.kdrag0n.MacVirt) have SUEnableAutomatic-
    // Checks + SUAutomaticallyUpdate set false; `absent` (not installed / not
    // macOS) is a pass. Shares detection with setup-security-tools via
    // _shared/sparkle-auto-update.mts. No guard twin — a GUI app self-updates
    // with no Bash invocation to gate, so persist + audit are the surfaces.
    () =>
      run('node', ['scripts/fleet/check/sparkle-auto-update-is-disabled.mts']),
    // uv (Python) reproducibility: every pyproject.toml with a [tool.uv] table
    // ships a hash-verified uv.lock + an exclude-newer soak pin (the Python
    // analog of pnpm --frozen-lockfile + minimumReleaseAge). Vacuous pass in
    // repos with no uv project. Shares policy with _shared/uv-config.mts.
    () => run('node', ['scripts/fleet/check/uv-lockfiles-are-current.mts']),
    // Every fleet-managed tool resolved on PATH (pnpm vs engines.pnpm, uv vs its
    // external-tools pin) is at or above its pinned floor. A stray older binary
    // winning PATH resolution — a Homebrew uv, a corepack pnpm — silently breaks
    // the cascade (a sub-engines.pnpm pnpm churns the catalog against an
    // un-refreshable lockfile). Skips absent tools; fails loud on below-floor.
    () =>
      run('node', ['scripts/fleet/check/path-tools-are-at-pinned-version.mts']),
    // A `pnpm` shim can select a different `node` for `pnpm exec` than the
    // fleet process. Catch that runtime split before it changes test semantics.
    () =>
      run('node', [
        'scripts/fleet/check/package-manager-node-is-continuous.mts',
      ]),
    // SkillSpector pin agrees across all three records (external-tools.json
    // version ⇔ pyproject.toml rev ⇔ uv.lock resolved SHA). The locked uv
    // project can't drift from the fleet-canonical SHA. Vacuous in repos that
    // don't ship SkillSpector.
    () =>
      run('node', ['scripts/fleet/check/skillspector-pin-is-consistent.mts']),
    // headroom-ai pin agrees across all three records (external-tools.json
    // version ⇔ pyproject.toml ==pin ⇔ uv.lock resolved version). The locked uv
    // project (installed _dlx-contained) can't drift from the fleet-canonical
    // version. Vacuous in repos that don't ship headroom.
    () => run('node', ['scripts/fleet/check/headroom-pin-is-consistent.mts']),
    // headroom's telemetry beacon (default-ON) + its HuggingFace model fetch are
    // forced OFF by the bin/headroom lockdown wrapper. This gate imports the typed
    // lockdown export (no source-sniffing) and fails if it's weakened — the lib
    // also throws at import (fail-closed).
    () =>
      run('node', [
        'scripts/fleet/check/headroom-is-telemetry-locked-down.mts',
      ]),
    // The headroom proxy MUST start with --lossless. Its default `token` mode is
    // LOSSY (CCR + Kompress ML abbreviate content, garbling proper nouns like
    // paths / package names in large tool reads — silently wrong for a coding
    // agent). Fails if PROXY_ARGS in headroom-proxy-start drops the flag.
    () => run('node', ['scripts/fleet/check/headroom-proxy-is-lossless.mts']),
    // pnpm-lock.yaml resolves vite rolldown-native (8.x) with no esbuild —
    // the fleet bundler is rolldown, esbuild is banned. A vitest repo whose
    // transitive vite floats to 7.x drags esbuild in (noisy Dependabot
    // advisories); this fails the cascade until vite is pinned to 8.x.
    () => run('node', ['scripts/fleet/check/vite-is-rolldown-native.mts']),
  ]
}
