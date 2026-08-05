/**
 * @file Check --all step registry — gh-aw workflow contracts, CLAUDE.md/
 *   .claude segmentation, and the release/publish/doc-freshness surface. One
 *   of three domain-split siblings of check-steps.mts (the others: hooks-
 *   and-docs, paths-and-supply-chain); see that file for the assembled order.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { REPO_ROOT } from '../paths.mts'
import { releaseStep, run } from './check-steps.mts'
import type { CheckStep } from './check-steps.mts'

export function buildReleaseAndDocsSteps(): CheckStep[] {
  return [
    // gh-aw agentic workflows: each `<name>.md` source has a compiled
    // `<name>.lock.yml`, what Actions runs, whose embedded body_hash AND
    // frontmatter_hash match the .md — catches a prompt OR frontmatter edited
    // without `gh aw compile`. Pure node, no gh-aw dependency; vacuous pass
    // with no agentic workflows.
    () => run('node', ['scripts/fleet/check/gh-aw-locks-are-current.mts']),
    // The gh-aw compile surface is CLOSED: every gh-aw-generated file under
    // .github/workflows — compiled locks AND compiler side-emissions like
    // v0.83.2's agentics-maintenance.yml, tracked or untracked — maps to a
    // declared .md source or a SANCTIONED_GHAW_EMISSIONS entry. A bare
    // `gh aw compile` drive-by goes red with the two legal moves named:
    // adopt via allowlist, or delete.
    () => run('node', ['scripts/fleet/check/gh-aw-emissions-are-declared.mts']),
    // gh-aw agentic workflows: any explicit `engine.model` frontmatter pin is a
    // canonical model id (KNOWN_MODELS: pricing registry + AI_TIER). Catches a
    // workflow left on a stale id (claude-sonnet-4-5) after the tier moved — the
    // "same role, two model strings" drift the ai-spawns gate can't see.
    () =>
      run('node', [
        'scripts/fleet/check/gh-aw-workflow-models-are-canonical.mts',
      ]),
    // The fleet-owned local-agent egress allowlist (.config/fleet/egress-
    // allowlist.json) is a SUBSET of gh-aw's expanded firewall allowDomains — the
    // hosts CI's agent firewall already trusts. One-directional containment (fleet
    // ⊆ gh-aw), not byte-equality, so a gh-aw version bump doesn't flap it; fails
    // only when the local allowlist grants a host the CI fence would block (a
    // hole). Vacuous pass where the allowlist or a gh-aw lock is absent.
    () =>
      run('node', ['scripts/fleet/check/egress-allowlist-is-gh-aw-subset.mts']),
    // CLAUDE.md informativeness audit. Every `###` section in the fleet
    // block must anchor to one of: a hook citation
    // (`.claude/hooks/...` reference), a docs link
    // (`[text](docs/...)`), a skill reference
    // (`.claude/skills/.../SKILL.md`), or an explicit
    // `(advisory, no enforcement)` opt-out. CLAUDE.md is load-bearing
    // context for every session; sections without an enforcement
    // anchor tend to rot. Per the Salesforce agentic-engineering
    // article, CLAUDE.md variance is a direct quality driver.
    () =>
      run('node', ['scripts/fleet/check/claude-md-rules-are-informative.mts']),
    // The repo-specific (🏗️) half of CLAUDE.md held to the same bullet-index
    // shape as the cascaded fleet block above it. A prose paragraph buries the
    // rule inside sentences, and an over-long bullet is an explanation that
    // belongs in docs/agents.md/repo/<topic>.md — the fleet block measured a
    // 286-char median before it was flattened, which is what pushed the file
    // toward its 40 KB cap and started the size-guard trimmer cutting clause
    // tails out of live rules.
    () =>
      run('node', [
        'scripts/fleet/check/claude-md-repo-section-is-a-bullet-index.mts',
      ]),
    // .claude/ segmentation gate. Every entry under
    // .claude/{agents,commands,hooks,skills}/ must live under fleet/<name>/
    // when wheelhouse-canonical, or repo/<name>/ everything else.
    // Dangling top-level entries shadow the canonical copy and break
    // skill resolution. Past incident (2026-06-01): fleet-wide audit found
    // ~200 dangling entries across 10 repos. Auto-fixable with
    // `node scripts/fleet/check/claude-dirs-are-segmented.mts --fix`.
    () => run('node', ['scripts/fleet/check/claude-dirs-are-segmented.mts']),
    // Every fleet subagent definition points at the repo's rules. A subagent
    // runs in its OWN context and inherits none of the main session's memory
    // of CLAUDE.md, so an uncited definition produces an actor who learns the
    // conventions one tool-refusal at a time. pr-feedback.md was the real
    // miss on 2026-08-01, and it is the broadest-privileged agent in the
    // fleet: it commits, pushes, and comments as the operator. The hooks bind
    // subagents regardless, because they fire at the tool layer for every
    // caller. This is about knowing the rule before spending a turn on it.
    () => run('node', ['scripts/fleet/check/agents-have-rule-citations.mts']),
    // Every file under template/base is classified into exactly one distribution
    // channel (mirror / optional / preset / conditional / expected / carveOut /
    // overrides / native handler) — Assertion A (blocking) fails when a file
    // reaches no member + no release bundle, the silent-drift class that shipped
    // a stale github-release.yml / npm-publish.yml. Assertion B (report-only)
    // flags a present root copy that drifted from its resolved template source.
    // Wheelhouse-only in effect (scripts/repo absent → vacuous pass in members).
    () =>
      run('node', [
        'scripts/fleet/check/wheelhouse-controlled-files-are-classified.mts',
      ]),
    // Release-hygiene floor: every publishable package.json (private!==true,
    // has a name) must declare a `files` field. Without it, npm publishes the
    // ENTIRE directory — test fixtures, .claude/ tooling, coverage, secrets.
    // REPORT-ONLY (exits 0, lists findings); flip MODE to 'strict' in the
    // check after clearing the pre-existing backlog.
    () =>
      run('node', [
        'scripts/fleet/check/published-packages-have-files-field.mts',
      ]),
    // package.json `files:` allowlist hygiene. Flags publishes that leak
    // dev/test content (overshoot), `files:` entries that match nothing in
    // the publish surface (undershoot), and packages missing the canonical
    // README + LICENSE essentials. Skips workspaces marked
    // `"private": true`. Uses `npm pack --dry-run --json` as the source of
    // truth — same logic npm itself uses for publish.
    releaseStep(['scripts/fleet/check/package-files-are-allowlisted.mts']),
    // The SPDX id pinned for each copyleft upstream still matches Socket's
    // license data. Network-bound, so it rides the release/CI tier and the
    // interactive loop stays offline. Offline-safe by contract: no token, no
    // network, or an unresolved purl SKIPS with a loud notice — never a false
    // green, never a connectivity failure. An upstream relicensing is what
    // poisons a derivation months later, so the pin gets a standing watchdog.
    // See docs/agents.md/fleet/copyleft-boundaries.md.
    releaseStep([
      'scripts/fleet/check/copyleft-licenses-are-current.mts',
      '--quiet',
    ]),
    // Detect an npm publish-time review hold: since 2026-07-28 npm scans
    // every publish, and a HELD package is live on the registry (installable)
    // while npmjs.com withholds its page with a 403 — a split-brain that
    // reads as "not published" to humans and sent agents chasing phantom
    // causes (@socketsecurity/odai@0.1.0). Report-mode: a hold is npm-side
    // and no commit clears it; the check names the state and the playbook
    // (support ticket; contentPolicy + DISCLOSURE dual-use metadata on future
    // publishes). Network-bound → release/CI tier.
    // See docs/agents.md/fleet/npm-publish-scanning.md.
    releaseStep([
      'scripts/fleet/check/npm-package-page-is-visible.mts',
      '--quiet',
    ]),
    // No `catalog:` pin resolves to a version npm marks DEPRECATED. The belt to
    // the update tooling's braces: the catalog-drift fixer refuses a deprecated
    // candidate (scripts/fleet/lib/npm-version-policy.mts), and this stops one
    // landing by any other route — a hand edit, a cascade splice, a version the
    // upstream deprecates after the fleet pinned it. Network-bound, so it rides
    // the release/CI tier; offline-safe by contract — no registry answer is an
    // UNVERIFIED notice, never a false green and never a connectivity failure.
    releaseStep([
      'scripts/fleet/check/catalog-pins-are-not-deprecated.mts',
      '--quiet',
    ]),
    // Every published package's npm trusted-publisher binding still names the
    // repository that actually publishes it. npm compares repository + workflow
    // + environment as literal strings, so a repo rename breaks the OIDC
    // exchange with a bare 404 while GitHub's redirect keeps every manual
    // spot-check looking correct. Reads each packument, so it rides the
    // release/CI tier.
    releaseStep([
      'scripts/fleet/check/trusted-publishers-match-source.mts',
      '--quiet',
    ]),
    // Pre-publish source gate: every publishable package.json declares
    // publishConfig.access:"public" + provenance:true (and registry-if-set =
    // npmjs) — the source-config preconditions for a public, provenance-attested
    // release under OIDC trusted publishing. Skips `"private": true` workspaces.
    // The post-publish registry audit is provenance-is-attested.mts.
    () => run('node', ['scripts/fleet/check/publish-config-is-hardened.mts']),
    // The release gate for the FILES FIELD: packs the package (`pnpm pack`)
    // and inspects the real tarball entry list, failing on fleet/claude
    // scaffolding, hidden files, or anything outside the `files` contract —
    // a wrong `files` field publishes silently otherwise. Skips `"private":
    // true` workspaces (never publish).
    releaseStep(['scripts/fleet/check/pack-contents-are-clean.mts']),
    // The release gate for the tarball's BYTES: extracts every text-like
    // entry and scans it for private/internal path shapes, fleet-DENIED
    // domains, and credential value shapes — using the same canonical
    // matchers the source-level scanners use. A build step can bake a build
    // machine's home path, an internal host, or a secret into dist output
    // that no source scan sees, and a published tarball is immutable. Skips
    // `"private": true` workspaces (never publish).
    releaseStep(['scripts/fleet/check/pack-bytes-have-no-private-refs.mts']),
    // A published bundled dist must be MAPLESS + UNMINIFIED — Socket ships
    // readable, unobscured code. In scope only when package.json `files`
    // includes "dist" AND a rolldown/rollup config exists; vacuous pass
    // otherwise, and skips cleanly when `dist/` isn't built yet. Report-only
    // member-ci-fires-on-push rollout pattern, until any fleet backlog clears.
    releaseStep(['scripts/fleet/check/published-dist-is-readable.mts']),
    // Release-gate: the fleet bundle must build → install → verify round-trip
    // cleanly before it ships. Calls validate-release-bundle.mts (wheelhouse-only
    // `scripts/repo/`); vacuous pass in every cascaded fleet repo (validator
    // absent). Catches a broken producer or installer before the tarball reaches
    // a GitHub Release.
    releaseStep(['scripts/fleet/check/bundle-is-installable.mts']),
    // The hook V8 startup snapshot must be REAL — builds a blob (no
    // snapshot-hostility bail), boots, dispatches with baseline parity, and (when
    // this machine is wired to the launcher) the launcher binary is present. The
    // launcher fails open to baseline, so a rotted snapshot is otherwise
    // invisible; this makes it loud. Release-tier (builds + boots).
    releaseStep(['scripts/fleet/check/hook-snapshot-is-wired.mts']),
    // Every fleet member's ci.yml workflow must actually FIRE on push — a repo
    // can carry a valid push trigger yet never run (fresh private repo pending
    // org/enterprise Actions activation), landing commits unverified. Reads the
    // push-run count per member via gh; report-mode for now (skips cleanly when
    // gh is unauthenticated / no fleet-repos.json in a member checkout).
    releaseStep(['scripts/fleet/check/member-ci-fires-on-push.mts']),
    // The `squash-history` opt-in tracks the release boundary in BOTH
    // directions: a member that has never published keeps the opt-in (its
    // history stays collapsible), and a member that HAS published must drop it
    // — a squash rewrites every commit the published artifact's provenance and
    // any SHA-pinning consumer resolve. Released-but-opted-in fails; the
    // inverse warns. npm + crates.io are the signals; offline-safe by contract
    // (no gh, no auth, or an unreachable registry SKIPS that member loudly).
    // See docs/agents.md/fleet/squash-until-release.md.
    releaseStep([
      'scripts/fleet/check/fresh-members-are-squashed-until-release.mts',
      '--quiet',
    ]),
    // Every repo in fleet-repos.json must EXIST in its org — a roster entry with
    // no repo is a half-onboarded member (odai: roster entry, no
    // SocketDev/ repo → stranded cascades + 404'd environments). Onboarding must
    // create the repo AND update the roster together. Report-mode + network-gated
    // (a 404 can mean private + no token access), skips cleanly in offline lanes.
    releaseStep(['scripts/fleet/check/member-repos-resolve.mts']),
    // Every member's publish-shaped environment (npm-publish / cargo-publish /
    // github-release) must carry a deployment branch policy, and the
    // pre-rename legacy names (publish / release) must not exist. Trusted
    // publishing pins repo + workflow + ENVIRONMENT — never a branch — and
    // in-workflow ref guards travel with the dispatched ref, so the
    // environment policy is the only server-side gate; null means any ref can
    // publish. Settings drift is invisible to the cascade — this is its
    // ratchet. Strict (fleet burned to zero 2026-07-28); skips cleanly when
    // gh is unauthenticated / member checkout / no roster.
    releaseStep([
      'scripts/fleet/check/publish-environments-are-branch-restricted.mts',
    ]),
    // Every member's default branch must carry effective branch rules:
    // deletion blocked everywhere, force-push blocked except squash-history
    // opt-ins (their flatten flow lease-pushes main by design). Reads
    // EFFECTIVE rules (rules/branches/main), so a disabled ruleset counts as
    // absent — the socket-cli trap. --fix manages exactly one repo ruleset
    // (fleet-main-protection) and never touches any other. Strict; skips
    // cleanly off the release tier / member checkouts / no gh.
    releaseStep(['scripts/fleet/check/main-branch-rules-are-enforced.mts']),
    // Every member's GitHub security posture matches the posture law
    // (_shared/security-posture-law.mts): CodeQL default setup configured with
    // a SANITISED language set on public repos — at most one of the
    // javascript/javascript-typescript/typescript trio, which are three names
    // for ONE extractor, and only languages actually present in the tree —
    // plus secret scanning + push protection on public repos, vulnerability
    // alerts on everywhere, automated-security-fixes OFF everywhere (alerts
    // without PRs), and the canonical no-op dependabot.yml. socket-vscode read
    // `configured` for months while permanently erroring on the trio, and
    // GitHub SUGGESTS that same trio on every unconfigured public fleet repo.
    // --fix converges settings only, never dependabot.yml (cascade-owned) and
    // never a private repo's paid-GHAS scanning. REPORT-ONLY until the fleet
    // burns down; skips cleanly off the release tier / member checkouts / no gh.
    releaseStep(['scripts/fleet/check/security-posture-matches-law.mts']),
    // Every member's default GITHUB_TOKEN must be read-only and Actions must
    // not be able to approve pull requests — a compromised workflow step
    // otherwise gets a write token and can satisfy review gates. --fix is a
    // single PUT per repo, but the write->read flip refuses fail-safe unless
    // every workflow file on the default branch declares a top-level
    // permissions: block. Strict; skips cleanly off the release tier /
    // member checkouts / no gh.
    releaseStep(['scripts/fleet/check/workflow-token-is-read-only.mts']),
    // Version tags must be IMMUTABLE: a tag-target ruleset carrying deletion
    // + non_fast_forward on refs/tags/v* — tags trigger publish/release
    // workflows, and without this anyone with push can move or delete one.
    // Creation is deliberately unrestricted so release flows can push tags.
    // --fix manages exactly one ruleset (fleet-tag-protection). Strict; skips
    // cleanly off the release tier / member checkouts / no gh.
    releaseStep(['scripts/fleet/check/release-tags-are-immutable.mts']),
    // NAMES-ONLY secrets/variables inventory: every repo's live Actions
    // secret names must match the declared expectation (undeclared stray =
    // exfil staging / attacker-added; missing = broken CI credential). No
    // --fix — values are unreadable and deleting an unknown secret is a
    // human call; the remedy is declaring it in the law or provisioning /
    // deleting by hand. Strict; skips cleanly off-tier / member / no gh.
    releaseStep(['scripts/fleet/check/actions-secrets-are-declared.mts']),
    // Every repo webhook must match the declared allowlist (URL-prefix,
    // secrets stripped) — an attacker-added hook is silent event egress and
    // nothing else would ever notice one. No --fix: widening the declared
    // allowlist is the remedy for sanctioned hooks, hand-deletion for
    // hostile ones. Strict; skips cleanly off-tier / member / no gh.
    releaseStep(['scripts/fleet/check/webhooks-are-allowlisted.mts']),
    // The dep-0 fetcher (bootstrap/fleet.mjs) is a rolldown-inlined build artifact;
    // fail loud if it drifts from its bootstrap/src/* source (rebuild: node
    // scripts/repo/gen/bootstrap.mts). Wheelhouse-only — the build script
    // lives in uncascaded scripts/repo/, so a member with no such script vacuous-passes.
    () =>
      process.env['FLEET_CHECK_RELEASE'] &&
      existsSync(
        path.join(REPO_ROOT, 'scripts', 'repo', 'gen', 'bootstrap.mts'),
      )
        ? run('node', ['scripts/repo/gen/bootstrap.mts', '--check'])
        : Promise.resolve({
            label: 'gen/bootstrap.mts',
            ms: 0,
            ok: true,
            output: '',
            skipped: !process.env['FLEET_CHECK_RELEASE'],
          }),
    // The thin-distribution untrack set must NEVER contain a CI-critical GitHub
    // path. A thin member git-untracks whatever thinIgnoreEntries returns; GitHub
    // reads .github/workflows/** + .github/actions/fleet/** from the committed
    // tree BEFORE any fetch could repopulate them, so untracking one breaks CI
    // outright. Proves the shipped fetcher honors isAlwaysTrackedGitHubSurface.
    // Runs per-tree (imports the member's own scripts/repo/bootstrap/fleet.mjs);
    // vacuous pass where that fetcher is absent.
    () => run('node', ['scripts/fleet/check/thin-untrack-set-is-ci-safe.mts']),
    // Every slashed pattern in .config/fleet/.prettierignore must be `**/`-anchored
    // or it silently matches nothing (oxfmt roots the matcher at the ignore file's
    // dir via Gitignore::new). Catches the footgun where a bare `vendor/**` looks
    // right but excludes nothing.
    () =>
      run('node', [
        'scripts/fleet/check/prettierignore-globs-are-anchored.mts',
      ]),
    // The two STATIC ignore surfaces (.config/fleet/.prettierignore + the
    // fleet-canonical .gitignore block) can't import GENERATED_GLOBS
    // (scripts/fleet/constants/generated-globs.mts) the way oxlint/vitest do,
    // so this gate asserts each entry has a **/-anchored twin on both — the
    // format/git half of the generated-tree single source of truth.
    () =>
      run('node', ['scripts/fleet/check/generated-globs-are-consistent.mts']),
    // The `@lockstep-mirror` lint/format exemption may only land on a genuine
    // verbatim mirror declared `mirror: true` in the lockstep manifest, and
    // every declared mirror must actually carry the marker + its
    // .prettierignore entry. Forward + reverse gates tie the paste-anywhere
    // escape hatch to the manifest so the exempt set can't grow silently.
    () =>
      run('node', [
        'scripts/fleet/check/lockstep-mirror-markers-are-declared.mts',
      ]),
    // A PENDING release's CHANGELOG entry must be DERIVED from the commits it
    // releases (run `node scripts/fleet/bump.mts`), never hand-written ahead of the
    // tag. Fires only when package.json is ahead of the last v<semver> tag;
    // regenerates the entry from the commits since that tag and fails on drift.
    // Catches the failure mode that shipped a CHANGELOG entry describing work that
    // landed after its tag. Published versions are historical and not re-checked.
    //
    // RELEASE TIER, like its sibling version-is-not-ahead-of-published below,
    // and for a sharper reason than cost: the release pipeline's preflight runs
    // `check` BEFORE the bump, and only the bump regenerates this entry. As a
    // bare step it gated the one stage that satisfies it, so a release
    // deadlocked the moment any commit landed after its bump — with no way out,
    // since a direct bump.mts is blocked by release-defers-to-script-guard and
    // hand-editing CHANGELOG.md is blocked by this very check. Held to the
    // release tier it still runs where it must: pre-push (`check --all
    // --release`) and CI, both of which see the post-bump tree.
    releaseStep(['scripts/fleet/check/changelog-is-commit-derived.mts']),
    // A PENDING release's package.json version must be at most ONE bump ahead of
    // the registry's latest-published version. A manifest pre-bumped further
    // skips the versions between (package.json pre-bumped to 1.4.3, then the
    // workflow bumped 1.4.3 → 1.4.4, so 1.4.3 was never published). Network read
    // → release-tier; fail-open when no published version / registry unreachable.
    releaseStep(['scripts/fleet/check/version-is-not-ahead-of-published.mts']),
    // Every version PUBLISHED to npm has its v<version> tag on origin AND a
    // published GitHub release. The promote is irreversible and the tag +
    // release are cut in a separate leg after it, so a leg that produces
    // nothing leaves a half-done release nothing else detects. Scoped to the
    // TAG ERA, anchored at the earliest published version that carries a tag,
    // so pre-discipline history is not a backlog. Network reads → release tier;
    // fail-open offline / without gh auth.
    releaseStep([
      'scripts/fleet/check/published-versions-have-releases.mts',
      '--quiet',
    ]),
    // Every RECENTLY published version has some release tag — `v<version>` or
    // the bare-semver escape hatch — resolving to the commit npm's SLSA
    // provenance says produced the artifact. A `v*` tag is immutable under
    // fleet-tag-protection, so a broken release is corrected by pushing a BARE
    // tag; the attestation, not the tag name, decides which one is
    // authoritative, and a pair is a legitimate state (flagged only when
    // NEITHER matches). Catches the provenance orphan — socket-lib 6.5.0
    // attested e66bd62b while v6.5.0 sat on the bump commit. Registry reads →
    // release tier; unreadable sources report NOT VERIFIED rather than passing.
    // See docs/agents.md/fleet/release-tag-escape-hatch.md.
    releaseStep([
      'scripts/fleet/check/release-tags-match-provenance.mts',
      '--quiet',
    ]),
    // A multi-crate cargo workspace keeps every publishable crate BARE — a
    // `-prerelease` breaks inter-crate `^X.Y.Z` resolution. The hint is OPTIONAL
    // for a single crate (the release bumps from the published version by
    // heuristic; anti-skip is version-is-not-ahead-of-published). No-ops without
    // a Cargo.toml / cargo. Release-tier.
    releaseStep([
      'scripts/fleet/check/multi-crate-cargo-versions-are-bare.mts',
      '--quiet',
    ]),
    // No tracked symlink is self-referential or points at an absolute path
    // inside the repo (a `node_modules → /abs/<repo>/node_modules` self-loop
    // bricked fresh clones fleet-wide with ELOOP; git kept it tracked despite
    // .gitignore). Reads the git object's link target so it catches one already
    // committed regardless of how it was staged.
    () => run('node', ['scripts/fleet/check/tracked-symlinks-are-safe.mts']),
    // README coverage badge matches the latest coverage run. When
    // .cache/fleet/coverage/coverage-summary.json (vitest
    // json-summary) exists AND the README
    // carries a populated `![Coverage](…coverage-NN%…)` badge, the percent must
    // equal the rounded line-coverage total. Fails open when not checkable (no
    // badge, the `<PCT>` placeholder, or no coverage data — a lint/type CI lane).
    // Pre-bump-wave twin of `gen/coverage-badge.mts`; shares lib/coverage-badge.
    () => run('node', ['scripts/fleet/check/coverage-badge-is-current.mts']),
    // Reminder/guard duplication gate. The fleet convention: a `-guard` hook
    // BLOCKS, a `-nudge` hook NUDGES — one surface per concern, never both.
    // Errors when a base name has both `<base>-guard` and `<base>-nudge`
    // an exact same-concern duplicate; advisory-lists 2-segment shared-prefix
    // pairs for a human glance. Past incident (2026-06-03): a prose-antipattern
    // reminder + guard overlapped; resolved by dropping the reminder.
    () =>
      run('node', [
        'scripts/fleet/check/hooks-have-no-guard-nudge-overlap.mts',
        '--quiet',
      ]),
    // Hook name ⟷ blocking behavior: a `-guard` must BLOCK (exitCode=2 /
    // exit(2) / return 2 / decision:'block'), a `-nudge` must only NUDGE.
    // Errors when a `-guard` never blocks (→ should be `-nudge`) or a
    // `-nudge` blocks (→ should be `-guard`).
    () =>
      run('node', [
        'scripts/fleet/check/hook-names-are-accurate.mts',
        '--quiet',
      ]),
    // The cascaded co-located trees (.claude/hooks/fleet, .config/fleet/oxlint-plugin,
    // .git-hooks) ship to members + the release bundle, but the cascaded vitest
    // config EXCLUDES their test dirs — so a wheelhouse-only hook/lint-rule/git-hook
    // test there is dead weight no member can run. Those tests live under test/repo/
    // (vitest); this fails if a `*.test.*` reappears in a cascaded tree. See
    // docs/agents.md/fleet/test-layout.md.
    () =>
      run('node', [
        'scripts/fleet/check/cascaded-fleet-trees-have-no-tests.mts',
        '--quiet',
      ]),
    // Lock-step release-cascade pairing: a member's pinned bundle.cascadeSha has a
    // matching gh release whose templateSha equals it, and the release at
    // bundle.ref exists. Read-side twin of the dep-0 fetch-path verify (which
    // hard-fails at install). Network-gated: SKIPS when gh is unavailable, so it
    // no-ops in offline CI lanes + repos with no pin, the wheelhouse producer.
    releaseStep([
      'scripts/fleet/check/release-and-cascade-are-paired.mts',
      '--quiet',
    ]),
    // The RELEASE CASCADE GRAPH's read side: every published fleet package's
    // downstream declarations — consumer catalog pins, the fleet catalog,
    // socket-registry's manifest.json purl entry — track its registry latest,
    // with lag going red and the owed action named. Registry reads → release
    // tier; sibling-clone/offline gaps skip honestly; wheelhouse-only in
    // effect (members have no template/base → vacuous pass). Graph:
    // scripts/fleet/lib/release-cascade.mts.
    releaseStep([
      'scripts/fleet/check/cascade-followups-are-settled.mts',
      '--quiet',
    ]),
    // Persisted release pins store ONLY exact canonical values — the belt twin of
    // the write-time bundle-pin validators (bootstrap/src/lockstep.mts +
    // sync-scaffolding/socket-wheelhouse-config.mts). Asserts the committed
    // bundle.ref is an exact fleet-pack-<hex> tag (no latest/main/head/stable/
    // newest alias), bundle.cascadeSha / a manifest templateSha is a bare 40-hex SHA, and
    // no alias is stored beside a canonical value. Pure local reads → always on;
    // vacuous pass where nothing is pinned (the producer / a non-thin member).
    () => run('node', ['scripts/fleet/check/release-pins-are-canonical.mts']),
    // Freshness of the two export-driven doc artifacts, one gate per artifact so
    // a failure names the ONE generator that owns the path — following the
    // remediation can never rewrite the other file. Each generator runs its own
    // `--check`: fail-open where the member did not set the `docs` opt-in or has
    // no export surface, and staleness compared on whitespace-normalized text so
    // a formatter's table alignment is not drift.
    () => run('node', ['scripts/fleet/gen/api-md.mts', '--check', '--quiet']),
    () => run('node', ['scripts/fleet/gen/llms-txt.mts', '--check', '--quiet']),
    // Test mirror-naming convention: every unit test basename matches the basename
    // of its one first-party static import. Run with --strict so violations exit
    // non-zero; mirror-exempt markers on skip files suppress known exceptions.
    () =>
      run('node', [
        'scripts/fleet/check/tests-are-mirror-named.mts',
        '--strict',
        '--quiet',
      ]),
    // package.json test*-script convention (CLAUDE.md "test-scripts-defer-to-mts"):
    // route through a .mts wrapper, never a raw vitest/jest/mocha/ava/tap
    // binary (the hook/lint-rule tier's `node --test` is exempt). REPORT-ONLY
    // (exits 0) — the fleet backlog of raw invocations predates this gate; flip
    // to --strict once it clears.
    () => run('node', ['scripts/fleet/check/test-scripts-are-deferred.mts']),
    // Test files vitest collects must import vitest, not node:test — vitest
    // loads a node:test file, registers nothing, and reports "no tests": a
    // green run with zero coverage. The Edit/Write hook tier cannot see files
    // created via heredoc/patch/cascade; this judges the TREE. Restored
    // 2026-07-28 after a cascade deleted the root-only original (it was never
    // template-first and never registered — this registration is the fix).
    () => run('node', ['scripts/fleet/check/test-files-are-vitest-run.mts']),
    // The sibling half: a declared test/coverage command and the repo's test
    // files must actually MEET. Three exit-0 defects it names — a command whose
    // include globs match nothing (bun-security-scanner's cover leg drives
    // vitest over a `bun test` suite and prints 0.00%), a test file no declared
    // command collects, and a file only an opt-in lane reaches while the
    // `test` / `cover` gate never does. Static: package.json names the runner,
    // the vitest config module supplies the globs.
    () =>
      run('node', ['scripts/fleet/check/test-files-are-runner-collected.mts']),
    // external-tools.json shared entries match the wheelhouse copy: the
    // cascade-owned setup actions read this per-repo-owned data file at runtime,
    // so stale copies break CI setup (five repos on 2026-07-08). Compares only
    // SHARED tool names; repo-specific tools pass. Skips cleanly in CI (needs a
    // sibling wheelhouse checkout for the reference copy).
    releaseStep([
      'scripts/fleet/check/external-tools-match-wheelhouse.mts',
      '--quiet',
    ]),
    // Release/publish package.json scripts follow the `<target>:<verb>`
    // convention (github:release, npm:publish, cargo:publish, python:publish).
    // Body-driven + enforcing (exit 1) — no fleet backlog, so no repo may hide a
    // release/publish under a bare `release`/`publish` name.
    () =>
      run('node', [
        'scripts/fleet/check/release-publish-scripts-are-conventionally-named.mts',
        '--quiet',
      ]),
    // Publish WORKFLOWS follow the `<target>-publish[-variant].yml` filename +
    // `<target>-publish` environment + `id-token: write` OIDC convention. The
    // workflow-file twin of the script-name check above — trusted-publisher
    // config pins the filename, so a live publisher hidden under provenance.yml /
    // publish-npm.yml is real drift. Body-driven; REPORT-ONLY (exit 0) while the
    // fleet migrates off the legacy shapes.
    () =>
      run('node', [
        'scripts/fleet/check/publish-workflows-are-conventionally-named.mts',
        '--quiet',
      ]),
    // Publish workflows are STAGED, FAIL-CLOSED, and MARKERS-FIRST: literal
    // npm-family publish lines must be `pnpm stage publish` (the per-package
    // trusted-publisher grants allow stage-only), continue-on-error is
    // forbidden in a publishing workflow, and an in-file v<version> tag /
    // GitHub release is cut BEFORE the first upload so provenance binds real
    // markers. A stage rejected after the markers BURNS the version — the
    // next release is a patch bump, never a reuse. Strict.
    () =>
      run('node', [
        'scripts/fleet/check/publish-workflows-are-staged-fail-closed.mts',
        '--quiet',
      ]),
    // Every publish entry point resolves to the fleet script or to a
    // repo-local orchestrator that imports the fleet primitives, and the npm
    // UPLOAD invocation itself exists once, in
    // publish-infra/npm/publish-command.mts. Five members shipped identical
    // publish bytes and still published under two different credentials — a
    // second copy of the upload command is a second place provenance and the
    // trusted-publishing auth posture get decided, and it will be the stale
    // one. Orchestration stays repo-local; the upload does not. Strict.
    () =>
      run('node', [
        'scripts/fleet/check/publish-entrypoints-are-fleet-composed.mts',
        '--quiet',
      ]),
    // Every workflow job that runs a version-derivation leg (bump.mts,
    // npm-publish.mts --bump, cargo-publish.mts --bump, publish-pipeline.mts)
    // must check out with the v* tags reachable — `fetch-tags: true`, or a
    // full-history `fetch-depth: 0`. The bump engine anchors on registry-latest
    // PLUS the last reachable tag, so on a never-published repo the tags are the
    // ONLY anchor and a depth-1 tagless checkout derives 0.1.0, then trips the
    // half-applied-bump gate on historical CHANGELOG sections (decmpfs run
    // 30226873755). Dual-root in the wheelhouse; absent workflow file is a
    // clean no-op. STRICT (exit 1) — the invariant is one line with fleet-wide
    // blast radius.
    () =>
      run('node', [
        'scripts/fleet/check/version-derivation-jobs-have-tags.mts',
        '--quiet',
      ]),
    // A bot workflow that GPG-signs commits MUST use the BARE
    // socket-bot@users.noreply.github.com committer email — the UID on the
    // registered BOT_GPG_PRIVATE_KEY key. The numeric-prefixed form lands
    // Unverified and a "Require commit signing" ruleset rejects the push (it
    // broke the wheelhouse release orchestrator's bump push). STRICT (exit 1):
    // a hard push-blocker, not a style nit. The numeric form is for the
    // non-GPG / web-flow path only.
    () =>
      run('node', [
        'scripts/fleet/check/bot-signing-email-matches-key.mts',
        '--quiet',
      ]),
  ]
}
