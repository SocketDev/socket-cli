/**
 * @file `--approve` mode for cargo: the human-gated, PERMANENT promotion of a
 *   verified crate to public on crates.io. Simpler than the npm approve flow —
 *   crates.io has no staging list to enumerate. A pre-approve integrity gate
 *   re-packs the `.crate` and asserts its sha256 matches the staged digest
 *   (env CARGO_STAGED_SHA256, or a `<crate>.sha256` sidecar) before a
 *   confirmation gate and `cargo publish --locked`. The script handles no
 *   tokens: `cargo publish` reads the operator's `cargo login` credentials
 *   locally, or rides OIDC Trusted Publishing in CI.
 */

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { confirm } from '@socketsecurity/lib/stdio/prompts'

import { ensureTagAndRelease } from '../release.mts'
import { logger, rootPath, runInherit } from '../shared.mts'
import { isAlreadyPublished } from './registry.mts'
import { cratePath, crateSha256, readCargoPackage } from './shared.mts'
import { packCrate, packCrateAssets } from './staged.mts'

/**
 * Resolve the staged `.crate` sha256 recorded at stage time, if discoverable:
 * the CARGO_STAGED_SHA256 env the CI stage step exports (preferred), else the
 * `<crate>.sha256` sidecar runStaged writes. Returns the lowercased hex digest,
 * or undefined when neither exists (a first/local approve with nothing to
 * compare). The sidecar format is `<sha256>  <filename>` (mirrors `shasum`).
 */
export function resolveStagedSha256(
  name: string,
  version: string,
): string | undefined {
  const fromEnv = process.env['CARGO_STAGED_SHA256']
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv.trim().toLowerCase()
  }
  const sidecar = `${cratePath(name, version)}.sha256`
  if (existsSync(sidecar)) {
    const first = readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0]
    if (first) {
      return first.toLowerCase()
    }
  }
  return undefined
}

/**
 * `--approve` mode: promote a verified crate to public on crates.io. Refuses an
 * already-published version. Runs the pre-approve integrity gate (re-pack + a
 * sha256 compare against the staged digest; FAIL LOUD on mismatch, proceed with
 * a note when there's no prior digest), then — unless `yes` — a confirmation
 * gate for the PERMANENT publish, then `cargo publish --locked`. On success,
 * creates the git tag + GitHub release with the `.crate` + checksums as assets.
 * `otpFromFlag` is accepted for signature parity with the npm tier but is a
 * no-op for crates.io (no OTP on publish).
 */
export async function runApprove(options: {
  dryRun: boolean
  otpFromFlag?: string | undefined
  packageName?: string | undefined
  yes: boolean
}): Promise<void> {
  const opts = { __proto__: null, ...options } as {
    dryRun: boolean
    otpFromFlag?: string | undefined
    packageName?: string | undefined
    yes: boolean
  }
  const pkg = await readCargoPackage(opts.packageName)
  logger.log(
    `Approving publish of ${pkg.name}@${pkg.version}` +
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

  // Pre-approve integrity gate: re-pack the .crate and compare its sha256 to the
  // staged digest. Never approve a divergent artifact.
  const crate = await packCrate(pkg.name, pkg.version, { locked: true })
  if (!crate) {
    logger.fail(
      `[cargo] could not pack ${pkg.name}@${pkg.version} for the pre-approve ` +
        'integrity gate. Fix the pack, then re-run --approve.',
    )
    process.exitCode = 1
    return
  }
  const localSha = crateSha256(crate)
  const stagedSha = resolveStagedSha256(pkg.name, pkg.version)
  if (stagedSha === undefined) {
    logger.log(
      `[cargo] no staged sha256 to compare (first/local approve); proceeding ` +
        `with the local pack digest ${localSha}.`,
    )
  } else if (stagedSha !== localSha) {
    logger.fail(
      `Pre-approve verify FAILED for ${pkg.name}@${pkg.version}.\n` +
        `  staged: ${stagedSha}\n` +
        `  local:  ${localSha}\n` +
        '  Fix: re-stage the crate; never approve a divergent artifact.',
    )
    process.exitCode = 1
    return
  } else {
    logger.success(
      `Pre-approve verify: local pack sha256 matches the staged digest ` +
        `(${localSha}).`,
    )
  }

  if (opts.otpFromFlag !== undefined) {
    logger.log(
      '[cargo] --otp is a no-op for crates.io (no OTP on publish); ignoring.',
    )
  }

  if (opts.dryRun) {
    logger.success(
      `Dry-run complete for ${pkg.name}@${pkg.version}. Re-run without ` +
        '--dry-run to publish (PERMANENT).',
    )
    return
  }

  // Confirmation gate — crates.io publishing is PERMANENT (yank-only).
  if (!opts.yes) {
    const confirmed = (await confirm({
      default: false,
      message:
        `Publish ${pkg.name}@${pkg.version} to crates.io? This is PERMANENT ` +
        '(a version can only be yanked, never overwritten).',
    })) as boolean
    if (!confirmed) {
      logger.log('Not confirmed; nothing published.')
      return
    }
  }

  // In CI this rides OIDC Trusted Publishing; locally it uses the operator's
  // `cargo login` token. Either way the script handles no tokens — cargo reads
  // them.
  const code = await runInherit('cargo', ['publish', '--locked'], rootPath)
  if (code !== 0) {
    logger.fail(`cargo publish exited ${code}`)
    process.exitCode = code
    return
  }
  logger.success(`Published ${pkg.name}@${pkg.version} to crates.io.`)
  await ensureTagAndRelease(
    { name: pkg.name, version: pkg.version },
    { packAssets: () => packCrateAssets(pkg.name, pkg.version) },
  )
}
