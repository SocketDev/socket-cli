/**
 * @file `--staged` / `--direct` publish modes, and the pre-approve tarball
 *   pack + integrity-gate helpers `--approve` verifies against before
 *   promoting a staged package to public.
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type {
  HashSource,
  TarballDigest,
} from '../../lib/verify-release-hashes.mts'
import {
  compareHashSources,
  hashTarball,
} from '../../lib/verify-release-hashes.mts'
import { releaseBehindLiveGate } from '../release.mts'
import { logger, rootPath, runCapture, runInherit } from '../shared.mts'
import { withPinnedReadme } from '../pin-readme.mts'
import { withPrunedPackManifest } from './pack-manifest.mts'
import { isAlreadyPublished } from './registry.mts'
import type { StageListEntry } from './shared.mts'
import { isStagingExpected } from './shared.mts'
import { resolveReleaseSubject } from '../../_shared/release-subject.mts'
import { tarExecutable } from '../../_shared/tar-executable.mts'

import type { ReleaseSubject } from '../../_shared/release-subject.mts'

// The README-pin bracket target for a publish subject: the pinned README is
// the one that PACKS — the subject's, not the repo root's when
// publishConfig.directory redirects the publish. Shared by runStaged,
// runDirect, and the approve-time verify pack so every pack of one release
// pins identical bytes.
function pinTargetFor(subject: ReleaseSubject): {
  readmePath: string
  repository: string | { url?: string | undefined } | undefined
  rootPath: string
  version: string
} {
  return {
    readmePath: path.relative(subject.rootPath, subject.readmePath),
    repository: subject.repository,
    rootPath: subject.rootPath,
    version: subject.version,
  }
}

/**
 * `--staged` mode: stage this package's tarball.
 *
 * Reads the local package.json for name + version, refuses to stage an
 * already-published version (npm rejects republishes outright; we surface the
 * error before the network call). Runs `pnpm stage publish` with --provenance
 * when GITHUB_ACTIONS is set so the OIDC token gets embedded into the
 * provenance attestation.
 */
export async function runStaged(
  tag: string,
  config: { dryRun: boolean },
): Promise<void> {
  const { dryRun } = { __proto__: null, ...config } as typeof config
  const pkg = resolveReleaseSubject(rootPath)
  logger.log(
    `Staging ${pkg.name}@${pkg.version} (tag=${tag})${dryRun ? ' [dry-run]' : ''}`,
  )

  if (await isAlreadyPublished(pkg.name, pkg.version)) {
    logger.fail(
      `${pkg.name}@${pkg.version} is already published. Bump the version and try again.`,
    )
    process.exitCode = 1
    return
  }

  const args = [
    'stage',
    'publish',
    '--access',
    'public',
    '--tag',
    tag,
    '--no-git-checks',
    '--ignore-scripts',
  ]
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    args.push('--provenance')
  }
  if (dryRun) {
    // pnpm stage publish --dry-run does everything except the actual
    // upload; surfaces packing errors + manifest validation without
    // touching the registry.
    args.push('--dry-run')
  }
  // Pin the SUBJECT README's relative asset URLs to the release tag for the
  // packed tarball only (restored right after) so the npm page's badge is
  // immutable + matches this version instead of a moving HEAD ref, and prune
  // repo-only lifecycle scripts from the manifest that packs. The same
  // brackets wrap the --approve verify pack (defaultPackTarball) so the
  // integrity gate sees identical bytes.
  const code = await withPinnedReadme(pinTargetFor(pkg), () =>
    withPrunedPackManifest(pkg.dir, () => runInherit('pnpm', args, rootPath)),
  )
  if (code !== 0) {
    logger.fail(`pnpm stage publish exited ${code}`)
    process.exitCode = code
    return
  }
  if (dryRun) {
    logger.success(
      `Dry-run complete for ${pkg.name}@${pkg.version}. Re-run without --dry-run to upload.`,
    )
  } else {
    logger.success(
      `Staged ${pkg.name}@${pkg.version}. Run \`pnpm run publish -- --approve\` locally to promote — the git tag and GitHub release are created at approve time, when the package goes public.`,
    )
  }
}

/**
 * `--direct` mode: classic single-step `pnpm publish` — upload + make public in
 * one call, no stage/approve. Escape hatch for environments where the stage
 * endpoint is unreachable. Adds `--provenance` automatically when
 * GITHUB_ACTIONS is set so the OIDC token still embeds into the provenance
 * attestation.
 *
 * Refuses to run when the package's prior versions used staging (per the
 * packument's `_npmUser.approver` signal). Downgrading erases the trust signal
 * from the package's history. Operators who hit the refusal should either use
 * `--staged` (preferred) or accept the trust regression by removing the prior
 * staged-published versions from the registry first.
 */
export async function runDirect(
  tag: string,
  config: { dryRun: boolean },
): Promise<void> {
  const { dryRun } = { __proto__: null, ...config } as typeof config
  const pkg = resolveReleaseSubject(rootPath)
  logger.log(
    `Direct-publishing ${pkg.name}@${pkg.version} (tag=${tag})${dryRun ? ' [dry-run]' : ''}`,
  )

  if (await isAlreadyPublished(pkg.name, pkg.version)) {
    logger.fail(
      `${pkg.name}@${pkg.version} is already published. Bump the version and try again.`,
    )
    process.exitCode = 1
    return
  }

  // Trust-downgrade refusal: if any prior version of this package was
  // staged-published (carries `_npmUser.approver`), --direct would erase
  // that trust signal. Force the operator to use --staged or make the
  // downgrade explicit. Skips on first-publish packages (no prior
  // versions) and on network failure (which we treat as "unknown").
  if (await isStagingExpected(pkg.name)) {
    logger.fail(
      `${pkg.name} has prior staged-published versions (per registry _npmUser.approver). ` +
        `--direct would downgrade the trust signal. Use --staged instead, or ` +
        `(rare) remove the prior staged-published versions first.`,
    )
    process.exitCode = 1
    return
  }

  const args = [
    'publish',
    '--access',
    'public',
    '--tag',
    tag,
    '--no-git-checks',
    '--ignore-scripts',
  ]
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    args.push('--provenance')
  }
  if (dryRun) {
    args.push('--dry-run')
  }
  // Pin the SUBJECT README to the release tag + prune repo-only lifecycle
  // scripts for the published tarball only (see runStaged).
  const code = await withPinnedReadme(pinTargetFor(pkg), () =>
    withPrunedPackManifest(pkg.dir, () => runInherit('pnpm', args, rootPath)),
  )
  if (code !== 0) {
    logger.fail(`pnpm publish exited ${code}`)
    process.exitCode = code
    return
  }
  if (dryRun) {
    logger.success(
      `Dry-run complete for ${pkg.name}@${pkg.version}. Re-run without --dry-run to publish.`,
    )
  } else {
    logger.success(`Published ${pkg.name}@${pkg.version} directly.`)
    // The tag + immutable release are the LAST markers: cut them only once
    // the version is actually resolvable on the registry.
    const released = await releaseBehindLiveGate({
      isLive: () => isAlreadyPublished(pkg.name, pkg.version),
      pkg: { name: pkg.name, version: pkg.version },
      registry: 'npm',
    })
    if (!released) {
      process.exitCode = 1
    }
  }
}

/**
 * Pack `<name>@<version>` from the repo root and return the tarball path, or
 * undefined if the pack failed / produced no file. pnpm pack names the tarball
 * `<scope-stripped-name>-<version>.tgz` (e.g. @socketsecurity/lib@6.0.9 →
 * socketsecurity-lib-6.0.9.tgz) — from the PUBLISH SUBJECT's manifest, and
 * writes it into the subject directory when publishConfig.directory redirects
 * the publish. `root` is injectable for tests.
 */
export async function defaultPackTarball(
  name: string,
  version: string,
  root: string = rootPath,
): Promise<string | undefined> {
  // Refuse a cross-repo pack outright: the stage list is account-scoped, so a
  // caller can hand this an entry staged from ANOTHER repo. Packing it here
  // would pin the README against the wrong manifest — this repo's repository
  // slug with the foreign entry's version — before failing anyway on the
  // tarball-name lookup. Fail loud, with zero pack side effects. The name
  // check runs against the SUBJECT manifest, so a redirected monorepo's
  // private root name never trips it.
  const subject = resolveReleaseSubject(root)
  if (subject.name !== name) {
    logger.fail(
      `Refusing to pack ${name}@${version} from ${root}: this repo's ` +
        `package is ${subject.name}. A cross-repo pack would pin the README ` +
        `against the wrong repository/version. Run the publish flow from ` +
        `${name}'s own repo.`,
    )
    return undefined
  }
  // Same README-pin + manifest-prune brackets as runStaged, so the
  // approve-time verify pack is byte-identical to the staged tarball (the
  // integrity gate compares them).
  const packed = await withPinnedReadme(
    { ...pinTargetFor(subject), version },
    () =>
      withPrunedPackManifest(subject.dir, () =>
        runCapture('pnpm', ['pack'], root),
      ),
  )
  const tarballName = `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`
  // pnpm pack writes into the subject directory under a publishConfig
  // redirect; probe there first, then the root for belt-and-braces.
  for (const dir of [subject.packDir, root]) {
    const tarballPath = path.join(dir, tarballName)
    if (packed.code === 0 && existsSync(tarballPath)) {
      return tarballPath
    }
  }
  return undefined
}

/**
 * Download the staged tarball for `stageId` into a fresh temp dir and return
 * its path (undefined on failure). The download endpoint requires the same
 * npm auth as the rest of the stage API.
 */
export async function defaultDownloadStagedTarball(
  stageId: string,
): Promise<string | undefined> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-staged-dl-'))
  const dl = await runCapture('pnpm', ['stage', 'download', stageId], tmpDir)
  if (dl.code !== 0) {
    return undefined
  }
  const entries = await fs.readdir(tmpDir)
  const tgz = entries.find(e => e.endsWith('.tgz'))
  return tgz ? path.join(tmpDir, tgz) : undefined
}

// Relative path → sha1-of-content for every file under `dir` (sorted walk).
async function hashDirContents(dir: string): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const entries = await fs.readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    const abs = path.join(entry.parentPath, entry.name)
    const rel = normalizePath(path.relative(dir, abs))
    // eslint-disable-next-line no-await-in-loop
    const bytes = await fs.readFile(abs)
    result.set(rel, crypto.createHash('sha1').update(bytes).digest('hex'))
  }
  return result
}

/**
 * Compare two tarballs by EXTRACTED CONTENT (per-file sha1 over relative
 * paths). The tarball-level sha1 embeds the gzip envelope — platform + tool
 * metadata that legitimately differs between CI (linux) and a local pack
 * (macOS) even when every shipped byte is identical — so content equality is
 * the honest integrity axis. Returns a human-readable detail on mismatch.
 */
export async function compareExtractedTarballs(
  tarA: string,
  tarB: string,
): Promise<{ equal: boolean; detail: string }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-tar-cmp-'))
  try {
    const dirA = path.join(tmpDir, 'a')
    const dirB = path.join(tmpDir, 'b')
    await fs.mkdir(dirA)
    await fs.mkdir(dirB)
    for (const [tar, dir] of [
      [tarA, dirA],
      [tarB, dirB],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop
      const untar = await runCapture(
        tarExecutable(),
        ['-xzf', tar, '-C', dir],
        tmpDir,
      )
      if (untar.code !== 0) {
        return { detail: `tar -xzf ${tar} exited ${untar.code}`, equal: false }
      }
    }
    const hashesA = await hashDirContents(dirA)
    const hashesB = await hashDirContents(dirB)
    const diffs: string[] = []
    for (const [rel, entryHash] of hashesA) {
      const other = hashesB.get(rel)
      if (other === undefined) {
        diffs.push(`only in first: ${rel}`)
      } else if (other !== entryHash) {
        diffs.push(`content differs: ${rel}`)
      }
    }
    for (const rel of hashesB.keys()) {
      if (!hashesA.has(rel)) {
        diffs.push(`only in second: ${rel}`)
      }
    }
    return diffs.length === 0
      ? { detail: `${hashesA.size} file(s) byte-identical`, equal: true }
      : { detail: diffs.slice(0, 10).join('; '), equal: false }
  } finally {
    await safeDelete(tmpDir)
  }
}

/**
 * Pre-approve integrity gate. Packs the tarball locally and asserts its sha1
 * equals the shasum npm recorded when the tarball was staged — run BEFORE
 * `pnpm stage approve` (the 2FA / OAuth promote) so a divergent artifact never
 * goes public. Two-source comparison (local pack + npm staging); the
 * GitHub-asset compare + `gh attestation verify` are out of scope here (no
 * release exists pre-approve — ensureTagAndRelease runs post-approve). Fails
 * LOUD and returns false on any mismatch OR when the staged shasum can't be
 * resolved — the caller drops the entry. Never returns true on missing
 * evidence. Tarball sha1s embed the gzip envelope (platform metadata that
 * differs between CI linux packs and local macOS packs), so a sha1 mismatch
 * falls back to downloading the staged tarball and comparing EXTRACTED
 * CONTENTS per-file — equality there is the honest integrity axis. `pack`,
 * `hashLocalTarball`, and `downloadStagedTarball` are injectable for tests.
 */
export async function verifyStagedEntry(
  entry: StageListEntry,
  options?:
    | {
        downloadStagedTarball?:
          | ((stageId: string) => Promise<string | undefined>)
          | undefined
        hashLocalTarball?: ((filePath: string) => TarballDigest) | undefined
        packTarball?:
          | ((name: string, version: string) => Promise<string | undefined>)
          | undefined
      }
    | undefined,
): Promise<boolean> {
  const opts = { __proto__: null, ...options } as {
    downloadStagedTarball?:
      | ((stageId: string) => Promise<string | undefined>)
      | undefined
    hashLocalTarball?: ((filePath: string) => TarballDigest) | undefined
    packTarball?:
      | ((name: string, version: string) => Promise<string | undefined>)
      | undefined
  }
  const hashLocal = opts.hashLocalTarball ?? hashTarball
  const packTarball = opts.packTarball ?? defaultPackTarball
  const downloadStaged =
    opts.downloadStagedTarball ?? defaultDownloadStagedTarball
  const { name, shasum: stagedShasum, stageId, version } = entry
  if (!name || !version || !stageId) {
    logger.fail(
      `Pre-approve verify: staged entry is missing name/version/stageId.\n` +
        `  Where: ${JSON.stringify(entry)}\n` +
        `  Fix: re-stage the package; do not approve an entry the registry can't identify.`,
    )
    return false
  }
  if (!stagedShasum) {
    logger.fail(
      `Pre-approve verify: no server-side shasum for ${name}@${version}.\n` +
        `  Where: pnpm stage list --json (stageId ${stageId}) exposed no shasum field.\n` +
        `  Saw vs wanted: an entry with no digest; wanted npm's staged sha1 to compare against the local pack.\n` +
        `  Fix: reject + re-stage (pnpm stage reject ${stageId}); if pnpm's stage-list shape changed, update readStagedShasum. Refusing to approve unverified bytes.`,
    )
    return false
  }
  const tarballPath = await packTarball(name, version)
  if (!tarballPath) {
    logger.fail(
      `Pre-approve verify: could not pack ${name}@${version} locally.\n` +
        `  Where: pnpm pack in ${rootPath}\n` +
        `  Saw vs wanted: no local tarball; wanted one to hash against npm's staged shasum.\n` +
        `  Fix: fix the pack (check the build), then re-run --approve. Not approving without a local comparison.`,
    )
    return false
  }
  const local = hashLocal(tarballPath)
  const sources: HashSource[] = [
    { integrity: local.integrity, label: 'local pack', shasum: local.shasum },
    { integrity: undefined, label: 'npm staging', shasum: stagedShasum },
  ]
  const comparison = compareHashSources(sources)
  if (!comparison.ok) {
    // The tarball sha1 covers the gzip envelope too — CI (linux) and a local
    // pack (macOS) legitimately wrap identical contents differently. Fall
    // back to comparing what actually ships: the extracted files.
    logger.log(
      `Tarball sha1 differs for ${name}@${version} (envelope is platform-` +
        `sensitive); downloading the staged tarball to compare contents…`,
    )
    const stagedTarball = await downloadStaged(stageId)
    if (!stagedTarball) {
      logger.fail(
        `Pre-approve verify FAILED for ${name}@${version}.\n` +
          `  Where: tarball sha1 mismatch AND the staged tarball could not be downloaded for a content compare.\n` +
          `    local pack:  ${local.shasum}\n` +
          `    npm staging: ${stagedShasum}\n` +
          `  Fix: check npm auth (pnpm stage download ${stageId}), or reject + re-stage. Not approving unverified bytes.`,
      )
      return false
    }
    const contents = await compareExtractedTarballs(stagedTarball, tarballPath)
    if (!contents.equal) {
      logger.fail(
        `Pre-approve verify FAILED for ${name}@${version}.\n` +
          `  Where: comparing staged vs local pack EXTRACTED CONTENTS (after tarball sha1 mismatch).\n` +
          `  Saw vs wanted: ${contents.detail}\n` +
          `    local pack:  ${local.shasum}\n` +
          `    npm staging: ${stagedShasum}\n` +
          `  Fix: reject the staged publish (pnpm stage reject ${stageId}) and re-stage — never approve a divergent artifact.`,
      )
      return false
    }
    logger.success(
      `Verified ${name}@${version}: staged contents byte-identical to the local pack (${contents.detail}); only the gzip envelope differs.`,
    )
    return true
  }
  logger.log(
    `Verified ${name}@${version}: local pack sha1 matches npm staging (${comparison.algorithm}).`,
  )
  return true
}
