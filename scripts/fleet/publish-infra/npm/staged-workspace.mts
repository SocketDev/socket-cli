/**
 * @file `--staged` / `--direct` publish over a MULTI-PACKAGE workspace layout
 *   decmpfs, stuie: gate the whole set first — version lockstep, every
 *   declared platform package present on disk, no hollow platform package, an
 *   orderable dependency graph — then publish each member
 *   in dependency order (platform packages before the loader that
 *   optional-depends on them; `pnpm -r publish`'s topological semantics,
 *   computed via computePublishOrder so the per-package gates run in the same
 *   order the registry receives the uploads). Every member also stands behind
 *   the pack preflight (pack-preflight.mts) — its packed tarball must carry
 *   every declared payload file before the publish command runs.
 *   Already-published members are skipped LOUD (the partial-publish recovery
 *   path); the first failed upload aborts the rest so a dependent never
 *   publishes ahead of its missing dependency. Single-package repos never reach
 *   this module — staged.mts delegates here only for `kind: 'multi'` layouts.
 */

import crypto from 'node:crypto'
import {
  existsSync,
  promises as fs,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { releaseBehindLiveGate } from '../release.mts'
import {
  logger,
  provenanceAllowed,
  runCapture,
  runInherit,
} from '../shared.mts'
import { withPinnedReadme } from '../pin-readme.mts'
import { withPrunedPackManifest } from './pack-manifest.mts'
import { verifyPackedPayload } from './pack-preflight.mts'
import {
  diagnoseStageConflict,
  diagnoseStagedAuthFailure,
  isAlreadyPublished,
} from './registry.mts'
import { isStagingExpected, logNpmApproveHandoff } from './shared.mts'
import {
  checkVersionLockstep,
  computePublishOrder,
  findAbsentPlatformPackages,
  findHollowPackages,
  requiredPayloadFiles,
} from './workspace-plan.mts'
import { tarExecutable } from '../../_shared/tar-executable.mts'

import type { StageListEntry } from './shared.mts'
import type { NpmWorkspaceLayout, WorkspacePackage } from './workspace.mts'

function pinTargetForPackage(
  layout: NpmWorkspaceLayout,
  pkg: WorkspacePackage,
): {
  readmePath: string
  repository: string | { url?: string | undefined } | undefined
  rootPath: string
  version: string
} {
  return {
    readmePath: 'README.md',
    // The member manifest's repository wins; the layout's (root/main) is the
    // fallback so a generated platform manifest that omits it still pins.
    repository: pkg.manifest.repository ?? layout.repository,
    rootPath: pkg.dir,
    version: layout.versionSource.version,
  }
}

/**
 * Pack the workspace member that publishes `name` from its own directory
 * pnpm packs the cwd package and writes the tarball there, with the same
 * README-pin + manifest-prune brackets as the publish itself so the
 * approve-time verify pack sees identical bytes. Fails loud (returning
 * undefined) when no member publishes `name` — the stage list is
 * account-scoped, so a foreign repo's entry must never pack here.
 */
export async function packWorkspaceMemberTarball(
  layout: NpmWorkspaceLayout,
  name: string,
  version: string,
): Promise<string | undefined> {
  const member = layout.packages.find(pkg => pkg.name === name)
  if (!member) {
    logger.fail(
      `Refusing to pack ${name}@${version} from ${layout.rootPath}: this ` +
        `workspace publishes ${layout.packages.map(pkg => pkg.name).join(', ')}. ` +
        `A cross-repo pack would pin the README against the wrong ` +
        `repository/version. Run the publish flow from ${name}'s own repo.`,
    )
    return undefined
  }
  const packed = await withPinnedReadme(
    pinTargetForPackage(layout, member),
    () =>
      withPrunedPackManifest(member.dir, () =>
        runCapture('pnpm', ['pack'], member.dir),
      ),
  )
  const tarballPath = path.join(
    member.dir,
    `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`,
  )
  return packed.code === 0 && existsSync(tarballPath) ? tarballPath : undefined
}

/**
 * Run the pre-publish gates every multi-package publish stands behind, in
 * fail-loud order: version lockstep across every member, every declared
 * platform package present on disk, no hollow platform package, an orderable
 * dependency graph. Returns the publish order, or undefined after failing loud
 * (process.exitCode set). Exported for tests.
 */
export function gateWorkspaceForPublish(
  layout: NpmWorkspaceLayout,
): WorkspacePackage[] | undefined {
  const drift = checkVersionLockstep(layout)
  if (drift.length > 0) {
    logger.fail(
      `Version lockstep is broken across the workspace's publishable ` +
        `packages.\n  Where: ${layout.rootPath}\n  Saw vs wanted:\n` +
        drift.map(line => `    ${line}`).join('\n') +
        `\n  Fix: run the bump (scripts/fleet/bump.mts) so every manifest ` +
        `and sibling pin moves to ${layout.versionSource.version} in ` +
        `lockstep; never hand-edit one member.`,
    )
    process.exitCode = 1
    return undefined
  }
  const absent = findAbsentPlatformPackages(layout.packages)
  if (absent.length > 0) {
    const detail = absent
      .map(
        report =>
          `    ${report.owner.relDir} (${report.owner.name}) declares ` +
          `${report.missing.join(', ')}`,
      )
      .join('\n')
    logger.fail(
      `Refusing to publish a loader whose declared platform package(s) are ` +
        `ABSENT from the workspace — an optionalDependency that never ` +
        `publishes 404s on every consumer install.\n` +
        `  Where:\n${detail}\n` +
        `  Saw vs wanted: the loader's optionalDependencies name platform ` +
        `siblings with NO package directory on disk (repos gitignore their ` +
        `generated npm/<platformId>/ dirs, so a clean checkout has none); ` +
        `wanted every declared name backed by a real package directory ` +
        `carrying its payload before any upload.\n` +
        `  Fix: run the platform matrix build so the artifacts exist — ` +
        `decmpfs's build-addons job builds each runner's .node, runs ` +
        `make-npm-dirs.mts, and stages the payload into ` +
        `napi/decmpfs/npm/<platformId>/ before the publish leg — or, if these ` +
        `names are genuinely unpublished, reserve and publish them FIRST; a ` +
        `loader whose optionalDependencies 404 breaks every consumer install.`,
    )
    process.exitCode = 1
    return undefined
  }
  const hollow = findHollowPackages(layout.packages)
  if (hollow.length > 0) {
    const detail = hollow
      .map(
        report =>
          `    ${report.pkg.relDir} (${report.pkg.name}): missing ` +
          report.missing.join(', '),
      )
      .join('\n')
    logger.fail(
      `Refusing to publish HOLLOW platform package(s) — a platform dir ` +
        `without its prebuilt payload breaks every consumer install.\n` +
        `  Where:\n${detail}\n` +
        `  Saw vs wanted: declared payload files absent on disk; wanted ` +
        `every literal files/main entry present before any upload.\n` +
        `  Fix: stage the CI-built binaries into the platform dirs (the ` +
        `repo's make-npm-dirs script copies the host build), then re-run.`,
    )
    process.exitCode = 1
    return undefined
  }
  const { cycle, order } = computePublishOrder(layout.packages)
  if (cycle) {
    logger.fail(
      `The workspace dependency graph cannot be publish-ordered.\n` +
        `  Where: ${layout.rootPath}\n` +
        `  Saw vs wanted: a dependency cycle among ${cycle.join(', ')}; ` +
        `wanted an acyclic graph (platform packages → loader → consumers).\n` +
        `  Fix: break the cycle (a workspace member must not depend on its ` +
        `own dependent), then re-run.`,
    )
    process.exitCode = 1
    return undefined
  }
  return order
}

/**
 * Approve-time verify for a GENERATED PLATFORM package. Its prebuilt payload
 * comes from the CI build matrix, so a local re-pack can never byte-match the
 * staged tarball (the local checkout has no — or a differently-built — .node
 * binary); the byte-compare gate (verifyStagedEntry) is the wrong axis here.
 * The honest axis is STRUCTURAL, on the staged bytes themselves: download the
 * staged tarball, and require (1) its manifest names exactly
 * `entry.name@entry.version` and (2) every declared payload file (literal
 * `files` entries + `main`) present AND non-empty inside it — a hollow
 * platform tarball never reaches the approve prompt. Fails LOUD and returns
 * false on any missing evidence. `downloadStagedTarball` is injected by the
 * caller, approve passes the stage-download helper — also the test seam.
 */
export async function verifyStagedPlatformEntry(
  entry: StageListEntry,
  pkg: WorkspacePackage,
  options?:
    | {
        downloadStagedTarball?:
          | ((stageId: string) => Promise<string | undefined>)
          | undefined
      }
    | undefined,
): Promise<boolean> {
  const { downloadStagedTarball } = { __proto__: null, ...options } as {
    downloadStagedTarball?:
      | ((stageId: string) => Promise<string | undefined>)
      | undefined
  }
  const { name, stageId, version } = entry
  if (!name || !version || !stageId || !downloadStagedTarball) {
    logger.fail(
      `Pre-approve verify: staged platform entry is missing ` +
        `name/version/stageId (or no downloader was supplied).\n` +
        `  Where: ${JSON.stringify(entry)}\n` +
        `  Fix: re-stage the package; do not approve an entry the registry ` +
        `can't identify.`,
    )
    return false
  }
  const tarballPath = await downloadStagedTarball(stageId)
  if (!tarballPath) {
    logger.fail(
      `Pre-approve verify FAILED for ${name}@${version}.\n` +
        `  Where: the staged tarball could not be downloaded (stageId ` +
        `${stageId}) — a platform package verifies on the STAGED bytes (its ` +
        `CI-built payload has no local twin to byte-compare).\n` +
        `  Fix: check npm auth (pnpm stage download ${stageId}), or reject + ` +
        `re-stage. Not approving unverified bytes.`,
    )
    return false
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-platform-'))
  try {
    const untar = await runCapture(
      tarExecutable(),
      ['-xzf', tarballPath, '-C', tmpDir],
      tmpDir,
    )
    if (untar.code !== 0) {
      logger.fail(
        `Pre-approve verify FAILED for ${name}@${version}: extracting the ` +
          `staged tarball failed (tar exited ${untar.code}).`,
      )
      return false
    }
    // npm tarballs root their contents at `package/`.
    const packageDir = path.join(tmpDir, 'package')
    let staged: { name?: unknown | undefined; version?: unknown | undefined }
    try {
      staged = JSON.parse(
        readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
      ) as typeof staged
    } catch {
      logger.fail(
        `Pre-approve verify FAILED for ${name}@${version}: the staged ` +
          `tarball carries no readable package.json.`,
      )
      return false
    }
    if (staged.name !== name || staged.version !== version) {
      logger.fail(
        `Pre-approve verify FAILED for ${name}@${version}.\n` +
          `  Saw vs wanted: the staged tarball's manifest reads ` +
          `${String(staged.name)}@${String(staged.version)}; wanted ` +
          `${name}@${version}.\n` +
          `  Fix: reject the staged publish (node scripts/fleet/npm-web-auth.mts stage reject ${stageId}) ` +
          `and re-stage.`,
      )
      return false
    }
    const hollow: string[] = []
    const payload = requiredPayloadFiles(pkg.manifest)
    for (let i = 0, { length } = payload; i < length; i += 1) {
      const rel = payload[i]!
      const filePath = path.join(packageDir, rel)
      let size = -1
      try {
        // oxlint-disable-next-line socket/prefer-exists-sync -- the SIZE is the point: a zero-byte payload is as hollow as a missing one.
        size = statSync(filePath).size
      } catch {
        // Missing file — recorded below.
      }
      if (size <= 0) {
        hollow.push(rel)
      }
    }
    if (hollow.length > 0) {
      logger.fail(
        `Pre-approve verify FAILED for ${name}@${version}: the staged ` +
          `tarball is HOLLOW.\n` +
          `  Saw vs wanted: missing/empty payload file(s) ` +
          `${hollow.join(', ')}; wanted every declared platform payload ` +
          `present and non-empty.\n` +
          `  Fix: reject the staged publish (node scripts/fleet/npm-web-auth.mts stage reject ${stageId}) ` +
          `and re-stage from a CI run whose build artifacts landed.`,
      )
      return false
    }
    logger.success(
      `Verified ${name}@${version}: staged platform tarball carries its ` +
        `declared payload (structural verify on the staged bytes).`,
    )
    return true
  } finally {
    await safeDelete(tmpDir)
  }
}

/**
 * Pack this workspace's release assets: one tarball per publishable member
 * (packed from its own dir with the shared pin/prune brackets) plus a
 * checksums.txt (sha1 + sha512 per tarball) for the GitHub release. Members
 * whose pack fails are reported loud and skipped — the release still lands
 * with the assets that packed, matching the single-subject fail-open asset
 * behavior.
 */
export async function packWorkspaceReleaseAssets(
  layout: NpmWorkspaceLayout,
): Promise<string[]> {
  const version = layout.versionSource.version
  const assets: string[] = []
  const checksumLines: string[] = []
  for (const pkg of layout.packages) {
    // eslint-disable-next-line no-await-in-loop -- serial packs; each rewrites its member's manifest in place
    const tarballPath = await packWorkspaceMemberTarball(
      layout,
      pkg.name,
      version,
    )
    if (!tarballPath) {
      logger.warn(
        `pnpm pack failed for ${pkg.name}@${version}; releasing without its ` +
          `tarball asset.`,
      )
      continue
    }
    const bytes = readFileSync(tarballPath)
    const tarballName = path.basename(tarballPath)
    checksumLines.push(
      `sha1: ${crypto.createHash('sha1').update(bytes).digest('hex')}  ${tarballName}`,
      `sha512-base64: ${crypto.createHash('sha512').update(bytes).digest('base64')}  ${tarballName}`,
    )
    assets.push(tarballPath)
  }
  if (assets.length > 0) {
    const checksumsPath = path.join(layout.rootPath, 'checksums.txt')
    writeFileSync(checksumsPath, `${checksumLines.join('\n')}\n`)
    assets.push(checksumsPath)
  }
  return assets
}

/**
 * `--staged` / `--direct` over a multi layout. Mirrors the single-subject
 * modes per member: already-published refusal (as a loud SKIP — the
 * partial-publish recovery path), the `--direct` trust-downgrade refusal,
 * README pin + manifest prune around every pack, provenance in CI. The first
 * non-zero upload aborts the remainder — dependency order guarantees nothing
 * publishes ahead of a failed dependency.
 */
export async function runWorkspacePublish(
  mode: 'direct' | 'staged',
  tag: string,
  layout: NpmWorkspaceLayout,
  options?: { dryRun?: boolean | undefined } | undefined,
): Promise<void> {
  const { dryRun = false } = { __proto__: null, ...options } as {
    dryRun?: boolean | undefined
  }
  const order = gateWorkspaceForPublish(layout)
  if (!order) {
    return
  }
  const { version } = layout.versionSource
  const verb = mode === 'staged' ? 'Staging' : 'Direct-publishing'
  logger.log(
    `${verb} ${order.length} workspace package(s) at ${version} ` +
      `(tag=${tag})${dryRun ? ' [dry-run]' : ''}: ` +
      order.map(pkg => pkg.name).join(', '),
  )
  let published = 0
  let skipped = 0
  for (const pkg of order) {
    // eslint-disable-next-line no-await-in-loop -- serial by design: dependency order is the point
    if (await isAlreadyPublished(pkg.name, version)) {
      logger.log(
        `Skipping ${pkg.name}@${version} — already on the registry ` +
          `(partial-publish recovery); publishing the remaining members.`,
      )
      skipped += 1
      continue
    }
    if (mode === 'direct') {
      // Trust-downgrade refusal, same as the single-subject --direct: a
      // member with staged-published history must not silently downgrade.
      // eslint-disable-next-line no-await-in-loop -- serial by design
      if (await isStagingExpected(pkg.name)) {
        logger.fail(
          `${pkg.name} has prior staged-published versions (per registry ` +
            `_npmUser.approver). --direct would downgrade the trust signal. ` +
            `Use --staged instead. Aborting the remaining members.`,
        )
        process.exitCode = 1
        return
      }
    }
    const args = mode === 'staged' ? ['stage', 'publish'] : ['publish']
    args.push(
      '--access',
      'public',
      '--tag',
      tag,
      '--no-git-checks',
      '--ignore-scripts',
    )
    if (process.env['GITHUB_ACTIONS'] === 'true') {
      if (provenanceAllowed()) {
        args.push('--provenance')
      } else {
        logger.warn(
          'Provenance skipped: npm only verifies sigstore bundles from ' +
            'PUBLIC source repositories, and this run is not one. The ' +
            'upload proceeds unattested; provenance turns back on ' +
            'automatically when the repo is public.',
        )
      }
    }
    if (dryRun) {
      args.push('--dry-run')
    }
    // Same README-pin + manifest-prune brackets as the single-subject modes,
    // per member, so the approve-time verify pack sees identical bytes. The
    // pack preflight runs inside them, before the command, so a member whose
    // tarball is missing declared payload never stages or publishes.
    let preflightOk = true
    // eslint-disable-next-line no-await-in-loop -- serial by design
    const code = await withPinnedReadme(pinTargetForPackage(layout, pkg), () =>
      withPrunedPackManifest(pkg.dir, async () => {
        preflightOk = await verifyPackedPayload({
          dir: pkg.dir,
          manifest: pkg.manifest,
          name: pkg.name,
          version,
        })
        if (!preflightOk) {
          return 1
        }
        return await runInherit('pnpm', args, pkg.dir)
      }),
    )
    if (!preflightOk) {
      logger.fail(
        `Pack preflight failed for ${pkg.name}@${version} ` +
          `(${path.relative(layout.rootPath, pkg.dir)}). Aborting the ` +
          `remaining members — a hollow tarball must never stage or publish.`,
      )
      process.exitCode = 1
      return
    }
    if (code !== 0) {
      logger.fail(
        `pnpm ${mode === 'staged' ? 'stage publish' : 'publish'} exited ` +
          `${code} for ${pkg.name}@${version} ` +
          `(${path.relative(layout.rootPath, pkg.dir)}). Aborting the ` +
          `remaining members — a dependent must never publish ahead of a ` +
          `failed dependency.`,
      )
      // eslint-disable-next-line no-await-in-loop -- failure path, loop exits here
      for (const line of await diagnoseStageConflict(pkg.name, version)) {
        logger.fail(line)
      }
      // eslint-disable-next-line no-await-in-loop -- failure path, loop exits here
      for (const line of await diagnoseStagedAuthFailure(pkg.name)) {
        logger.fail(line)
      }
      process.exitCode = code
      return
    }
    published += 1
  }
  if (published === 0 && skipped === order.length) {
    logger.fail(
      `Every workspace package is already published at ${version}. Bump the ` +
        `version and try again.`,
    )
    process.exitCode = 1
    return
  }
  if (dryRun) {
    logger.success(
      `Dry-run complete for ${published} package(s) at ${version}. Re-run ` +
        `without --dry-run to ${mode === 'staged' ? 'upload' : 'publish'}.`,
    )
    return
  }
  if (mode === 'staged') {
    logger.success(
      `Staged ${published} package(s) at ${version}` +
        `${skipped ? ` (${skipped} already published, skipped)` : ''}.`,
    )
    logNpmApproveHandoff()
  } else {
    logger.success(
      `Published ${published} package(s) at ${version} directly` +
        `${skipped ? ` (${skipped} already published, skipped)` : ''}.`,
    )
    // ONE tag + immutable release per lockstep version (every member shares
    // it), cut behind the MAIN package's registry liveness — the last member
    // published, so the whole set is live once it resolves.
    const main = layout.main!
    const released = await releaseBehindLiveGate({
      isLive: () => isAlreadyPublished(main.name, version),
      packAssets: () => packWorkspaceReleaseAssets(layout),
      pkg: { name: main.name, version },
      registry: 'npm',
    })
    if (!released) {
      process.exitCode = 1
    }
  }
}
