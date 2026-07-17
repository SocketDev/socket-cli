/**
 * @file `--staged` / `--direct` publish modes for cargo, plus the crate-pack
 *   helpers the release-asset wiring and the `--approve` integrity gate reuse.
 *   crates.io has NO staging endpoint, so "staged" here means: verify the crate
 *   builds from its packaged sources (`cargo publish --dry-run`), produce the
 *   `.crate` artifact, and record its sha256 as the digest a downstream
 *   `--approve` gate compares against — nothing is uploaded. Publishing is
 *   PERMANENT (a version can only be yanked, never overwritten). The cargo
 *   analog of npm/staged.mts.
 */

import crypto from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { ensureTagAndRelease } from '../release.mts'
import { logger, rootPath, runCapture, runInherit } from '../shared.mts'
import { isAlreadyPublished } from './registry.mts'
import { cratePath, crateSha256, readCargoPackage } from './shared.mts'

/**
 * Run `cargo package` (with `--locked` unless `locked` is false) and return the
 * packaged `.crate` path if it now exists, else undefined (pack failed).
 */
export async function packCrate(
  name: string,
  version: string,
  options: { locked: boolean },
): Promise<string | undefined> {
  const { locked } = { __proto__: null, ...options } as { locked: boolean }
  const args = ['package']
  if (locked) {
    args.push('--locked')
  }
  const { code } = await runCapture('cargo', args, rootPath)
  const file = cratePath(name, version)
  return code === 0 && existsSync(file) ? file : undefined
}

/**
 * Pack the `.crate` and write a sibling `checksums.txt` (sha1 + sha512 of the
 * `.crate`, mirroring the npm release-asset format), returning both paths for
 * ensureTagAndRelease to attach to the GitHub release. Returns an empty array
 * when the pack fails — the release then ships without assets, the same
 * tolerance as release.mts's default (pnpm) packer.
 */
export async function packCrateAssets(
  name: string,
  version: string,
): Promise<string[]> {
  const crate = await packCrate(name, version, { locked: true })
  if (!crate) {
    logger.warn(
      `cargo package failed; releasing ${name}@${version} without assets.`,
    )
    return []
  }
  const bytes = readFileSync(crate)
  const sha1 = crypto.createHash('sha1').update(bytes).digest('hex')
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64')
  const crateName = path.basename(crate)
  const checksumsPath = path.join(path.dirname(crate), 'checksums.txt')
  writeFileSync(
    checksumsPath,
    `sha1: ${sha1}  ${crateName}\nsha512-base64: ${sha512}  ${crateName}\n`,
  )
  logger.log(
    `Crate sha1 ${sha1} (compare with the crates.io published digest).`,
  )
  return [crate, checksumsPath]
}

/**
 * `--staged` mode: verify + package the crate without uploading anything.
 *
 * Reads the publishable package, refuses an already-published version
 * (crates.io never allows a re-publish — surfaced before the network call),
 * then runs `cargo publish --dry-run --locked` — which packages AND compiles
 * from the packaged sources, the real verification that the uploaded bytes
 * build. On success (and not a bare dry-run), packs the `.crate` and records
 * its sha256 in a `<crate>.sha256` sidecar so `--approve` can integrity-gate
 * against it. In CI the workflow — not this script — handles
 * provenance/attestation.
 */
export async function runStaged(options: {
  dryRun: boolean
  packageName?: string | undefined
}): Promise<void> {
  const opts = { __proto__: null, ...options } as {
    dryRun: boolean
    packageName?: string | undefined
  }
  const pkg = await readCargoPackage(opts.packageName)
  logger.log(
    `Staging ${pkg.name}@${pkg.version}${opts.dryRun ? ' [dry-run]' : ''}`,
  )

  if (await isAlreadyPublished(pkg.name, pkg.version)) {
    logger.fail(
      `${pkg.name}@${pkg.version} is already published to crates.io. Versions ` +
        'are PERMANENT (a version can only be yanked, never re-published or ' +
        'overwritten). Bump the version and try again.',
    )
    process.exitCode = 1
    return
  }

  // `cargo publish --dry-run` packages the crate AND compiles it from the
  // packaged sources — the real verification. Nothing is uploaded (crates.io
  // has no staging endpoint).
  const code = await runInherit(
    'cargo',
    ['publish', '--dry-run', '--locked'],
    rootPath,
  )
  if (code !== 0) {
    logger.fail(`cargo publish --dry-run exited ${code}`)
    process.exitCode = code
    return
  }
  if (opts.dryRun) {
    logger.success(
      `Dry-run complete for ${pkg.name}@${pkg.version}. Re-run without ` +
        '--dry-run to produce the staged artifact.',
    )
    return
  }

  // Produce the .crate and record its sha256 as the staged digest so --approve
  // can integrity-gate against it.
  const crate = await packCrate(pkg.name, pkg.version, { locked: true })
  if (!crate) {
    logger.fail(
      `cargo package did not produce ${cratePath(pkg.name, pkg.version)}.`,
    )
    process.exitCode = 1
    return
  }
  const sha256 = crateSha256(crate)
  const sidecar = `${crate}.sha256`
  writeFileSync(sidecar, `${sha256}  ${path.basename(crate)}\n`)
  logger.log(`Staged crate sha256 ${sha256} (recorded at ${sidecar}).`)
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    logger.log(
      '[cargo] CI: provenance/attestation is handled by the publish workflow ' +
        '(this script does not attest the artifact itself).',
    )
  }
  logger.success(
    `Verified + packaged ${pkg.name}@${pkg.version}. NOTHING is public yet — ` +
      'crates.io has no staging endpoint, so this is a verified, hashed ' +
      'artifact awaiting a downstream `--approve`. Publishing is PERMANENT ' +
      '(a version can only be yanked, never overwritten).',
  )
}

/**
 * `--direct` mode: classic single-step `cargo publish --locked` — build +
 * upload + make public in one call, no stage/approve. Refuses an
 * already-published version. On a real (non-dry-run) success, creates the git
 * tag + GitHub release with the `.crate` + checksums as assets (see
 * ensureTagAndRelease).
 */
export async function runDirect(options: {
  dryRun: boolean
  packageName?: string | undefined
}): Promise<void> {
  const opts = { __proto__: null, ...options } as {
    dryRun: boolean
    packageName?: string | undefined
  }
  const pkg = await readCargoPackage(opts.packageName)
  logger.log(
    `Direct-publishing ${pkg.name}@${pkg.version}` +
      `${opts.dryRun ? ' [dry-run]' : ''}`,
  )

  if (await isAlreadyPublished(pkg.name, pkg.version)) {
    logger.fail(
      `${pkg.name}@${pkg.version} is already published to crates.io. Versions ` +
        'are PERMANENT (yank-only). Bump the version and try again.',
    )
    process.exitCode = 1
    return
  }

  const args = ['publish', '--locked']
  if (opts.dryRun) {
    args.push('--dry-run')
  }
  const code = await runInherit('cargo', args, rootPath)
  if (code !== 0) {
    logger.fail(`cargo publish exited ${code}`)
    process.exitCode = code
    return
  }
  if (opts.dryRun) {
    logger.success(
      `Dry-run complete for ${pkg.name}@${pkg.version}. Re-run without ` +
        '--dry-run to publish (PERMANENT).',
    )
    return
  }
  logger.success(`Published ${pkg.name}@${pkg.version} to crates.io directly.`)
  await ensureTagAndRelease(
    { name: pkg.name, version: pkg.version },
    { packAssets: () => packCrateAssets(pkg.name, pkg.version) },
  )
}
