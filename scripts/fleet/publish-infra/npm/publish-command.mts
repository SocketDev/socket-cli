/**
 * @file THE npm upload invocation. One function builds the `pnpm stage publish`
 *   / `pnpm publish` argv, decides provenance, asserts the auth posture on both
 *   sides of the spawn, and hands back the exit code plus the captured output.
 *   Every path that uploads npm bytes calls it — the single-subject `--staged`
 *   and `--direct` modes, the multi-package workspace wave, and a member's own
 *   orchestrator over its many packages. It exists because the argv had drifted
 *   into four hand-maintained copies. Two of them gated `--provenance` on
 *   `GITHUB_ACTIONS` alone and would have hit npm's `E422 Unsupported …
 *   repository visibility: "private"` on a private repo; none of them read the
 *   output for the failed OIDC exchange that lets a token-backed upload report
 *   success. A publish primitive that lives in four places is a publish
 *   primitive that is wrong in three of them. ORCHESTRATION IS NOT DUPLICATION.
 *   What order the packages go in, which commits get republished, how an
 *   approve batch refreshes its OTP — that is a member's own business. The
 *   invocation that puts bytes on the registry is not: it is this function,
 *   everywhere.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { logger, provenanceAllowed, runInheritTee } from '../shared.mts'
import {
  logPublishAuthPosture,
  publishAuthPostflight,
  publishAuthPreflight,
} from './auth-posture.mts'

/**
 * `staged` uploads to npm staging (`pnpm stage publish`) — nothing is public
 * until a human approves it. `direct` is the classic one-step `pnpm publish`.
 */
export type NpmUploadMode = 'direct' | 'staged'

export interface NpmUploadResult {
  /**
   * The command's exit code; 0 when it never ran because the posture refused.
   */
  code: number
  /**
   * Stdout + stderr, interleaved in arrival order.
   */
  output: string
  /**
   * False when the auth posture refused — either a long-lived token would have
   * masked trusted publishing (nothing was uploaded), or the command reported
   * the OIDC exchange failing (something was uploaded, under the wrong
   * identity). Either way the caller must stop and exit non-zero. A caller that
   * only checks `code` will miss the second case, which is the whole point.
   */
  postureOk: boolean
  /**
   * True when the command actually ran. False means the preflight refused
   * before the spawn, so nothing reached the registry.
   */
  ran: boolean
}

/**
 * The argv for an npm upload, without the auth posture or the spawn. Pure, so a
 * test asserts the flag set without a registry.
 *
 * `--ignore-scripts` and `--no-git-checks` are not optional: the tarball is
 * already built by this point, and the publish must not depend on the state of
 * the working tree. `--provenance` is added only when the run is inside GitHub
 * Actions AND the source repository is public — npm refuses a sigstore bundle
 * from a private repo with E422, so a blanket `GITHUB_ACTIONS` gate turns a
 * private-repo publish into a hard failure.
 */
export function npmUploadArgs(config: {
  dryRun?: boolean | undefined
  mode?: NpmUploadMode | undefined
  provenance?: boolean | undefined
  tag?: string | undefined
}): string[] {
  const {
    dryRun = false,
    mode = 'staged',
    provenance = false,
    tag = 'latest',
  } = { __proto__: null, ...config } as typeof config
  const args = mode === 'staged' ? ['stage', 'publish'] : ['publish']
  args.push(
    '--access',
    'public',
    '--tag',
    tag,
    '--no-git-checks',
    '--ignore-scripts',
  )
  if (provenance) {
    args.push('--provenance')
  }
  if (dryRun) {
    args.push('--dry-run')
  }
  return args
}

/**
 * Whether this run should ask npm for a provenance attestation, logging the
 * skip when it should not. Inside GitHub Actions on a private repo the
 * attestation is unverifiable, so it is skipped LOUDLY rather than attempted
 * and rejected; outside Actions there is no OIDC token to attest with.
 */
export function resolveUploadProvenance(): boolean {
  if (process.env['GITHUB_ACTIONS'] !== 'true') {
    return false
  }
  if (provenanceAllowed()) {
    return true
  }
  logger.warn(
    'Provenance skipped: npm only verifies sigstore bundles from PUBLIC ' +
      'source repositories, and this run is not one. The upload proceeds ' +
      'unattested; provenance turns back on automatically when the repo ' +
      'is public.',
  )
  return false
}

/**
 * The `version` of the manifest at `manifestPath`, or undefined when it cannot
 * be read or parsed.
 *
 * The auth posture's placeholder carve-out keys on this value, so it is read
 * from DISK rather than accepted from the caller — a caller-asserted "this is a
 * `0.0.0` reservation" flag would let any publish claim the one exemption. An
 * unreadable manifest yields undefined, which matches no carve-out and so fails
 * closed.
 */
export function readPublishVersion(manifestPath: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      // oxlint-disable-next-line typescript/no-redundant-type-constituents -- fleet optional-explicit-undefined convention: the explicit | undefined on an optional is intentional, not redundant.
      version?: unknown | undefined
    }
    return typeof parsed.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}

/**
 * Upload one package's bytes from `cwd`, with the auth posture asserted before
 * and after.
 *
 * `manifestPath` names the manifest that is actually being published — the
 * SUBJECT's, which is not `<cwd>/package.json` when `publishConfig.directory`
 * redirects the publish. It defaults to `<cwd>/package.json` for the plain
 * case.
 *
 * Preflight refusal returns `{ code: 0, ran: false, postureOk: false }` — the
 * zero code is honest (no command ran), and `postureOk` is the field the caller
 * must branch on. Postflight refusal returns the command's real code with
 * `postureOk: false`, because a `Skipped OIDC` upload that exited 0 is a failed
 * publish wearing a success.
 */
export async function uploadNpmPackage(config: {
  cwd: string
  dryRun?: boolean | undefined
  manifestPath?: string | undefined
  mode?: NpmUploadMode | undefined
  tag?: string | undefined
}): Promise<NpmUploadResult> {
  const {
    cwd,
    dryRun = false,
    manifestPath,
    mode = 'staged',
    tag = 'latest',
  } = { __proto__: null, ...config } as typeof config
  const version = readPublishVersion(
    manifestPath ?? path.join(cwd, 'package.json'),
  )
  const shape = { env: process.env, mode, version }
  if (!logPublishAuthPosture(publishAuthPreflight(shape))) {
    return { code: 0, output: '', postureOk: false, ran: false }
  }
  const args = npmUploadArgs({
    dryRun,
    mode,
    provenance: resolveUploadProvenance(),
    tag,
  })
  // Teed, not inherited: the operator watches the upload live AND the posture
  // check below gets to read what the registry actually said. An inherited
  // spawn makes the OIDC-exchange failure unreadable by the process that has
  // to act on it.
  const run = await runInheritTee('pnpm', args, cwd)
  const postureOk = logPublishAuthPosture(
    publishAuthPostflight({
      ...shape,
      commandSucceeded: run.code === 0,
      output: run.output,
    }),
  )
  return { code: run.code, output: run.output, postureOk, ran: true }
}
