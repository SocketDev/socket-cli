/**
 * @file Staged and direct publish modes, and the pre-approve tarball
 *   pack + integrity-gate helpers `--approve` verifies against before
 *   promoting a staged package to public.
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
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
import { resolvePnpmCommand } from '../../process/pnpm-command.mts'
import { releaseBehindLiveGate } from '../release.mts'
import { logger, rootPath, runCapture } from '../shared.mts'
import { withPinnedReadme } from '../pin-readme.mts'
import { withPrunedPackManifest } from './pack-manifest.mts'
import { verifyPackedPayload } from './pack-preflight.mts'
import { uploadNpmPackage } from './publish-command.mts'
import { diagnosePublishFailure } from './publish-failure.mts'
import { fetchPublishedState, isAlreadyPublished } from './registry.mts'
import { normalizeBundleRegionComments } from './region-comments.mts'
import type { StageListEntry } from './shared.mts'
import {
  isStagingExpected,
  logNpmApproveHandoff,
  matchNpmStageUploadEvidence,
} from './shared.mts'
import type { NpmStageEvidenceRecorder } from './shared.mts'
import { resolveNpmStageCommand } from './stage-command.mts'
import {
  packWorkspaceMemberTarball,
  runWorkspacePublish,
  verifyStagedPlatformEntry,
} from './staged-workspace.mts'
import { hasMachineBuiltPayload } from './workspace-plan.mts'
import { resolveNpmWorkspaceLayout } from './workspace.mts'
import { resolveReleaseSubject } from '../../release/subject.mts'
import { tarExecutable } from '../../archives/tar-executable.mts'

import type { NpmUploadResult } from './publish-command.mts'
import type { WorkspaceManifestShape } from './workspace.mts'
import type { ReleaseSubject } from '../../release/subject.mts'

// The upload result a pack-preflight failure leaves behind: the command never
// ran, so there is no exit code to report and no output to read. `postureOk`
// is true because nothing was uploaded — the preflight failure is its own
// loud stop, and a false here would report a credential problem that does not
// exist.
const DID_NOT_UPLOAD: NpmUploadResult = {
  code: 0,
  output: '',
  postureOk: true,
  ran: false,
}

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

export type StageDecision = 'already-published' | 'stage'

/**
 * The verify-BEFORE-stage decision: should a target version be STAGED, or is it
 * ALREADY PUBLISHED? Pure so it is unit-tested without the network.
 */
export function stageAction(config: {
  publishedLatest: string | undefined
  publishedVersions: readonly string[]
  target: string
}): StageDecision {
  const { publishedLatest, publishedVersions, target } = {
    __proto__: null,
    ...config,
  } as typeof config
  const published =
    target === publishedLatest || publishedVersions.includes(target)
  return published ? 'already-published' : 'stage'
}

/**
 * Staged upload mode: stage this package's tarball.
 *
 * Reads the local package.json for name + version, refuses to stage an
 * already-published version (npm rejects republishes outright; we surface the
 * error before the network call). Runs `pnpm stage publish` with --provenance
 * when GITHUB_ACTIONS is set AND the source repository is public
 * (provenanceAllowed) so the OIDC token gets embedded into the provenance
 * attestation; a private-repo run skips the flag loudly instead of hitting
 * npm's E422 sigstore-visibility rejection.
 */
export async function runStaged(
  tag: string,
  config: {
    dryRun: boolean
    tarballs?: ReadonlyMap<string, string> | undefined
    onStageUploaded?: NpmStageEvidenceRecorder | undefined
  },
): Promise<void> {
  const { dryRun } = { __proto__: null, ...config } as typeof config
  // Multi-package workspace, decmpfs, stuie: the workspace runner publishes
  // every member in dependency order behind the lockstep + hollow gates.
  // Single-package repos take the identical-to-before subject path below.
  const layout = resolveNpmWorkspaceLayout(rootPath)
  if (layout.kind === 'multi') {
    await runWorkspacePublish('staged', tag, layout, {
      dryRun,
      tarballs: config.tarballs,
      onStageUploaded: config.onStageUploaded,
    })
    return
  }
  const pkg = resolveReleaseSubject(rootPath)
  logger.log(
    `Staging ${pkg.name}@${pkg.version} (tag=${tag})${dryRun ? ' [dry-run]' : ''}`,
  )

  const published = await fetchPublishedState(pkg.name)
  if (
    stageAction({
      publishedLatest: published.latest,
      publishedVersions: published.versions,
      target: pkg.version,
    }) === 'already-published'
  ) {
    logger.success(
      `${pkg.name}@${pkg.version} already published — nothing to stage; ` +
        `start a new release to stage another version.`,
    )
    return
  }

  // Pin the SUBJECT README's relative asset URLs to the release tag for the
  // packed tarball only, restored right after, so the npm page's badge is
  // immutable + matches this version instead of a moving HEAD ref, and prune
  // repo-only lifecycle scripts from the manifest that packs. The same
  // brackets wrap the --approve verify pack (defaultPackTarball) so the
  // integrity gate sees identical bytes. The pack preflight runs INSIDE the
  // brackets too — the bytes it inspects are the bytes the stage command
  // uploads — and a tarball missing any declared payload file stops the
  // publish before the command runs.
  const reservedTarball = config.tarballs?.get(pkg.name)
  if (config.tarballs && !reservedTarball) {
    throw new Error(
      `Missing reserved tarball for ${pkg.name}; rebuild the release reservation before staging.`,
    )
  }
  const tarball =
    reservedTarball ?? (await defaultPackTarball(pkg.name, pkg.version))
  if (!tarball) {
    throw new Error(`Cannot pack ${pkg.name}@${pkg.version} before staging.`)
  }
  const subjectManifest = JSON.parse(
    readFileSync(pkg.manifestPath, 'utf8'),
  ) as WorkspaceManifestShape
  let preflightOk = true
  let staged: NpmUploadResult = DID_NOT_UPLOAD
  let code: number
  try {
    code = await withPinnedReadme(pinTargetFor(pkg), () =>
      withPrunedPackManifest(pkg.dir, async () => {
        preflightOk = await verifyPackedPayload({
          dir: pkg.dir,
          manifest: subjectManifest,
          name: pkg.name,
          version: pkg.version,
          tarball,
        })
        if (!preflightOk) {
          return 1
        }
        const digest =
          config.onStageUploaded && !dryRun ? hashTarball(tarball) : undefined
        staged = await uploadNpmPackage({
          cwd: rootPath,
          dryRun,
          // The SUBJECT's manifest, not the root's — the auth posture reads the
          // version from it, and a publishConfig.directory redirect puts the
          // published version somewhere other than <rootPath>/package.json.
          manifestPath: pkg.manifestPath,
          mode: 'staged',
          tag,
          tarball,
          onUploaded:
            digest && config.onStageUploaded
              ? async uploaded => {
                  await config.onStageUploaded!(
                    matchNpmStageUploadEvidence({
                      distTag: tag,
                      output: uploaded.output,
                      name: pkg.name,
                      sha1: digest.shasum,
                      sha512: digest.integrity.slice('sha512-'.length),
                      version: pkg.version,
                    }),
                  )
                }
              : undefined,
        })
        return staged.code
      }),
    )
  } finally {
    if (!reservedTarball) {
      await safeDelete(tarball)
    }
  }
  if (!preflightOk) {
    throw new Error(
      'Staged publish preflight failed.\n' +
        `  Where: ${pkg.name}@${pkg.version} preflight, before any upload\n` +
        '  Saw:   a preflight check refused; the upload never ran\n' +
        '  Fix:   read the preflight failure above and clear it, then re-run.',
    )
  }
  if (code !== 0) {
    const diagnosis = await diagnosePublishFailure({
      name: pkg.name,
      output: staged.output,
      version: pkg.version,
    })
    throw new Error(
      [
        `pnpm stage publish exited ${code}.`,
        `  Where: ${pkg.name}@${pkg.version} staged upload`,
        '  Saw:   a non-zero exit from the staged upload',
        ...diagnosis.map(line => `  ${line}`),
      ].join('\n'),
    )
  }
  // Exit 0 is not proof the intended mechanism worked — pnpm logs a failed
  // OIDC exchange and carries on with whatever other credential exists.
  // uploadNpmPackage already reported it; this is where the run stops.
  if (!staged.postureOk) {
    throw new Error(
      'Staged upload used the wrong credential.\n' +
        `  Where: ${pkg.name}@${pkg.version} auth posture\n` +
        '  Saw:   exit 0, but the OIDC exchange did not produce the token\n' +
        '  Fix:   check the trusted-publisher registration matches this run.',
    )
  }
  if (dryRun) {
    logger.success(
      `Dry-run complete for ${pkg.name}@${pkg.version}. Re-run without --dry-run to upload.`,
    )
  } else {
    logger.success(`Staged ${pkg.name}@${pkg.version}.`)
    logNpmApproveHandoff()
  }
}

/**
 * Direct upload mode: classic single-step `pnpm publish` — upload + make public
 * in one call, no stage/approve.
 *
 * By policy this is legal for exactly ONE publish: the local `0.0.0` name
 * reservation, which exists because npm can only configure a trusted publisher
 * for a name that already exists. Every other direct publish is refused by the
 * auth posture inside `uploadNpmPackage` — in CI or on a laptop, token or not —
 * because a real release must be STAGED so a bad upload stays rejectable, and
 * because stage-publish is what the per-package trusted-publisher grants
 * actually allow.
 *
 * Also refuses, earlier and with a different message, when the package's prior
 * versions used staging (per the packument's `_npmUser.approver` signal).
 * Downgrading erases the trust signal from the package's history.
 */
export async function runDirect(
  tag: string,
  config: { dryRun: boolean },
): Promise<void> {
  const { dryRun } = { __proto__: null, ...config } as typeof config
  // Multi-package workspace: same delegation as runStaged.
  const layout = resolveNpmWorkspaceLayout(rootPath)
  if (layout.kind === 'multi') {
    await runWorkspacePublish('direct', tag, layout, { dryRun })
    return
  }
  const pkg = resolveReleaseSubject(rootPath)
  logger.log(
    `Direct-publishing ${pkg.name}@${pkg.version} (tag=${tag})${dryRun ? ' [dry-run]' : ''}`,
  )

  // Verify BEFORE publishing: a cache-busted packument read settles whether the
  // target is already live. If it is, re-publishing errors; skip the upload and
  // heal idempotently — ensure the tag + GH release exist behind the liveness
  // gate — instead of failing.
  const published = await fetchPublishedState(pkg.name)
  if (
    stageAction({
      publishedLatest: published.latest,
      publishedVersions: published.versions,
      target: pkg.version,
    }) === 'already-published'
  ) {
    logger.success(
      `${pkg.name}@${pkg.version} already published — nothing to publish; ` +
        `ensuring the tag + GH release exist.`,
    )
    const released = await releaseBehindLiveGate({
      isLive: () => isAlreadyPublished(pkg.name, pkg.version),
      pkg: { name: pkg.name, version: pkg.version },
      registry: 'npm',
    })
    if (!released) {
      process.exitCode = 1
    }
    return
  }

  // Trust-downgrade refusal: if any prior version of this package was
  // staged-published (carries `_npmUser.approver`), direct publishing would erase
  // that trust signal. Force the operator to use the npm release workflow or make the
  // downgrade explicit. Skips on first-publish packages (no prior
  // versions) and on network failure (which we treat as "unknown").
  if (await isStagingExpected(pkg.name)) {
    logger.fail(
      `${pkg.name} has prior staged-published versions (per registry _npmUser.approver). ` +
        `direct publishing would downgrade the trust signal. Use the npm release workflow instead, or ` +
        `(rare) remove the prior staged-published versions first.`,
    )
    process.exitCode = 1
    return
  }

  // Pin the SUBJECT README to the release tag + prune repo-only lifecycle
  // scripts for the published tarball only, and run the pack preflight inside
  // the same brackets so a hollow tarball never publishes (see runStaged).
  const subjectManifest = JSON.parse(
    readFileSync(pkg.manifestPath, 'utf8'),
  ) as WorkspaceManifestShape
  const tarball = await defaultPackTarball(pkg.name, pkg.version)
  if (!tarball) {
    process.exitCode = 1
    return
  }
  let preflightOk = true
  let publishRun: NpmUploadResult = DID_NOT_UPLOAD
  let code: number
  try {
    code = await withPinnedReadme(pinTargetFor(pkg), () =>
      withPrunedPackManifest(pkg.dir, async () => {
        preflightOk = await verifyPackedPayload({
          dir: pkg.dir,
          manifest: subjectManifest,
          name: pkg.name,
          version: pkg.version,
          tarball,
        })
        if (!preflightOk) {
          return 1
        }
        publishRun = await uploadNpmPackage({
          cwd: rootPath,
          dryRun,
          manifestPath: pkg.manifestPath,
          mode: 'direct',
          tag,
          tarball,
        })
        return publishRun.code
      }),
    )
  } finally {
    await safeDelete(tarball)
  }
  if (!preflightOk) {
    process.exitCode = 1
    return
  }
  if (code !== 0) {
    logger.fail(`pnpm publish exited ${code}`)
    for (const line of await diagnosePublishFailure({
      mode: 'direct',
      name: pkg.name,
      output: publishRun.output,
      version: pkg.version,
    })) {
      logger.fail(line)
    }
    process.exitCode = code
    return
  }
  // A direct publish is public the instant it lands, so a masked credential
  // here cannot be rejected — but it must still fail the run rather than cut a
  // tag and a release over it.
  if (!publishRun.postureOk) {
    process.exitCode = 1
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
/**
 * A tarball provider: resolves the scan-subject bytes for `name@version` to a
 * path, or undefined when this source has nothing (a staged entry with no
 * tarballUrl, a failed download).
 */
export type TarballProvider = (
  name: string,
  version: string,
) => Promise<string | undefined>

export interface PackTarballOptions {
  env?: NodeJS.ProcessEnv | undefined
  root?: string | undefined
}

/**
 * Compose an ordered list of tarball providers into one that tries each in
 * turn and returns the first path a source yields, falling THROUGH a source
 * that returns undefined instead of hard-failing. Returns undefined only when
 * EVERY source came up empty. This is the artifact-source fallback chain
 * (browser-read to registry-API to local pack), factored out of the approve
 * loop so the fallthrough is unit-testable without a browser.
 */
export function composeTarballProviders(
  sources: readonly TarballProvider[],
): TarballProvider {
  return async (name: string, version: string) => {
    for (let i = 0, { length } = sources; i < length; i += 1) {
      // Try each source until one yields bytes.
      // eslint-disable-next-line no-await-in-loop -- serial fallback
      const packed = await sources[i]!(name, version)
      if (packed) {
        return packed
      }
    }
    return undefined
  }
}

export async function defaultPackTarball(
  name: string,
  version: string,
  options?: PackTarballOptions | undefined,
): Promise<string | undefined> {
  const opts: PackTarballOptions = { ...options }
  Object.setPrototypeOf(opts, null)
  const root = opts.root ?? rootPath
  // Multi-package workspace: pack the member that publishes `name` from its
  // own directory, pnpm packs the cwd package; a name no member publishes
  // gets the same cross-repo refusal as the single-subject path below.
  const layout = resolveNpmWorkspaceLayout(root)
  if (layout.kind === 'multi') {
    return await packWorkspaceMemberTarball(layout, name, version, {
      env: opts.env,
    })
  }
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
      withPrunedPackManifest(subject.dir, () => {
        const command = resolvePnpmCommand([
          'pack',
          '--config.ignore-scripts=true',
        ])
        return runCapture(command.command, command.args, root, {
          env: opts.env,
        })
      }),
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
 * its path, undefined on failure. The download endpoint requires the same
 * npm auth as the rest of the stage API.
 */
export async function defaultDownloadStagedTarball(
  stageId: string,
  options: {
    resolveStageCommand?: typeof resolveNpmStageCommand | undefined
  } = {},
): Promise<string | undefined> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-staged-dl-'))
  const stageCommand = (options.resolveStageCommand ?? resolveNpmStageCommand)()
  const dl = await runCapture(
    stageCommand.command,
    [...stageCommand.argsPrefix, 'stage', 'download', stageId],
    tmpDir,
  )
  if (dl.code !== 0) {
    return undefined
  }
  const entries = await fs.readdir(tmpDir)
  const tgz = entries.find(e => e.endsWith('.tgz'))
  return tgz ? path.join(tmpDir, tgz) : undefined
}

// Relative path → sha1-of-content for every file under `dir`, sorted walk.
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
    result.set(
      rel,
      crypto
        .createHash('sha1')
        .update(normalizeBundleRegionComments(rel, bytes))
        .digest('hex'),
    )
  }
  return result
}

/**
 * Compare extracted file bytes after excluding standalone JavaScript region
 * comments. The tarball-level sha1 embeds the gzip envelope — platform + tool
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
      ? {
          detail: `${hashesA.size} file(s) equal`,
          equal: true,
        }
      : { detail: diffs.slice(0, 10).join('; '), equal: false }
  } finally {
    await safeDelete(tmpDir)
  }
}

/**
 * Route a staged entry to the verification axis its payload supports. A
 * generated platform package or a machine-built payload (.wasm / .node) has
 * no local byte-twin, so it verifies STRUCTURALLY on the staged bytes
 * (verifyStagedPlatformEntry) — and the downloaded staged tarball is copied
 * to `<rootPath>/<name>-<version>.tgz` so the release-asset checksum pickup
 * hashes the bytes that actually shipped, never a divergent local re-pack.
 * Everything else keeps the local-pack byte-compare gate (verifyStagedEntry).
 */
export async function verifyStagedEntryRouted(
  entry: StageListEntry,
): Promise<boolean> {
  const layout = resolveNpmWorkspaceLayout(rootPath)
  const member =
    entry.name && layout.kind === 'multi'
      ? layout.packages.find(pkg => pkg.name === entry.name)
      : undefined
  if (member && (member.platform || hasMachineBuiltPayload(member.manifest))) {
    const ok = await verifyStagedPlatformEntry(entry, member, {
      downloadStagedTarball: defaultDownloadStagedTarball,
    })
    if (ok && entry.name && entry.version && entry.stageId) {
      const staged = await defaultDownloadStagedTarball(entry.stageId)
      if (staged) {
        const assetName = `${entry.name.replace(/^@/, '').replace('/', '-')}-${entry.version}.tgz`
        await fs.copyFile(staged, path.join(rootPath, assetName))
      }
    }
    return ok
  }
  return verifyStagedEntry(entry)
}

/**
 * Pre-approve integrity gate. Packs the tarball locally and asserts its sha1
 * equals the shasum npm recorded when the tarball was staged — run BEFORE
 * `npm stage approve` (the 2FA / OAuth promote) so a divergent artifact never
 * goes public. Two-source comparison (local pack + npm staging). The release
 * pipeline runs the GitHub-asset comparison and `gh attestation verify`
 * before this local gate. Fails
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
        `  Fix: inspect the stage metadata; do not approve an unidentified entry.`,
    )
    return false
  }
  if (!stagedShasum) {
    logger.fail(
      `Pre-approve verify: no server-side shasum for ${name}@${version}.\n` +
        `  Where: npm stage list --json (stageId ${stageId}) exposed no shasum field.\n` +
        `  Saw vs wanted: an entry with no digest.\n` +
        `  Fix: inspect the stage-list response and repair readStagedShasum if its schema changed; never approve without a verified digest.`,
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
          `  Where: tarball sha1 mismatch and the staged tarball could not be downloaded.\n` +
          `    local pack:  ${local.shasum}\n` +
          `    npm staging: ${stagedShasum}\n` +
          `  Fix: check npm auth (npm stage download ${stageId}), then retry verification.`,
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
          `  Fix: reject the staged publish (node scripts/fleet/npm/auth/run.mts stage reject ${stageId}) and reserve a higher version; never approve divergent bytes.`,
      )
      return false
    }
    logger.success(
      `Verified ${name}@${version}: staged contents match the local pack (${contents.detail}).`,
    )
    return true
  }
  logger.log(
    `Verified ${name}@${version}: local pack sha1 matches npm staging (${comparison.algorithm}).`,
  )
  return true
}
