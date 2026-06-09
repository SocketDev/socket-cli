---
name: onboarding-fleet-member
description: Onboard a repo into the socket fleet end-to-end — full adoption, not just a scaffolding cascade. Registers the repo, writes its marker config (layout/native/capabilities detected), converts its tooling to fleet standards (eslint/prettier/biome → oxlint+oxfmt, esbuild/tsup → rolldown CJS bundle, jest/mocha → vitest), ports coding style + socket-lib + packageurl-js + repo-overlays + CLAUDE.md + the canonical README with badges, trims the bundle, dedupes deps via overrides, installs the security/hooks/signing toolchain, verifies the repo is green, and lands it. Use when adding a new repo to the fleet, or bringing a half-onboarded repo to full adoption.
user-invocable: true
allowed-tools: AskUserQuestion, Read, Edit, Write, Grep, Glob, Skill, Bash(git:*), Bash(node:*), Bash(pnpm:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(jq:*), Bash(mkdir:*), Bash(cp:*), Bash(mv:*), Bash(rm:*), Bash(chmod:*), Bash(diff:*), Bash(wc:*)
model: claude-opus-4-8
context: fork
---

# onboarding-fleet-member

Bring a repo to **full fleet adoption** — converge its tooling, style, build, and
config to fleet standards, register it, and land it green. This is NOT just dropping
the scaffolding cascade on top (that's step 6); it's converting what the repo already
has into what the fleet mandates.

🚨 **This is judgment work, not mechanical.** Each conversion (lint, bundler, style,
lib adoption) is per-repo and per-file. Detect what the repo actually has, convert
deliberately, verify after each step. Do NOT declare onboarded until `check --all` +
`test` + `build` are green — "files dropped in" is not "fleet-clean."

## Inputs
Target repo: a name (resolved to `$PROJECTS/<name>`) or an absolute path. The repo must
be a git repo with a clean working tree and a remote.

## Detection (run first — drives every later step)
Parse the repo's REALITY, not assumptions. Use `node` to read package.json (not regex),
and config-file EXISTENCE (not string-grep — `eslint`/`esbuild`/`biome` appear in fleet
rule text and false-positive a grep). The shared detector is
`scripts/repo/check/fleet-members-are-onboarded.mts` (exports `antiFleetDeps`,
`antiFleetConfigFiles`, `countWorkspaceMembers`, `hasRolldownConfig`) — reuse it.

Detect and record:
- **layout** — `single-package` vs `monorepo`, by COUNTING `packages/*/package.json`
  members. `pnpm-workspace.yaml` presence is NOT the signal (every fleet repo ships one).
  A `packages/` with one member is still monorepo.
- **native role** — `none` / `consumer` / `producer` / `both`. This is the
  release-artifact role, NOT inferable from Cargo.toml. ASK if ambiguous.
- **capabilities** — `cargo` when the repo has tracked non-fixture `.rs`/`Cargo.toml`;
  map the trait to its package globs (e.g. `{ cargo: ["packages/*-builder"] }` for a
  builder monorepo, `{ cargo: ["packages/acorn/lang/rust"] }` for a nested crate). These
  are orthogonal to layout AND native — never conflate.
- **publish identity** — `name` + `private`. A non-private package gets the published-name
  README badge token; a private repo doesn't publish.
- **has bin** — drives a CLI-shaped README Usage section.
- **anti-fleet tooling** — eslint/prettier/biome/esbuild/tsup/jest/mocha/webpack/vite/
  rollup, by dep key + config file. This is the conversion surface.
- **default branch** — `git symbolic-ref refs/remotes/origin/HEAD`, fall back main→master.
- **bundled output** — does it ship a built bundle (publishable + has `build` + emits
  `dist`/`build`)? Drives rolldown-CJS + trim.

## The adoption steps (dependency order; verify after each)

1. **Pre-flight.** Target resolves, is a git repo, clean tree, has a remote. Stop
   otherwise — uncommitted changes mix with conversion output and break rollback.

2. **Register.** Add the repo to
   `template/.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json` — `{ name,
   description, optIns? }`, alpha-sorted in the `repos` array. ASK the user whether the
   repo is `squash-history` opt-in (currently socket-addon/bin/btm/sdxgen/stuie).

3. **Marker config.** Write `<repo>/.config/socket-wheelhouse.json`: required
   `schemaVersion: 1`, `repoName`, `layout`, `native`; plus detected `capabilities` map.
   Validate by running `readSocketWheelhouseConfig` (the parser fails loudly on a bad
   shape). The schema reference points at `./socket-wheelhouse-schema.json`.

4. **Package manager.** Must be pnpm — set `packageManager: "pnpm@<version>"` (catalog
   version) if absent or another PM. Convert npm/yarn lockfiles + scripts. The fleet is
   pnpm-only.

5. **Linter/formatter → oxlint + oxfmt.** Remove `.eslintrc*` / `eslint.config.*` /
   `biome.json` / `.prettierrc*` and their deps. Install the fleet oxlint plugin
   (cascaded under `.config/fleet/oxlint-plugin/`) + `oxlintrc.json` (comes via the
   cascade in step 6). Rewrite `lint`/`fix` scripts to the fleet form. Genuinely
   repo-specific rules → `.config/repo/` overrides, never inline disables.

6. **Scaffolding cascade.** Run `pnpm run onboard -- --target <repo>` (which backs up,
   spins a temp worktree, runs `sync-scaffolding --fix`) OR the `cascading-fleet` skill.
   This installs the fleet-canonical trees (`.claude/`, `.config/fleet/`, `.git-hooks/`,
   `scripts/fleet/`, `docs/claude.md/fleet/`, canonical scripts). Review the diff.

7. **Bundler → rolldown, CJS output.** The fleet ships a **CJS bundle** built by rolldown
   (`format: 'cjs'`), even though source is ESM. Convert esbuild/tsup/tsc-emit to a
   `.config/repo/rolldown.config.mts` (or `rolldown.<variant>.config.mts`). Output at the
   canonical `build/<mode>/<platform-arch>/out/Final/` path. Skip for native-producer
   repos (they build artifacts, not a JS bundle) and private non-published repos.

8. **Build script** adopts the fleet build flow + canonical output path.

9. **Coding style.** Apply the `socket/*` rules: `function foo(){}` declarations (not
   const-arrows), `export` every top-level symbol, no `any`, `undefined` over `null`,
   `JSON.parse(JSON.stringify(x))` over structuredClone, `httpJson`/`httpText` from
   `@socketsecurity/lib/http-request`, `safeDelete` from `@socketsecurity/lib/fs`, lib
   `spawn`, `getDefaultLogger()` over `console.*`, no underscore-prefixed identifiers,
   alpha-sorted sibling lists. Run `pnpm run fix --all`, then hand-fix what autofix can't.

10. **socket-lib adoption.** Replace ad-hoc fs/http/process/logger/env with
    `@socketsecurity/lib/*` (or the `-stable` alias). Add the catalog dep + the
    `pnpm-workspace.yaml` `overrides:` `'@socketsecurity/lib': 'catalog:'` entry.

11. **@socketregistry/packageurl-js** — where the repo parses/handles `pkg:` PURLs,
    replace the bespoke parser with the fleet impl + catalog dep + override.

12. **repo/\* overlays.** Move genuinely repo-specific hooks/docs/scripts/config to the
    `repo/` tier: `.claude/hooks/repo/`, `docs/claude.md/repo/`, `scripts/repo/`,
    `.config/repo/` — so they survive the cascade and aren't fleet-canonical forks.

13. **CLAUDE.md.** Run `node scripts/repo/migrate-claude-md.mts --target <repo> --apply`
    — it parses the repo's existing CLAUDE.md, drops sections the fleet block now owns,
    keeps project-specific content under the `🏗️ <Repo>-Specific` postamble, and inserts
    the `BEGIN/END FLEET-CANONICAL` block.

14. **README → canonical skeleton.** Match `template/README.md`: 5 level-2 sections (Why
    this repo exists / Install / Usage / Development / License) + the badge row (Socket,
    CI, Coverage, Twitter @SocketSecurity, Bluesky @socket.dev) with placeholders filled:
    `<PUBLISHED_NAME>` (the npm name), `<REPO_SLUG>` (the GitHub repo), `<PCT>` (measured
    coverage). No `socket-wheelhouse` mentions, no sibling-relative script paths. Include
    the **light/dark Socket logo footer** after License — the `<picture>` block from
    `template/README.md` referencing `assets/socket-logo-dark.svg` (dark mode) +
    `assets/socket-logo-light.svg` (light mode). If the repo has an OLD logo block (a
    plain `<img>`, or broken `logo-white.png`/`logo-black.png` refs like socket-mcp's),
    REPLACE it with the canonical `<picture>` form.
    **Prerequisite — install the assets first.** The wordmark SVGs live in
    `OPTIONAL_IDENTICAL_FILES` (opt-in: the cascade only mirrors `assets/` when the dir
    already exists). A footer referencing absent assets is a BROKEN image (the exact bug
    in socket-mcp). So before adding the footer, create the repo's `assets/` dir and copy
    `socket-logo-{dark,light}.svg` (+ the `.png` fallbacks) from `template/assets/`, then
    re-run the cascade so the assets are tracked. Verify the srcset paths resolve to real
    files before committing.

15. **Dependency dedupe via overrides.** Add the repo's shared fleet deps to
    `pnpm-workspace.yaml` `overrides:` pinned to `catalog:` so the bundle collapses
    duplicate transitive copies. Version-range pins go in `pnpm-workspace.yaml`
    `overrides:`, NEVER `package.json` `pnpm.overrides`.

16. **Bundle trim.** For repos that ship a bundle, run the `trimming-bundle` skill —
    wires the rolldown stub plugin (`createLibStubPlugin`) + iterates stub → rebuild →
    test, keeping only stubs that pass.

17. **Setup installers.** Run the fleet setup toolchain so the repo's gates actually
    function: signing (`node .claude/hooks/fleet/setup-signing/install.mts`), git-hooks
    (`node scripts/fleet/install-git-hooks.mts`), security scanners
    (`node .claude/hooks/fleet/setup-claude-scanners/install.mts`).

18. **Verify GREEN.** `pnpm install`, then `pnpm run check --all` + `pnpm test` +
    `pnpm run build` must all pass. Fix what fails. Run
    `node scripts/repo/check/fleet-members-are-onboarded.mts` (from the wheelhouse) —
    no coherence FAIL, adoption-gap reports addressed. Do NOT proceed to land otherwise.

19. **Land.** Commit the conversion in fleet-clean commits — Conventional Commits,
    signed, surgical (`git commit -o <files>`, never `-A`). Register-side change
    (fleet-repos.json) commits in the wheelhouse; the repo-side conversion commits in the
    target. Push direct → PR only on rejection. For squash-history opt-in repos,
    consolidate per the `squashing-history` skill.

## Verification gate (perfectionist)
Onboarding is complete only when, on the target: `pnpm run check --all` passes,
`pnpm test` passes, `pnpm run build` produces the CJS bundle, AND the wheelhouse's
`fleet-members-are-onboarded` check reports zero coherence failures for the repo. A repo
that merely has the fleet files copied in is NOT onboarded.

## Reuse, don't reinvent
- Detection: `scripts/repo/check/fleet-members-are-onboarded.mts` exports.
- Cascade: `pnpm run onboard` / the `cascading-fleet` skill.
- CLAUDE.md migration: `scripts/repo/migrate-claude-md.mts`.
- Bundle trim: the `trimming-bundle` skill.
- History squash: the `squashing-history` skill.
- Marker validation: `readSocketWheelhouseConfig` from `scripts/repo/sync-scaffolding/`.
