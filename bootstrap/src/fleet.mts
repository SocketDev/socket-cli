/*
 * @file Source entry for the zero-npm-dependency fleet bundle installer. A
 *   consumer repo needs only the BUILT single file (`bootstrap/fleet.mjs`)
 *   copied in plus one package.json script. Running it downloads the release
 *   bundle from a socket-wheelhouse GitHub Release, verifies every file's
 *   SHA-256, copies byte-identical files into <dest>, and splices the
 *   fleet-canonical block into each hybrid file (CLAUDE.md, .gitignore, …) that
 *   carries fleet-canonical open/close markers.
 *
 *   Zero deps: only node: builtins + system tools `gh` (download) and `tar`
 *   (extract). No in-repo `@socketsecurity/*` socket-lib — only the published
 *   lib-stable logger — so it cascades into consumer repos that don't have the
 *   wheelhouse dep tree.
 *
 *   This file is the modular SOURCE; `scripts/fleet/build-bootstrap-fetcher.mts`
 *   inlines it + its `./helpers.mts` / `./install.mts` siblings into the single
 *   distributed `bootstrap/fleet.mjs` (the one cascaded + copied). `import.meta.url`
 *   resolves at the BUILT location (`bootstrap/`), so `repoRoot` (`..`) is the
 *   repo root only after the build — the source is never run directly.
 *
 *   USAGE: node bootstrap/fleet.mjs --ref <tag> [--repo <owner/repo>]
 *   [--dest <dir>] [--dry-run]
 *   Local validation mode: node bootstrap/fleet.mjs --bundle <tarball>
 *   [--manifest <manifest.json>] [--dest <dir>] [--dry-run]
 */

// socket-lint: allow source-method-order -- entry ordered parseArgs → installFleet (the fetch pipeline), mirroring the dep-0 fetcher's call-flow rather than alphabetized.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  errorMessage,
  readManifest,
  run,
  verifyBundleFiles,
  verifySegments,
} from './helpers.mts'
import type { InstallOptions } from './helpers.mts'
import {
  applyThinMode,
  installFiles,
  installSegments,
  installWorkspaceSegment,
  pruneStaleFleetFiles,
  readAppliedRef,
  readBundleConfig,
  readBundleRef,
  wirePackageJson,
  writeAppliedRef,
} from './install.mts'
import {
  ERR_LOCKSTEP_MISMATCH,
  lockStepExitCode,
  resolveLockStepState,
} from './lockstep.mts'
import type { LockStepConfig } from './lockstep.mts'
import {
  assertLockStep,
  resolveNewestRef,
  resolveReleaseTemplateSha,
} from './resolve.mts'
import { printStatusReport, statusJson } from './status.mts'

// Re-export the helper + install surface so the BUILT single file keeps the
// full public API that tests + the thin-consumer-wiring check import from
// `bootstrap/fleet.mjs` (PREPARE_FETCH, computeSha256, the pure helpers, …).
export * from './helpers.mts'
export * from './install.mts'
export * from './lockstep.mts'
export * from './resolve.mts'
export * from './status.mts'

const logger = getDefaultLogger()

const DEFAULT_REPO = 'SocketDev/socket-wheelhouse'
const MANIFEST_NAME = 'release-bundle-manifest.json'

// The BUILT file lives at <repo-root>/bootstrap/, so one level up is the repo
// root. (The source lives at bootstrap/src/ but is never run — only inlined.)
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

export function parseArgs(argv: readonly string[]): InstallOptions {
  const opts = {
    __proto__: null,
    bundle: undefined,
    dest: repoRoot,
    dryRun: false,
    exitCode: false,
    ifCurrent: false,
    json: false,
    manifest: undefined,
    noHeader: false,
    quiet: false,
    ref: '',
    repo: DEFAULT_REPO,
    status: false,
    thin: false,
    wire: false,
  } as unknown as {
    bundle: string | undefined
    dest: string
    dryRun: boolean
    exitCode: boolean
    ifCurrent: boolean
    json: boolean
    manifest: string | undefined
    noHeader: boolean
    quiet: boolean
    ref: string
    repo: string
    status: boolean
    thin: boolean
    wire: boolean
  }
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]
    if (arg === undefined) {
      break
    }
    if (arg === '--dest') {
      opts.dest = argv[++i] ?? repoRoot
    } else if (arg === '--bundle') {
      opts.bundle = argv[++i]
    } else if (arg === '--dry-run') {
      opts.dryRun = true
    } else if (arg === '--exit-code') {
      opts.exitCode = true
    } else if (arg === '--if-current') {
      opts.ifCurrent = true
    } else if (arg === '--json') {
      opts.json = true
    } else if (arg === '--manifest') {
      opts.manifest = argv[++i]
    } else if (arg === '--no-header') {
      opts.noHeader = true
    } else if (arg === '--quiet') {
      opts.quiet = true
    } else if (arg === '--ref') {
      opts.ref = argv[++i] ?? ''
    } else if (arg === '--repo') {
      opts.repo = argv[++i] ?? DEFAULT_REPO
    } else if (arg === '--status') {
      opts.status = true
    } else if (arg === '--thin') {
      opts.thin = true
    } else if (arg === '--wire') {
      opts.wire = true
    }
  }
  return opts as InstallOptions
}

// resolveReleaseTemplateSha, resolveNewestRef, and assertLockStep live in
// ./resolve.mts (extracted to keep this file under the 500-line soft cap).

/**
 * Render the `fleet:status` report. Read-only — NEVER mutates. Resolves the
 * pinned release's templateSha + the newest release, builds the lock-step
 * state, prints the table / JSON / line, and returns the terraform-style exit
 * code (0 CURRENT, 0|10 UPDATE-AVAILABLE, 1 OUT-OF-SYNC).
 */
export function runStatus(options: InstallOptions): number {
  const opts = { __proto__: null, ...options } as InstallOptions
  const dest = path.resolve(opts.dest ?? repoRoot)
  const repo = opts.repo ?? DEFAULT_REPO
  const cfg = readBundleConfig(dest)
  const ref = opts.ref || cfg.ref || ''
  if (!ref) {
    if (!opts.quiet) {
      logger.log(
        'fleet:status: no bundle.ref pinned in .config/socket-wheelhouse.json — not a thin consumer.',
      )
    }
    return 0
  }
  const config: LockStepConfig = {
    cascadeSha: cfg.cascadeSha ?? '',
    ref,
  }
  const pinnedTemplateSha = resolveReleaseTemplateSha(ref, repo)
  const newestRef = resolveNewestRef(repo)
  const newestTemplateSha =
    newestRef === undefined
      ? undefined
      : newestRef === ref
        ? pinnedTemplateSha
        : resolveReleaseTemplateSha(newestRef, repo)
  const state = resolveLockStepState({
    config,
    newestRef,
    newestTemplateSha,
    pinnedTemplateSha,
  })
  if (opts.json) {
    if (!opts.quiet) {
      logger.log(JSON.stringify(statusJson(state)))
    }
  } else if (!opts.quiet) {
    printStatusReport(state, { noHeader: opts.noHeader ?? false })
  }
  return lockStepExitCode(state, { exitCode: opts.exitCode ?? false })
}

/**
 * Download, verify, and apply the fleet bundle identified by `options.ref`.
 * Returns 0 on success, 1 on any error.
 */
export async function installFleet(options: InstallOptions): Promise<number> {
  const opts = { __proto__: null, ...options } as InstallOptions
  const dest = path.resolve(opts.dest ?? repoRoot)
  const bundlePath =
    opts.bundle !== undefined ? path.resolve(opts.bundle) : undefined
  const manifestPath =
    opts.manifest !== undefined ? path.resolve(opts.manifest) : undefined
  // Resolve the ref: an explicit --ref wins, else the member's pinned
  // `bundle.ref` (so the pin lives in exactly one place — the settings file).
  const ref = opts.ref || readBundleRef(dest) || ''
  if (!ref && bundlePath === undefined) {
    // --if-current is the CI/prepare-safe mode: a repo with no pinned
    // `bundle.ref` isn't a thin consumer, so there's nothing to fetch. No-op
    // success lets the belt (prepare) + suspenders (CI) call this
    // unconditionally — it stays inert in the wheelhouse + non-thin members.
    if (opts.ifCurrent) {
      logger.log(
        'install-fleet: no bundle.ref pinned — not a thin consumer, ' +
          'nothing to fetch.',
      )
      return 0
    }
    logger.log(
      'install-fleet: no --ref and no `bundle.ref` in ' +
        `${'.config/socket-wheelhouse.json'}. Pass --ref fleet-<sha> or set bundle.ref.`,
    )
    return 1
  }
  // Idempotent warm path: the belt/prepare wire passes --if-current, so a
  // `pnpm install` whose pinned ref is already applied does no network.
  if (opts.ifCurrent && readAppliedRef(dest) === ref) {
    logger.log(`install-fleet: bundle ${ref} already applied — skipping fetch.`)
    return 0
  }
  const repo = opts.repo ?? DEFAULT_REPO
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fleet-install-'))
  try {
    let sourceTarball: string
    let sourceManifest: string
    if (bundlePath !== undefined) {
      sourceTarball = bundlePath
      sourceManifest =
        manifestPath ?? path.join(path.dirname(bundlePath), MANIFEST_NAME)
      if (!existsSync(sourceTarball)) {
        logger.log(`install-fleet: local bundle not found: ${sourceTarball}.`)
        return 1
      }
      if (!existsSync(sourceManifest)) {
        logger.log(
          `install-fleet: local manifest not found: ${sourceManifest}.`,
        )
        return 1
      }
      logger.log(`install-fleet: using local bundle ${sourceTarball}.`)
    } else {
      logger.log(`install-fleet: downloading ${ref} from ${repo}…`)
      try {
        run('gh', [
          'release',
          'download',
          ref,
          '--repo',
          repo,
          '--pattern',
          '*.tar.gz',
          '--pattern',
          MANIFEST_NAME,
          '--dir',
          tmp,
        ])
      } catch (e) {
        logger.log(
          `install-fleet: download failed for ${repo}@${ref}: ${errorMessage(e)}. ` +
            'Check the tag exists and gh is authenticated.',
        )
        return 1
      }
      sourceManifest = path.join(tmp, MANIFEST_NAME)
      if (!existsSync(sourceManifest)) {
        logger.log(
          `install-fleet: release ${ref} has no ${MANIFEST_NAME} asset.`,
        )
        return 1
      }
      const tarball = readdirSync(tmp).find(f => f.endsWith('.tar.gz'))
      if (!tarball) {
        logger.log(`install-fleet: release ${ref} has no .tar.gz asset.`)
        return 1
      }
      sourceTarball = path.join(tmp, tarball)
    }
    const manifest = readManifest(sourceManifest)
    const sourceRef = ref || `local-${manifest.version}`
    const extractDir = path.join(tmp, 'extracted')
    mkdirSync(extractDir, { recursive: true })
    run('tar', ['-xzf', sourceTarball, '-C', extractDir])
    const filesDir = path.join(extractDir, 'files')
    const segmentsDir = path.join(extractDir, 'segments')
    if (!existsSync(filesDir)) {
      logger.log(
        `install-fleet: bundle ${sourceRef} has no files/ directory — unexpected layout.`,
      )
      return 1
    }
    const problems = [
      ...verifyBundleFiles(filesDir, manifest),
      ...verifySegments(segmentsDir, manifest),
    ]
    if (problems.length > 0) {
      logger.log(
        `install-fleet: verification FAILED for ${sourceRef} (${problems.length} problem(s)); ` +
          `nothing written. First few:\n  ${problems.slice(0, 5).join('\n  ')}`,
      )
      return 1
    }
    // LOCK-STEP VERIFY (before any apply): the member's pinned bundle.cascadeSha
    // MUST equal this release's templateSha. `--frozen-lockfile` semantics — a
    // mismatch is a hard fail; we NEVER unpack a release that disagrees with the
    // landed cascade. The opt-out env silences only the PASSIVE notice, never
    // this gate. Skipped for a local --bundle validation run (no member pin).
    if (bundlePath === undefined) {
      const cascadeSha = readBundleConfig(dest).cascadeSha
      if (
        !assertLockStep({
          cascadeSha,
          manifestTemplateSha: manifest.templateSha,
          ref: sourceRef,
        })
      ) {
        logger.error(
          `install-fleet: ${ERR_LOCKSTEP_MISMATCH} — refusing to apply ${sourceRef}; nothing written.`,
        )
        return 1
      }
    }
    const fileCount = Object.keys(manifest.files).length
    const segmentCount = manifest.segments?.length ?? 0
    if (opts.dryRun) {
      logger.log(
        `install-fleet: [dry-run] ${fileCount} file(s) + ${segmentCount} segment(s) verified ` +
          `for ${sourceRef} (template ${manifest.templateSha}). Would write into ${dest}.`,
      )
      return 0
    }
    installFiles(filesDir, dest, manifest)
    // The fetch is a SYNC: after placing the bundle, prune any wholly-fleet file
    // on disk the current bundle no longer ships, so members stay clean without
    // a separate cleanup pass.
    const prunedCount = pruneStaleFleetFiles(dest, manifest)
    installSegments(segmentsDir, dest, manifest)
    const wsResult = installWorkspaceSegment(segmentsDir, dest, manifest)
    if (wsResult !== 0) {
      return wsResult
    }
    if (opts.wire) {
      wirePackageJson(dest)
    }
    if (opts.thin) {
      applyThinMode({ dest, manifest })
    }
    // Record the applied ref so a subsequent --if-current run can skip a warm
    // re-fetch. Written after a successful apply only.
    writeAppliedRef(dest, sourceRef)
    const prunedNote = prunedCount > 0 ? `, pruned ${prunedCount} stale` : ''
    logger.log(
      `install-fleet: placed ${fileCount} file(s) + ${segmentCount} segment(s)${prunedNote} from ${sourceRef} ` +
        `(template ${manifest.templateSha}) → ${dest}.`,
    )
    return 0
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const parsed = parseArgs(process.argv.slice(2))
  // `--status` is the read-only verb (NEVER mutates) — dispatch before the
  // fetch path so a status query can't accidentally apply anything.
  process.exitCode = parsed.status
    ? runStatus(parsed)
    : // socket-lint: allow top-level-await -- dep-0 ESM CLI run via node, never CJS-bundled
      await installFleet(parsed)
}
