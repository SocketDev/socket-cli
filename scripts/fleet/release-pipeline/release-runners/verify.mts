/**
 * @file The pre-approve verify runner + its registry-truth reconcile. The
 *   verify stage finds this package's staged entry and checks local pack sha1
 *   vs npm's staged shasum, with the extracted-contents fallback; on a pass it
 *   carries the release-asset checksums for the state stash. The registry-truth
 *   path verifies an ALREADY-LIVE version from PUBLIC reads when no npm auth is
 *   available — divergent bytes refuse, never a rubber stamp.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { hashTarball } from '../../lib/verify-release-hashes.mts'
import { describeNpmIdentity } from '../../publish-infra/npm/auth-identity.mts'
import { StageListAuthError } from '../../publish-infra/npm/shared.mts'
import { verifyStagedPlatformEntry } from '../../publish-infra/npm/staged-workspace.mts'
import { hasMachineBuiltPayload } from '../../publish-infra/npm/workspace-plan.mts'
import { resolveNpmWorkspaceLayout } from '../../publish-infra/npm/workspace.mts'
import { readPkg, resolveSeams } from '../seams.mts'

import type { StageListEntry } from '../../publish-infra/npm/shared.mts'
import type { RunnerSeams, StageOutcome } from '../seams.mts'
import type { ReleaseChecksums } from '../state.mts'

// ── stage 9: pre-approve verify ────────────────────────────────────────────

/**
 * Verify stage: the pre-approve integrity gate. Finds this package's staged
 * entry (`pnpm stage list --json`) and runs verifyStagedEntry — local pack
 * sha1 vs npm's staged shasum, with the extracted-contents fallback. A
 * mismatch fails loud; approve is unreachable until this passes. On a pass,
 * the outcome carries the release-asset checksums (sha1 + sha512 of the
 * verified local pack) for the state stash — the release stage creates the
 * immutable GH release WITH those assets in one shot, never uploading after
 * creation.
 */
export async function runVerifyStage(config: {
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
  targetVersion: string
}): Promise<StageOutcome> {
  const cfg = { __proto__: null, ...config } as typeof config
  const seams = resolveSeams(cfg.seams)
  if (cfg.dryRun) {
    return {
      detail: '[dry-run] nothing staged under dry-run; verify has no subject',
      status: 'deferred',
    }
  }
  const pkg = readPkg(cfg.cwd)
  let staged: StageListEntry[]
  try {
    staged = await seams.listStaged()
  } catch (e) {
    if (!(e instanceof StageListAuthError)) {
      throw e
    }
    // No npm auth: the staged listing has NO evidence either way — an
    // unauthenticated `pnpm stage list` parses as EMPTY. Recording that as
    // verify=failed "0 staged entries" is the 6.2.1 false negative. One
    // authenticated-source fallback exists: when the version is ALREADY LIVE
    // on the registry, PUBLIC reads (packument digests + published tarball)
    // verify the bytes without local auth. Otherwise the honest outcome is
    // `blocked`, stops the run, never satisfies a resume — a staged-but-
    // unpublished entry's digest is only visible authenticated.
    const truth = await verifyAgainstRegistry({
      cwd: cfg.cwd,
      seams: cfg.seams,
      targetVersion: cfg.targetVersion,
    })
    if (truth.status === 'match') {
      return {
        detail: `${truth.detail} — verified from PUBLIC registry reads (no npm auth needed)`,
        releaseChecksums: truth.releaseChecksums,
        status: 'passed',
      }
    }
    if (truth.status === 'mismatch') {
      // The version IS observable without auth and the bytes diverge (or
      // can't be compared) — that is a real verify failure, not missing
      // evidence.
      return {
        detail:
          `registry-truth verify FAILED for ${pkg.name}@${cfg.targetVersion}.\n` +
          `  Where: ${truth.detail}\n` +
          `  Fix: never release divergent bytes — reconcile the tree with the published content, then re-run.`,
        status: 'failed',
      }
    }
    return {
      detail:
        `staged-entry listing is UNAUTHENTICATED — verify has no evidence either way.\n` +
        `  Where: ${errorMessage(e)}\n` +
        `  Not recording a verify verdict: a missing local token is not an integrity failure ` +
        `(and ${pkg.name}@${cfg.targetVersion} is not live on the registry, so no public fallback exists).\n` +
        `  Fix: authenticate npm (npm login / browser web-OTP), then re-run the verify stage.`,
      status: 'blocked',
    }
  }
  const entry = staged.find(
    e => e.name === pkg.name && e.version === cfg.targetVersion,
  )
  if (!entry) {
    // Staged entries are maintainer-visible: a wrong-account login reads an
    // empty list even when the stage succeeded, so the failure names WHO was
    // looking, the wrong-user trap that cost a real debugging session.
    // Seamed, like every other effect here — tests stub it.
    const identity = await seams.identityFor(pkg.name)
    return {
      detail:
        `no staged entry for ${pkg.name}@${cfg.targetVersion}.\n` +
        `  Where: pnpm stage list --json (${staged.length} entr${staged.length === 1 ? 'y' : 'ies'} total)\n` +
        describeNpmIdentity(identity, pkg.name)
          .map(line => `  ${line}`)
          .join('\n') +
        `\n  Fix: run the stage-publish stage first, and check npm auth (pnpm stage list).`,
      status: 'failed',
    }
  }
  const ok = await seams.verifyEntry(entry)
  if (!ok) {
    return {
      detail:
        `pre-approve verify FAILED for ${pkg.name}@${cfg.targetVersion} (see the gate's log above).\n` +
        `  Fix: reject the staged upload (node scripts/fleet/npm-web-auth.mts stage reject ${entry.stageId}) and re-stage — never approve divergent bytes.`,
      status: 'failed',
    }
  }
  // Compute the release-asset checksums NOW, over the verified local pack —
  // the release stage attaches these exact bytes to the immutable release.
  const tarballName = `${pkg.name.replace(/^@/, '').replace('/', '-')}-${cfg.targetVersion}.tgz`
  let tarballPath: string | undefined = path.join(cfg.cwd, tarballName)
  if (!existsSync(tarballPath)) {
    // The verify gate's internal pack usually leaves the tarball in cwd; a
    // custom verify seam may not — pack once more.
    tarballPath = await seams.packTarball(pkg.name, cfg.targetVersion)
  }
  if (!tarballPath || !existsSync(tarballPath)) {
    return {
      detail:
        `verified ${pkg.name}@${cfg.targetVersion}, but no tarball to checksum for the release assets.\n` +
        `  Where: expected ${tarballName} in ${cfg.cwd} (or a successful re-pack).\n` +
        `  Fix: fix the pack, re-run — the release stage refuses without stashed checksums-backed assets.`,
      status: 'failed',
    }
  }
  const digest = hashTarball(tarballPath)
  return {
    detail: `staged shasum verified for ${pkg.name}@${cfg.targetVersion} (stageId ${entry.stageId}); release checksums stashed (sha1 ${digest.shasum})`,
    releaseChecksums: {
      sha1: digest.shasum,
      sha512: digest.integrity.replace(/^sha512-/, ''),
      tarballName,
      version: cfg.targetVersion,
    },
    status: 'passed',
  }
}

// ── registry truth, already-published reconcile ───────────────────────────

/**
 * What a registry-truth verification concluded. `match` carries the
 * release-asset checksums computed over the verified local re-pack, so the
 * caller can mint a verify receipt exactly the way runVerifyStage does.
 */
export type RegistryTruth =
  | { detail: string; releaseChecksums: ReleaseChecksums; status: 'match' }
  | { detail: string; status: 'mismatch' }
  | { detail: string; status: 'not-live' }

/**
 * Verify a version that is ALREADY LIVE on the registry from PUBLIC reads —
 * no npm auth. Re-packs at the bump commit (package.json must read the
 * target version) and compares against the packument `dist` digests. The
 * gzip envelope is platform-sensitive — a CI-published tarball and a local
 * re-pack legitimately wrap identical contents differently — so a digest
 * mismatch falls back to downloading the published tarball and comparing
 * EXTRACTED CONTENTS, the same honest axis verifyStagedEntry uses. This is
 * the sanctioned reconcile evidence for a pipeline whose verify/approve
 * receipts went missing after the version already shipped (the 6.2.1
 * strand): registry truth, never a rubber stamp — divergent bytes refuse.
 */
export async function verifyAgainstRegistry(config: {
  cwd: string
  seams?: RunnerSeams | undefined
  targetVersion: string
}): Promise<RegistryTruth> {
  const cfg = { __proto__: null, ...config } as typeof config
  const seams = resolveSeams(cfg.seams)
  const pkg = readPkg(cfg.cwd)
  const dist = await seams.fetchRegistryDist(pkg.name)
  const live = dist[cfg.targetVersion]
  if (!live) {
    return {
      detail: `${pkg.name}@${cfg.targetVersion} is not on the registry (public packument read)`,
      status: 'not-live',
    }
  }
  if (pkg.version !== cfg.targetVersion) {
    return {
      detail:
        `package.json reads ${pkg.version}, not ${cfg.targetVersion} — the re-pack must run ` +
        `at the bump commit so the compared bytes are the published content`,
      status: 'mismatch',
    }
  }
  if (!live.shasum && !live.integrity) {
    return {
      detail: `the packument for ${pkg.name}@${cfg.targetVersion} exposes no dist.shasum/integrity to compare against`,
      status: 'mismatch',
    }
  }
  // A machine-built payload (.wasm/.node) has no local byte-twin — the
  // published artifact came from the CI build, so a local re-pack ALWAYS
  // diverges on those bytes. The honest axis is STRUCTURAL, on the published
  // tarball itself, the same gate staged platform entries use, and the
  // release checksums hash the downloaded registry bytes — the content the
  // tag marks. Routed for workspace members; a plain single-package repo has
  // no generated machine-built subject today.
  const layout = resolveNpmWorkspaceLayout(cfg.cwd)
  const member =
    layout.kind === 'multi'
      ? layout.packages.find(p => p.name === pkg.name)
      : undefined
  if (member && (member.platform || hasMachineBuiltPayload(member.manifest))) {
    const published = await seams.downloadRegistryTarball(
      pkg.name,
      cfg.targetVersion,
    )
    if (!published) {
      return {
        detail: `the published tarball for ${pkg.name}@${cfg.targetVersion} could not be downloaded for the structural verify`,
        status: 'mismatch',
      }
    }
    const structuralOk = await verifyStagedPlatformEntry(
      {
        name: pkg.name,
        stageId: 'published-registry-tarball',
        version: cfg.targetVersion,
      },
      member,
      { downloadStagedTarball: () => Promise.resolve(published) },
    )
    if (!structuralOk) {
      return {
        detail: `the published tarball for ${pkg.name}@${cfg.targetVersion} failed the structural payload verify (see the gate's log above)`,
        status: 'mismatch',
      }
    }
    const publishedDigest = hashTarball(published)
    return {
      detail:
        `registry truth for ${pkg.name}@${cfg.targetVersion}: machine-built ` +
        `payload verified structurally on the published tarball (sha1 ${publishedDigest.shasum})`,
      releaseChecksums: {
        sha1: publishedDigest.shasum,
        sha512: publishedDigest.integrity.replace(/^sha512-/, ''),
        tarballName: path.basename(published),
        version: cfg.targetVersion,
      },
      status: 'match',
    }
  }
  const tarballPath = await seams.packTarball(pkg.name, cfg.targetVersion)
  if (!tarballPath || !existsSync(tarballPath)) {
    return {
      detail: `could not re-pack ${pkg.name}@${cfg.targetVersion} locally for the registry compare`,
      status: 'mismatch',
    }
  }
  const digest = hashTarball(tarballPath)
  const digestMatch =
    (live.shasum !== undefined && digest.shasum === live.shasum) ||
    (live.integrity !== undefined && digest.integrity === live.integrity)
  let evidence: string
  if (digestMatch) {
    evidence = `local re-pack sha1 ${digest.shasum} matches the packument dist digest`
  } else {
    // Envelope-sensitive digests differ across platforms; compare what
    // actually ships — the extracted files — against the published tarball.
    const published = await seams.downloadRegistryTarball(
      pkg.name,
      cfg.targetVersion,
    )
    if (!published) {
      return {
        detail:
          `digest mismatch (local sha1 ${digest.shasum} vs registry ${live.shasum ?? live.integrity}) ` +
          `AND the published tarball could not be downloaded for a content compare`,
        status: 'mismatch',
      }
    }
    const contents = await seams.compareTarballContents(published, tarballPath)
    if (!contents.equal) {
      return {
        detail:
          `published contents DIVERGE from the local re-pack: ${contents.detail} ` +
          `(local sha1 ${digest.shasum}, registry ${live.shasum ?? live.integrity})`,
        status: 'mismatch',
      }
    }
    evidence = `contents byte-identical to the published tarball (${contents.detail}); only the gzip envelope differs`
  }
  return {
    detail: `registry truth for ${pkg.name}@${cfg.targetVersion}: ${evidence}`,
    releaseChecksums: {
      sha1: digest.shasum,
      sha512: digest.integrity.replace(/^sha512-/, ''),
      tarballName: path.basename(tarballPath),
      version: cfg.targetVersion,
    },
    status: 'match',
  }
}
