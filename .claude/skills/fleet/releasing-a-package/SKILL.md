---
name: releasing-a-package
description: Release a single-package fleet repo: pre-bump, changelog, version tag, and staged publish.
model: claude-sonnet-4-6
user-invocable: true
allowed-tools: AskUserQuestion, Bash(git:*), Bash(node:*), Bash(pnpm run:*), Edit, Read
---

# releasing-a-package

Ship one new version of a single-package fleet repo. The publish engine is
`scripts/fleet/npm-publish.mts` — a staged upload in CI under the OIDC trusted-publisher
token, then a human 2FA approve locally. This skill is the human-facing walkthrough; the
bump-order rules live in [`version-bumps`](../../../../docs/agents.md/fleet/version-bumps.md)
and the Conventional-Commit shape in
[`commit-cadence-format`](../../../../docs/agents.md/fleet/commit-cadence-format.md).

**Staged-publish split is mandatory.** The stage upload uses a CI OIDC token; the approve
needs human 2FA. They are separate steps on purpose — fusing them would either leak the OTP
into CI logs or require a human at the CI keyboard. Nothing is public until `--approve` runs;
a botched stage upload is rescued server-side with `pnpm stage reject`.

## Flow

1. **Pre-bump wave.** Refresh every derived artifact so the bump commit is clean and the gate
   is green BEFORE the bump: build, coverage badge, lockfile. End on `pnpm run check --all`
   green. Detail + the full artifact list: [`version-bumps`](../../../../docs/agents.md/fleet/version-bumps.md).
2. **Bump — scripted, never by hand.** `node scripts/fleet/bump.mts` derives the next version
   from the Conventional Commits since the last `v<semver>` tag (feat → minor, fix/perf →
   patch, breaking → major), GENERATES the `## X.Y.Z` CHANGELOG entry from those same commits,
   writes `package.json` + `CHANGELOG.md`, and commits `chore: bump version to X.Y.Z`. Preview
   with `node scripts/fleet/bump.mts --dry-run` first. The level is derived from the commit
   types — to override when they don't capture intent (a breaking change committed without `!`,
   or a milestone major), pass `--release-as <major|minor|patch>` (a publish-workflow dropdown
   can supply it). It is an explicit human decision, never AI-inferred. Do NOT hand-edit
   `CHANGELOG.md` — a
   hand-written entry drifts from the tag — the 6.0.x failure mode; the
   `changelog-is-commit-derived` check rejects a pending entry that doesn't match its commits.
   The tag is created later, at publish/approve time — `bump.mts` does not tag.
3. **Push the bump.**
4. **CI stages.** Trigger the publish workflow; it runs `node scripts/fleet/npm-publish.mts
   --staged` (auto-`--provenance` under `GITHUB_ACTIONS`). Inspect the staged upload;
   `pnpm stage reject` rescues a wrong file / checksum / version before anything is public.
5. **Approve — human, local, real terminal.** Run `node scripts/fleet/npm-publish.mts --approve`,
   multi-select the staged package(s), enter one shared 2FA OTP. Leaving the prompt empty
   triggers pnpm's web-OTP flow (opens npmjs.com in a browser); or pass `--otp <code>`. This is
   the step that makes the package public and creates the `vX.Y.Z` tag + GitHub release.
6. **Verify.** `node scripts/fleet/check/provenance-is-attested.mts <name>` — confirm the new
   version shows provenance ✓ and trustedPublisher ✓.

## Human stops

- **Before pushing the bump:** `pnpm run check --all` is green and `bump.mts --dry-run` showed
  the version + entry you expect. CI publishes from this commit.
- **Before `--approve`:** you are at a real terminal. The OTP step is interactive — never run
  it headless or in CI.

## If the bump is no longer the tip

Work landed on top of the bump commit → do NOT cut a fresh version. Use
[`reordering-release-bump`](../reordering-release-bump/SKILL.md) to relocate the existing bump
to the tip and repoint `vX.Y.Z` (tree-identical, zero work lost).
