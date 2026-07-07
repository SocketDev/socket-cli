/**
 * @file Stager + verifier for cross-org binary-tail publishes. Consumed by
 *   socket-bin (standalone CLI tails) and socket-addon (.node NAPI tails) to
 *   download, verify, and stage tails built in a different repo before
 *   publishing them under the consumer's npm scope. This module does NOT call
 *   `npm publish`. It returns a structured staging result; the consumer's
 *   wrapping script loops the staged tails and invokes its own publish runner
 *   (fleet-canonical staged-publish flow, direct `pnpm publish`, etc.). The
 *   split lets each consumer pick its own publish-call shape without forking
 *   the verify-and-stage logic. Trust model — every successful stage requires
 *   ALL of:
 *
 *   1. Allowlist match — `findAllowlistEntry(allowlist, sourceRepo, releaseTag)`
 *      returns a row.
 *   2. Tag conformance — release tag matches the row's `tagPattern` regex
 *      (anchored).
 *   3. Triplet conformance — every downloaded archive's parsed triplet is in the
 *      row's `triplets` set.
 *   4. Name conformance — every archive's `package.json.name` equals
 *      `buildTailPackageName(entry, triplet)`.
 *   5. SHA verification — every archive's sha256 matches its line in the release's
 *      SHA256SUMS file.
 *   6. Attestation verification — `gh attestation verify` against the row's
 *      `attestationSubject` passes for every archive AND for SHA256SUMS itself.
 *      Any failure aborts the whole family — no partial stage. The staging
 *      directory is left in place on failure for diagnostics; the consumer's
 *      wrapping script is responsible for cleanup on retry.
 *
 * @see ./source-allowlist.mts for `SourceAllowlistEntry` + helpers.
 * @see ./pack-app-triplets.mts for the canonical triplet set.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { errorMessage } from '@socketsecurity/lib-stable/errors'

import {
  extractVersionFromTag,
  findArchiveForTriplet,
  parseShaSums,
  runCommand,
  runGh,
  sha256Of,
  verifyAttestation,
} from './multi-package-publish-verify.mts'
import type { PackAppTriplet } from './pack-app-triplets.mts'
import {
  buildTailPackageName,
  findAllowlistEntry,
} from './source-allowlist.mts'
import type {
  GitHubRepoSlug,
  SourceAllowlistEntry,
} from './source-allowlist.mts'

const logger = getDefaultLogger()

/**
 * Configuration the consumer (socket-bin / socket-addon) supplies. Splits the
 * per-publisher policy from the cross-publisher stage logic.
 */
export interface MultiPackagePublishConfig {
  /**
   * The consumer's source-allowlist. Imported by the consumer from its own
   * `scripts/source-allowlist.mts` and passed in.
   */
  readonly allowlist: readonly SourceAllowlistEntry[]

  /**
   * GitHub `<owner>/<repo>` of the source repo whose release we're staging
   * from. Used to look up the allowlist row + as the `--repo` arg for `gh
   * release download` and `gh attestation verify`.
   */
  readonly sourceRepo: GitHubRepoSlug

  /**
   * Release tag in the source repo. Must match exactly one allowlist row's
   * `tagPattern`.
   */
  readonly releaseTag: string

  /**
   * Locate this consumer's per-tail package directory for a given triplet.
   * Returns the absolute path to the directory containing the tail's
   * `package.json`. The directory MUST exist (the consumer pre-creates per-tail
   * manifest dirs in its repo).
   *
   * Examples:
   *
   * - Socket-bin: `(triplet) => path.join(rootPath, 'packages',
   *   \`${prefix}${triplet}`)`
   * - Socket-addon: `(triplet) => path.join(rootPath, 'packages', 'npm',
   *   '@socketaddon', \`${prefix}${triplet}`)`
   */
  readonly tailDirFor: (triplet: PackAppTriplet) => string

  /**
   * Relative path inside the tail directory where the extracted binary should
   * land. Caller controls so a .node addon goes to e.g. `acorn.node` while a
   * CLI goes to `bin/acorn` (or `bin/acorn.exe` for win32 triplets).
   */
  readonly binaryPathInTail: (triplet: PackAppTriplet) => string

  /**
   * Absolute path to the staging directory the library uses for extraction +
   * verification scratch. Cleared at start, populated during run, left in place
   * on failure.
   */
  readonly stagingDir: string

  /**
   * Optional dry-run flag. When true: download + verify + stage, but don't
   * overwrite the consumer's `packages/<tail>/` tree.
   */
  readonly dryRun?: boolean | undefined

  /**
   * Optional triplet filter — if set, only stage these triplets even if the
   * allowlist entry permits more. For partial-rebuild scenarios or smoke
   * tests.
   */
  readonly tripletsFilter?: readonly PackAppTriplet[] | undefined
}

/**
 * Per-tail staging outcome. Returned for every triplet attempted.
 */
export interface TailStageOutcome {
  readonly triplet: PackAppTriplet
  readonly tailName: string
  readonly version: string
  readonly tailDir: string
  readonly stagedBinary: string
  readonly stagedManifest: string
  readonly sha256: string
}

/**
 * Top-level result of a staging run. Either every tail in the requested set
 * succeeded, or the run aborted at the first failure and `tails` is empty.
 */
export interface MultiPackagePublishResult {
  readonly entry: SourceAllowlistEntry
  readonly releaseTag: string
  readonly version: string
  readonly tails: readonly TailStageOutcome[]
}

/**
 * Thrown when a stage attempt fails. Carries the stage where it failed + the
 * offending tail (if known) so the wrapping script can render a focused error.
 */
export class MultiPackageStageError extends Error {
  readonly stage:
    | 'allowlist-miss'
    | 'tag-version-parse'
    | 'download'
    | 'sha-mismatch'
    | 'sha-list-missing'
    | 'attestation'
    | 'archive-extract'
    | 'tail-dir-missing'
    | 'triplet-conformance'
    | 'name-conformance'
    | 'manifest-write'
  readonly triplet?: PackAppTriplet | undefined

  constructor(
    message: string,
    stage: MultiPackageStageError['stage'],
    triplet?: PackAppTriplet,
  ) {
    super(message)
    this.name = 'MultiPackageStageError'
    this.stage = stage
    this.triplet = triplet
  }
}

/**
 * Stage every tail in a cross-org publish request. Returns the structured
 * staging result on success; throws `MultiPackageStageError` on any failure
 * (the first one encountered — fail-fast).
 *
 * The consumer's wrapping script is responsible for invoking the actual `npm
 * publish` per `tails[i]` after this returns.
 */
export async function stageMultiPackagePublish(
  config: MultiPackagePublishConfig,
): Promise<MultiPackagePublishResult> {
  // Stage 1 — allowlist match.
  const entry = findAllowlistEntry(
    config.allowlist,
    config.sourceRepo,
    config.releaseTag,
  )
  if (!entry) {
    throw new MultiPackageStageError(
      `No allowlist row matches ${config.sourceRepo} tag ${config.releaseTag}. Add a SourceAllowlistEntry or correct the inputs.`,
      'allowlist-miss',
    )
  }
  logger.log(
    `Matched allowlist row: ${entry.familyId} → ${entry.targetScope}/${entry.namePrefix}*`,
  )

  // Stage 2 — parse the version segment off the release tag. Used to
  // stamp every tail's package.json + to validate triplet conformance
  // when archive names are version-suffixed.
  const version = extractVersionFromTag(config.releaseTag, entry.tagPattern)
  if (!version) {
    throw new MultiPackageStageError(
      `Could not extract a semver-shaped version from tag ${config.releaseTag} (pattern ${entry.tagPattern}).`,
      'tag-version-parse',
    )
  }
  logger.log(`Version segment: ${version}`)

  // Stage 3 — reset staging dir.
  await safeDelete(config.stagingDir, { force: true })
  await safeMkdir(config.stagingDir, { recursive: true })

  // Stage 4 — download release assets.
  logger.log(
    `Downloading release assets: ${config.sourceRepo} @ ${config.releaseTag}`,
  )
  const downloadResult = await runGh(
    [
      'release',
      'download',
      config.releaseTag,
      '--repo',
      config.sourceRepo,
      '--dir',
      config.stagingDir,
    ],
    config.stagingDir,
  )
  if (downloadResult.code !== 0) {
    throw new MultiPackageStageError(
      `gh release download failed (exit ${downloadResult.code}): ${downloadResult.stderr}`,
      'download',
    )
  }

  // Stage 5 — read SHA256SUMS.
  const sumsPath = path.join(config.stagingDir, 'SHA256SUMS')
  if (!existsSync(sumsPath)) {
    throw new MultiPackageStageError(
      `Release ${config.releaseTag} has no SHA256SUMS file. Refusing to stage without a hash manifest.`,
      'sha-list-missing',
    )
  }
  const sums = parseShaSums(readFileSync(sumsPath, 'utf8'))

  // Stage 6 — verify SHA256SUMS itself is attested.
  logger.log('Verifying SHA256SUMS attestation')
  await verifyAttestation(sumsPath, config.sourceRepo, entry.attestationSubject)

  // Stage 7 — for each requested triplet, find + verify + extract + stage.
  const tripletsToStage = config.tripletsFilter ?? entry.triplets
  const tripletSet = new Set<PackAppTriplet>(entry.triplets)
  const outcomes: TailStageOutcome[] = []
  for (let i = 0, { length } = tripletsToStage; i < length; i += 1) {
    const triplet = tripletsToStage[i]!
    if (!tripletSet.has(triplet)) {
      throw new MultiPackageStageError(
        `Requested triplet ${triplet} is not in the allowlist row's triplets set.`,
        'triplet-conformance',
        triplet,
      )
    }

    // Find the archive matching this triplet. Convention:
    // `<prefix><triplet>.tgz` or `<prefix><triplet>.tar.gz`.
    const archiveName = findArchiveForTriplet(
      config.stagingDir,
      entry.namePrefix,
      triplet,
    )
    if (!archiveName) {
      throw new MultiPackageStageError(
        `No archive in release for triplet ${triplet} (expected ${entry.namePrefix}${triplet}.{tgz,tar.gz}).`,
        'download',
        triplet,
      )
    }
    const archivePath = path.join(config.stagingDir, archiveName)

    // Verify sha against SHA256SUMS.
    const actualSha = sha256Of(archivePath)
    const expectedSha = sums.get(archiveName)
    if (!expectedSha) {
      throw new MultiPackageStageError(
        `${archiveName} not listed in SHA256SUMS.`,
        'sha-mismatch',
        triplet,
      )
    }
    if (actualSha !== expectedSha) {
      throw new MultiPackageStageError(
        `${archiveName} sha256 mismatch: got ${actualSha}, expected ${expectedSha}.`,
        'sha-mismatch',
        triplet,
      )
    }

    // Verify per-archive attestation.
    // eslint-disable-next-line no-await-in-loop
    await verifyAttestation(
      archivePath,
      config.sourceRepo,
      entry.attestationSubject,
    )

    // Extract.
    const extractDir = path.join(config.stagingDir, `extract-${triplet}`)
    // eslint-disable-next-line no-await-in-loop
    await safeMkdir(extractDir, { recursive: true })
    // eslint-disable-next-line no-await-in-loop
    const extractResult = await runCommand(
      'tar',
      ['-xzf', archivePath, '-C', extractDir],
      config.stagingDir,
    )
    if (extractResult.code !== 0) {
      throw new MultiPackageStageError(
        `tar extract failed for ${archiveName}: ${extractResult.stderr}`,
        'archive-extract',
        triplet,
      )
    }

    // Validate name conformance from extracted manifest.
    const extractedManifestPath = path.join(extractDir, 'package.json')
    if (!existsSync(extractedManifestPath)) {
      throw new MultiPackageStageError(
        `Extracted archive ${archiveName} has no package.json at the top level.`,
        'archive-extract',
        triplet,
      )
    }
    const extractedManifest = JSON.parse(
      readFileSync(extractedManifestPath, 'utf8'),
    ) as { name?: string | undefined; version?: string | undefined }
    const expectedName = buildTailPackageName(entry, triplet)
    if (extractedManifest.name !== expectedName) {
      throw new MultiPackageStageError(
        `Extracted ${archiveName} name mismatch: got ${extractedManifest.name}, expected ${expectedName}.`,
        'name-conformance',
        triplet,
      )
    }

    // Stage into consumer's per-tail dir (unless dry-run).
    const tailDir = config.tailDirFor(triplet)
    if (!existsSync(tailDir)) {
      throw new MultiPackageStageError(
        `Consumer tail directory missing: ${tailDir}. Pre-create the package.json manifest before staging.`,
        'tail-dir-missing',
        triplet,
      )
    }

    const binaryRelative = config.binaryPathInTail(triplet)
    const stagedBinary = path.join(tailDir, binaryRelative)
    const stagedManifest = path.join(tailDir, 'package.json')

    if (!config.dryRun) {
      // Read the consumer's tail manifest, stamp version, write back.
      const consumerManifestRaw = readFileSync(stagedManifest, 'utf8')
      const consumerManifest = JSON.parse(consumerManifestRaw) as {
        name?: string | undefined
      }
      if (consumerManifest.name !== expectedName) {
        throw new MultiPackageStageError(
          `Consumer manifest at ${stagedManifest} declares name ${consumerManifest.name}; expected ${expectedName}.`,
          'name-conformance',
          triplet,
        )
      }
      const stampedManifest = JSON.stringify(
        { ...consumerManifest, version },
        undefined,
        2,
      )
      try {
        writeFileSync(stagedManifest, `${stampedManifest}\n`, 'utf8')
      } catch (e) {
        throw new MultiPackageStageError(
          `Failed to write stamped manifest at ${stagedManifest}: ${errorMessage(e)}`,
          'manifest-write',
          triplet,
        )
      }

      // Move the extracted binary into place. The extracted layout
      // mirrors the published tail, so the binary's relative path
      // inside the extract matches binaryRelative.
      const extractedBinary = path.join(extractDir, binaryRelative)
      if (!existsSync(extractedBinary)) {
        throw new MultiPackageStageError(
          `Extracted archive ${archiveName} has no binary at ${binaryRelative} (relative to archive root).`,
          'archive-extract',
          triplet,
        )
      }
      // eslint-disable-next-line no-await-in-loop
      await safeMkdir(path.dirname(stagedBinary), { recursive: true })
      writeFileSync(stagedBinary, readFileSync(extractedBinary))
    }

    outcomes.push({
      triplet,
      tailName: expectedName,
      version,
      tailDir,
      stagedBinary,
      stagedManifest,
      sha256: actualSha,
    })

    logger.success(
      `Staged ${expectedName}@${version}${config.dryRun ? ' [dry-run]' : ''}`,
    )
  }

  return {
    entry,
    releaseTag: config.releaseTag,
    version,
    tails: outcomes,
  }
}
