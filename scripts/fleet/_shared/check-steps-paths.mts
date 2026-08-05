/**
 * @file Check --all step registry — path hygiene, lock-step refs, and the
 *   multi-ecosystem soak/dependency/trust-gate supply-chain surface. One of
 *   three domain-split siblings of check-steps.mts (the others: hooks-and-
 *   docs, release-and-docs); see that file for the assembled order.
 */

import { TSCONFIG_CHECK_PATH } from '../paths.mts'
import { releaseStep, run } from './check-steps.mts'
import type { CheckStep } from './check-steps.mts'

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
    // `/Users/<user>/…`, `../socket-<repo>/…`) inside a SOURCE-code comment. The
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
    // A managed file's relative imports must be managed too. The cascade ships
    // only what a manifest list names, so a managed file importing an unmanaged
    // sibling delivers a module whose import target never arrives. Past incident:
    // the conditional vitest group shipped `.config/repo/vitest.config.mts`
    // without the `./vitest.settings.mts` it imports, and every member's suite
    // died before a single test ran.
    () =>
      run('node', ['scripts/fleet/check/managed-file-imports-are-managed.mts']),
    // Root `scripts/` is a namespace only: fleet and repo automation must
    // declare ownership by living below scripts/fleet/ or scripts/repo/.
    () => run('node', ['scripts/fleet/check/root-scripts-are-segregated.mts']),
    // The repo ROOT is a namespace too: every tracked root entry is a
    // sanctioned tool-anchored name / tier dir, or carries a documented
    // per-repo allowlist reason (.config/repo/root-files.json). The legacy
    // root bootstrap/ + external-tools.json spread fleet-wide exactly because
    // no gate owned the root; this is that gate.
    () => run('node', ['scripts/fleet/check/root-files-are-sanctioned.mts']),
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
    // Sibling of doc-references-resolve for the docs/ tree: every repo-path
    // shaped citation in CLAUDE.md / README.md / docs/**.md must exist in the
    // working tree. The 2026-07-28 fleet audit's worst findings were release
    // and architecture docs whose every named script was fiction. Report-mode
    // until the fleet backlog burns down (member-ci rollout pattern).
    () => run('node', ['scripts/fleet/check/docs-file-references-resolve.mts']),
    // Playwright launches must go through the sanctioned npm session module
    // (publish-infra/npm/browser-session.mts): no sandbox flags, no bare
    // chromium.launch, persistent context only. The 2026-07-29 sign-in-loop
    // incident: a hand-rolled bootstrap mixed real- and mock-keychain cookie
    // state in the shared profile and every post-OTP session evaporated.
    () =>
      run('node', [
        'scripts/fleet/check/playwright-launches-are-sanctioned.mts',
      ]),
    // Sibling of the two above for the skill-NAME surface: every command that
    // delegates in prose ("Run the `<name>` skill") must name a real
    // .claude/skills/**/<name>/SKILL.md, so a renamed/moved skill can't leave a
    // command pointing at nothing.
    () => run('node', ['scripts/fleet/check/skill-delegations-resolve.mts']),
    // Dead-code gate: a fleet member is a SIBLING repo, never a wheelhouse
    // subdir. A root dir matching a roster member name is a stray scaffold
    // someone left in-tree, a full fleet-scaffold copy, that gets swept into
    // cascade commits — fail loud so it's removed, not gitignored.
    () => run('node', ['scripts/fleet/check/member-dirs-are-not-nested.mts']),
    // Sibling stray-dir gate: pnpm reads any dir holding `node_modules/` as a
    // workspace importer, so one sitting above a workspace glob with no
    // package.json beside it takes EVERY `pnpm run <script>` down with
    // ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND. Incident: a fleet script anchored its
    // cache at a template/base/** file and wrote template/base/node_modules/.
    () =>
      run('node', [
        'scripts/fleet/check/workspace-importers-have-manifests.mts',
      ]),
    // A package's `exports` map and its public file surface must agree: every
    // exports target resolves to a real file (no stale map entry that throws
    // ERR_MODULE_NOT_FOUND for consumers), and every public built file (privacy
    // taxonomy applied — not external/, not _-prefixed) is reachable through some
    // exports entry, no orphaned public module. Complements files[] allowlist
    // hygiene and runtime require-ability; this is the map ↔ files check.
    () => run('node', ['scripts/fleet/check/public-files-are-exported.mts']),
    // Every external-tools.json / bundle-tools.json must match the shared
    // TypeBox schema (scripts/fleet/lib/external-tools-schema.mts). These files
    // pin tool versions + integrities; an unvalidated shape drift surfaces only
    // at runtime as an undefined-at-runtime throw mid-build/install. Past
    // incident: a drifted tool entry left an INLINED_* env var empty and hung a
    // pre-commit test run.
    () => run('node', ['scripts/fleet/check/external-tools-are-valid.mts']),
    // Brand marks under assets/ follow the canonical
    // <repo>-<mark>[-light|-dark].<svg|png> grammar (mark ∈ combomark | favicon |
    // logomark | wordmark). Conditional: a repo with no brand/ dir vacuous-passes;
    // the gate bites the moment marks land, so a stray logo.svg or wrong-repo
    // prefix can't drift the README/asset-dirs references that resolve those names.
    () =>
      run('node', [
        'scripts/fleet/check/brand-assets-are-canonically-named.mts',
      ]),
    // Fail-closed telemetry scan: no dependency or external tool ships a telemetry
    // / analytics SDK (Sentry/PostHog/Segment/Datadog/OTEL-SDK/langfuse/…) that
    // isn't in the reviewed baseline. A dep update or a new tool that ADDS one is
    // caught here and forced through review. Pairs with update.mts (re-checks on
    // every software update) + the per-tool lockdown gates (e.g. headroom).
    () => run('node', ['scripts/fleet/check/telemetry-deps-are-reviewed.mts']),
    // The universal no-phone-home env (FLEET_ENV) is set in this environment —
    // telemetry + update-notifier opt-outs across npm/pnpm/Claude Code. Deployed
    // by setup-security-tools, dev shell-rc + the reusable CI workflow env.
    () => run('node', ['scripts/fleet/check/telemetry-env-is-disabled.mts']),
    // Any workflow that opts into the no-phone-home env (its top-level `env:`
    // sets ANY FLEET_ENV knob) MUST carry the COMPLETE list — so a new knob
    // added to ci.yml can't silently miss a sibling workflow (github-release.yml).
    () =>
      run('node', [
        'scripts/fleet/check/workflow-envs-have-full-fleet-env.mts',
      ]),
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

    // A submodule reference lives at the repo-root upstream/<name> home and
    // nowhere else; pre-law nests ride the script-owned submoduleRoots
    // ratchet.
    () =>
      run('node', [
        'scripts/fleet/check/submodules-are-rooted-in-upstream.mts',
      ]), // Every top-level `upstream/<name>` reference submodule is shallow
    // single-branch (`shallow = true` + `branch = <ref>`) so a clone pulls only
    // the tracked branch tip, not full history. Complements the sparse gate
    // above, which owns nested subtree-consumed submodules. See
    // docs/agents.md/fleet/upstream-references.md.
    () =>
      run('node', [
        'scripts/fleet/check/upstream-submodules-are-shallow-single-branch.mts',
        '--quiet',
      ]),
    // Fleet policy: an `upstream/<name>` reference pins the latest RELEASE TAG
    // (immutable), not a moving branch (`main`/`releases/v6`). Fails unless the
    // branch is a `<major>.<minor>` tag or the block is annotated
    // `# no-release-tag: <reason>`, upstream has no releases. See
    // docs/agents.md/fleet/upstream-references.md.
    () =>
      run('node', [
        'scripts/fleet/check/upstream-submodules-are-release-tagged.mts',
      ]),
    // Fleet-canonical check over each repo's repo-local
    // scripts/repo/upstream-contracts.mts: the materialized submodule HEAD
    // matches contract.revision + required paths/fixture exist. No-ops without
    // that file; fail-open when a submodule isn't materialized. The contract is
    // tracked repo DATA and lives under scripts/repo/ (never under the ignored
    // upstream/ tree). See docs/agents.md/fleet/upstream-references.md.
    () =>
      run('node', ['scripts/fleet/check/upstream-contracts-are-current.mts']),
    // The composite → upstream PORT MAP is total (every .github/actions/fleet/*
    // composite declares what it ports — `[]` for a Socket-original), every
    // declared port has a release-tagged + sha256-stamped upstream/ reference
    // block, and `portedAt` equals the pinned tag — so a vendor-actions re-pin
    // without a re-port review goes red. THE lock-step gate for inlined
    // third-party actions. See docs/agents.md/fleet/upstream-references.md.
    () =>
      run('node', ['scripts/fleet/check/action-ports-are-lock-stepped.mts']),
    // Sibling gate on the same pins: an alias tag (`v4`, `main`) that upstream
    // MOVES must not be recorded as if it were immutable, or the recorded pin
    // stops reaching the commit it names.
    () =>
      run('node', [
        'scripts/fleet/check/github-action-aliases-are-not-frozen.mts',
      ]),
    // The canonical GH Actions allowlist (auditing-gha CANONICAL_PATTERNS)
    // matches the template's workflow surface in BOTH directions: every
    // cascaded template/base `uses:` is pattern-covered — GitHub validates
    // selected-actions at plan time, so a miss startup-fails every
    // strict-allowlist repo's scheduled runs with 0 jobs (incident
    // 2026-07-21: gh-aw cascaded actions/create-github-app-token into
    // weekly-update.lock.yml with no canonical pattern) — and every canonical
    // entry has a live consumer, in-template or declared external.
    () =>
      run('node', [
        'scripts/fleet/check/gha-allowlist-matches-template-uses.mts',
      ]),
    // Belt: no `upstream/` reference is git-tracked as a gitlink — the
    // `.gitmodules` `ref`+`sha256:` is the pin, so a `160000` index entry is a
    // redundant copy. Write-time twin: no-upstream-gitlink-guard. See
    // docs/agents.md/fleet/upstream-references.md.
    () =>
      run('node', [
        'scripts/fleet/check/upstream-gitlinks-are-absent.mts',
        '--quiet',
      ]),
    // Belt: every copyleft upstream present as a submodule is a TESTS-ONLY
    // slice — no widened sparse cone, no materialized implementation file, no
    // tracked file citing it as a derivation source. A copyleft project may be
    // run and observed via its own tests; reading its implementation makes the
    // consuming package a derivative work. Write-time twin:
    // no-copyleft-source-read. See docs/agents.md/fleet/copyleft-boundaries.md.
    () =>
      run('node', [
        'scripts/fleet/check/copyleft-slices-are-tests-only.mts',
        '--quiet',
      ]),
    // Belt, superset of the gitlink gate above: no tracked file is matched by
    // .gitignore anywhere in the tree — build output, vendored trees, caches, or
    // a stray nested gitlink. `git ls-files -ci --exclude-standard` is the
    // detector, it honors negations; a hand-authored file under an ignored tree
    // stays tracked via a `!` re-include OUTSIDE the fleet-canonical block.
    () =>
      run('node', [
        'scripts/fleet/check/ignored-files-are-untracked.mts',
        '--quiet',
      ]),
    // Companion: no build OUTPUT is tracked (bundle / dispatch tables / oxlint
    // plugin / anything under _dist/). Knows a path is an output structurally
    // from paths.mts, so it catches a new output tracked BEFORE it is gitignored
    // — the gap the ignore-based belt above can't see. Only the dep-0 seeds
    // (fleet.mjs, .npmrc) may be committed. See
    // docs/agents.md/fleet/generated-outputs-are-untracked.md.
    () =>
      run('node', [
        'scripts/fleet/check/generated-outputs-are-untracked.mts',
        '--quiet',
      ]),
    // Companion: no handoff / planning doc is tracked. These are TRANSIENT agent
    // work-state, a session's in-flight reasoning, whose one home is the
    // gitignored .claude/plans/ — never source control. Matched by filename
    // suffix (…handoff.<md|txt|…>), so the legit handoff-command-nudge /
    // session-handoff-nudge hook dirs (README/index/package basenames) never
    // trip. Incident: a …-handoff.md landed in the tracked docs tree.
    () =>
      run('node', [
        'scripts/fleet/check/handoff-docs-are-untracked.mts',
        '--quiet',
      ]),
    // Companion: every sparse submodule declares a `verify =` consumer (the
    // command that build-proves the pattern) or `verify = none` (reference-only).
    // A sparse pattern with no declared consumer is unproven — the verify is
    // run separately (heavy: clone + build) via verify-submodule-sparse --run.
    () => run('node', ['scripts/fleet/verify-submodule-sparse.mts', '--check']),
    // researching-recency SKILL.md must quote the engine's output markers
    // verbatim, badge, evidence envelope, footer fences, so the model's
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
    // belt for the trees oxlint doesn't reach, live hooks; the AST rule
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
    // cross-language ports (the acorn quadruplet, a repo's mcp/*.cpp),
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
    // Per-repo socket-wheelhouse config vs the fleet TypeBox schema. The
    // loader is fail-open by design, hooks must never die on a bad config;
    // this is where drift fails LOUD — bad enum, unknown key, malformed
    // docker.prebakes entry. No-op when the repo carries no config.
    () =>
      run('node', [
        'scripts/fleet/check/socket-wheelhouse-config-matches-schema.mts',
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
    // Every language capability a repo DECLARES must dispatch to a coverage
    // lane that measures something. Pass 1 (static wiring: a known capability,
    // a lane behind it, declared paths on disk carrying the language's marker)
    // runs everywhere and always fails hard. Pass 2 (the lane actually measured
    // lines, read off coverage/lane-summary.json) is release/CI tier only,
    // because a fresh clone has no artifact to read.
    () => run('node', ['scripts/fleet/check/coverage-lanes-are-wired.mts']),
    // A repo's vitest tuning lives in the ONE settings file
    // (socket-wheelhouse.json `vitest` section), never a standalone
    // .config/repo/vitest.json. The canonical vitest config reads only that
    // section, so a leftover vitest.json is dead config the tests silently
    // ignore — this gate fails loud on the orphan a config consolidation
    // strands when a member's old per-file config is left on disk.
    () =>
      run('node', ['scripts/fleet/check/vitest-config-is-consolidated.mts']),
    // Coverage's include/exclude overlay lives in the SAME one settings file
    // (socket-wheelhouse.json `coverage` section), never a standalone
    // .config/repo/coverage.json. The canonical coverage config reads only that
    // section, so a leftover coverage.json is dead config that silently measures
    // a different denominator — this gate fails loud on the orphan a config
    // consolidation strands. config-segregation twin of the vitest gate above.
    () =>
      run('node', ['scripts/fleet/check/coverage-config-is-consolidated.mts']),
    // Never pin the microarch of a SHIPPED build — a distributed artifact must
    // detect the CPU at run time (portable SIMD = runtime dispatch), not bake in
    // the build machine's ISA and SIGILL on older CPUs. Fails on Rust
    // `-C target-cpu=native` / a baseline `+avx2` target-feature pin and Go
    // GOAMD64 v2/v3/v4 in build config; a local-profiling/bench pin passes when
    // annotated `# microarch-pin: local-profiling | removable: YYYY-MM-DD`.
    () => run('node', ['scripts/fleet/check/build-microarch-is-portable.mts']),
    // Fuzz tiers are non-opt-in: every language present in the repo must carry
    // its property-and-fuzz-testing tier (JS/TS fast-check/vitiate, Rust
    // proptest/cargo-fuzz, C++ libFuzzer, Go native fuzz). A repo with no
    // fuzzable boundary opts out via `fuzz.exempt` + `fuzz.reason` in
    // .config/repo/socket-wheelhouse.json.
    () => run('node', ['scripts/fleet/check/fuzz-tiers-are-covered.mts']),
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
    // The fleet's Rust toolchain pin is single-sourced in rust-toolchain.toml;
    // template/base's copy + RUST_UPDATER_TOOLCHAIN (cargo.mts) are DERIVED. A
    // hand-bump of one without the others reddens here; the cascade --fixes it.
    () =>
      run('node', ['scripts/fleet/check/rust-toolchain-pins-are-synced.mts']),
    // The Rust pair's sanctioned entry points, gated: `cargo fmt --check`
    // against the committed rustfmt.toml, then `cargo clippy -D warnings`.
    // Neither carried an automated check before this — a cargo-capability
    // repo could drift from its own style config or accrue clippy findings
    // with nothing to catch it. Past incident: ultrathink's tree sat 177
    // files out of rustfmt compliance, unnoticed. Release-tier: a
    // full-workspace `cargo fmt` / `cargo clippy` compiles the crate, the
    // same wall-clock long pole as the other cargo-driven gates here, so it
    // rides pre-push/CI rather than the interactive inner loop. Both
    // no-op cleanly (exit 0) in a repo with no Cargo.toml.
    releaseStep(['scripts/fleet/fmt-rust.mts', '--check']),
    releaseStep(['scripts/fleet/lint-rust.mts']),
    // The language-agnostic socket/* doctrine (no-status-emoji,
    // personal-path-placeholders, max-file-lines) enforced across Rust/Go/C++
    // source by one shared scanner — the hybrid half no native linter can express.
    () =>
      run('node', [
        'scripts/fleet/check/native-sources-are-doctrine-clean.mts',
      ]),
    // The fleet SIGNS every commit — GitHub rulesets reject an unsigned push,
    // but a spawned tool with no key access commits unsigned SILENTLY. Fail the
    // gate on any unsigned/bad-signed commit ahead of the base; fail-open when
    // the base can't be resolved (offline/shallow CI).
    () => run('node', ['scripts/fleet/check/commits-are-signed.mts']),
    // gh's default repo must resolve to origin. In a fork checkout an
    // unset/misdirected default sends bare gh commands (workflow dispatch,
    // issue/PR queries) to the UPSTREAM PARENT (2026-07-24: npm-publish.yml
    // dispatch 404'd on package-url/packageurl-js — twice). Local-only
    // git config reads; fix = `gh repo set-default <origin>`, auto-applied
    // by `doctor --fix` / `pnpm run fix --all`.
    () =>
      run('node', ['scripts/fleet/check/gh-default-repo-matches-origin.mts']),
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
    // The other direction of the same rule: a Socket-published pin must never
    // move DOWN from its committed value. Socket packages are soak-exempt and
    // always take the latest, so a rollback is someone routing around a broken
    // release by hand — and it desyncs every member's `-stable` alias from its
    // base, which is what reds the fleet. A FLEET_CATALOG_HOLDS entry is the
    // sanctioned exception and this gate honors it.
    () =>
      run('node', ['scripts/fleet/check/socket-pins-are-never-lowered.mts']),
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
    // See docs/agents.md/fleet/pnpm-patching.md, the patch-for-compat dedup lever.
    () => run('node', ['scripts/fleet/check/dedup-patches-are-justified.mts']),
    // taze single-registry posture, owner ruling: the fast-npm-meta hosted
    // endpoint is never network-allowed — no tracked file may carry its host
    // (guard/test/patch exempt) — and the taze catalog pin must have its
    // matching patches/taze@<pin>.patch + patchedDependencies entry, so a
    // taze bump without a regenerated single-registry patch goes red.
    () => run('node', ['scripts/fleet/check/taze-is-single-registry.mts']),
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
    // Every fleet/repo CLI entrypoint must SELF-DESCRIBE: runMain(main, meta)
    // so --describe and -h/--help print purpose/usage instead of running the
    // script's side effect.
    () => run('node', ['scripts/fleet/check/entry-scripts-self-describe.mts']),
    // A NEW repo-owned entry script is born with a mirror-named unit test;
    // pre-contract scripts ride the script-owned bornTested ratchet.
    () =>
      run('node', ['scripts/fleet/check/entry-scripts-are-born-tested.mts']),
    // A hook composes its severity glyph via _shared/verdict.mts (typed
    // 🚨/⚠️/ℹ️/💡, never hand-typed); pre-law hooks ride the typedVerdicts
    // ratchet.
    () => run('node', ['scripts/fleet/check/hook-verdicts-are-typed.mts']),
    // No committed dependency spec resolves through a local filesystem path
    // the repo does not carry: a hand-written `link:`/`file:` spec in a
    // package.json dependency block, or a pnpm-GENERATED lockfile `link:`
    // pointing at an untracked (generated/gitignored) directory. Use
    // workspace: (in-repo), catalog: centrally pinned, or a registry range.
    () =>
      run('node', [
        'scripts/fleet/check/dependency-specs-are-registry-or-workspace.mts',
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
    // Every SHA-pinned `uses:` in a workflow or composite action carries its
    // `# <label> (YYYY-MM-DD)` staleness stamp. The edit-time twin
    // (workflow-uses-comment-guard) is PreToolUse, so it only ever sees an
    // Edit/Write payload — a GENERATED workflow's bytes never travel through a
    // tool call, so no hook is consulted for it and no matcher tightening can
    // change that. Incident: 37 bare `# v9.0.0` pins landed in a `gh aw compile`
    // output and only surfaced when the cascade aborted before its mirror stage,
    // blocking `git push` fleet-wide. This gate reads the TRACKED TREE, so it
    // sees generated and hand-written bytes alike, at any depth, across every
    // wheelhouse template layer. Generated artifacts (a gh-aw `*.lock.yml`) are
    // exempt via the shared isNeverGated predicate.
    () =>
      run('node', ['scripts/fleet/check/workflow-sha-pins-are-stamped.mts']),
    // No block comment closes earlier than its author meant it to. A glob
    // written as a bare star segment inside a docblock IS the closing token, so
    // the block ends mid-sentence and the tail parses as code. The lint rule
    // socket/no-comment-glob-star-slash cannot see this: it walks PARSED
    // comments, and by then the comment already ended at the glob, so nothing is
    // left for a comment visitor to match. Two more layers miss it for their own
    // reasons — a rule cannot run at all on a file whose residue is a syntax
    // error, and `.config/fleet/**` (where the real incident landed) is in the
    // oxlint ignore list. Reading raw bytes ahead of any parse sees all three.
    // Incident: one such glob in vitest.coverage.fleet.config.mts produced
    // `Cannot find name 'src'` plus ten knock-on tsc errors, and zero lint
    // findings. Complements the rule, which owns the BACKSLASH-escaped form.
    () =>
      run('node', ['scripts/fleet/check/block-comments-are-closed-once.mts']),
    // Commit-time twin of denied-domain-reference-guard: no tracked file may
    // reference a fleet-DENIED domain or filename IOC (single source:
    // .claude/hooks/fleet/_shared/denied-domains.mts), and no gh-aw
    // allowDomains / egress-allowlist grant may cover one, wildcard-aware.
    // Exempt, narrowly: the denylist surfaces, their tests, CHANGELOGs, and
    // marked IOC-citation docs under docs/; egress surfaces are never exempt.
    () => run('node', ['scripts/fleet/check/denied-domains-are-absent.mts']),
    // Commit-time twin of package-manager-auto-update-guard: every installed
    // package manager has auto-update disabled, no silent self-bump.
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
    // tap-trust + cask-SHA enforcement; `absent`, no brew, is a pass — CI
    // runners lack brew. Shares detection with the brew-supply-chain-guard
    // hook + setup-security-tools via _shared/brew-supply-chain.mts.
    () =>
      run('node', ['scripts/fleet/check/brew-supply-chain-is-hardened.mts']),
    // The persistent Socket Firewall CA env pair (SFW_CA_CERT_PATH /
    // SFW_CA_KEY_PATH) is still emitted by the wrapper generator and the
    // shell-rc bridge. Without it sfw remints a throwaway CA per invocation,
    // which no OS trust store can hold, so pnpm's Rust tarball fetcher (and
    // cargo/uv/go) fails UnknownIssuer on any uncached download. The machine
    // leg loudly SKIPS where the wrappers/CA are absent — CI has neither.
    () => run('node', ['scripts/fleet/check/sfw-ca-env-is-wired.mts']),
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
    // lockdown export, no source-sniffing, and fails if it's weakened — the lib
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
