#!/usr/bin/env node
/**
 * @file Phase-2 consumer of the fleet release bundle. Members run this to pull
 *   byte-identical scaffolding from a socket-wheelhouse GitHub Release instead
 *   of a per-file cascade. Downloads the release's tarball + manifest, verifies
 *   EVERY file's SHA-256 against the manifest, and only then places the files
 *   into the repo — a single mismatch fails the whole fetch closed (nothing is
 *   written), so a tampered/partial asset can never land. Auth: ambient `gh`
 *   (GH_TOKEN env / keychain). socket-wheelhouse is private, so in CI the
 *   release App token is exported as GH_TOKEN before this runs. USAGE — `node
 *   scripts/fleet/fetch-fleet-pack.mts --ref <tag> [--repo <owner/repo>]
 *   [--dest <dir>] [--dry-run] [--allow-non-member --reason <why>]`. `--ref` is
 *   the release tag (e.g. `fleet-pack-<sha>`). Default repo
 *   SocketDev/socket-wheelhouse, default dest the repo root. MEMBERSHIP GATE —
 *   the destination (default repo root or `--dest`) must be a fleet-roster
 *   member (origin remote resolved against
 *   `.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json`) before any
 *   file is placed. A non-member destination refuses; the audited escape hatch
 *   is `--allow-non-member --reason "<why>"` — the reason is required and
 *   logged. `--dry-run` writes nothing, so it is exempt.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { hash } from '@socketsecurity/lib/crypto/hash'
import { errorMessage } from '@socketsecurity/lib/errors/message'
import { safeDeleteSync } from '@socketsecurity/lib/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'
import { spawn } from '@socketsecurity/lib/process/spawn/child'

import {
  hasFleetCanonicalEndSentinel,
  isFleetCanonicalSpliceFile,
  spliceFleetCanonicalContent,
} from './_shared/fleet-canonical-splice.mts'
import {
  gateWriteDest,
  parseNonMemberOverride,
} from './_shared/fleet-membership.mts'
import {
  withMirrorLockLiftedSync,
  writeThroughMirrorLock,
} from './_shared/mirror-lock.mts'

const logger = getDefaultLogger()

const DEFAULT_REPO = 'SocketDev/socket-wheelhouse'
const MANIFEST_NAME = 'release-bundle-manifest.json'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

export interface FetchConfig {
  allowNonMember: boolean
  dest: string
  dryRun: boolean
  reason: string | undefined
  ref: string | undefined
  repo: string
}

export function parseArgs(argv: readonly string[]): FetchConfig {
  const override = parseNonMemberOverride(argv)
  const opts = {
    __proto__: null,
    allowNonMember: override.allowNonMember,
    dest: repoRoot,
    dryRun: argv.includes('--dry-run'),
    reason: override.reason,
    ref: undefined,
    repo: DEFAULT_REPO,
  } as unknown as FetchConfig
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--ref') {
      opts.ref = argv[++i]
    } else if (arg === '--repo') {
      opts.repo = argv[++i] ?? DEFAULT_REPO
    } else if (arg === '--dest') {
      opts.dest = argv[++i] ?? repoRoot
    }
  }
  return opts
}

// The manifest the producer (make-release-bundle.mts) writes alongside the
// tarball: a flat map of repo-relative path → sha256 hex, plus the tombstoned
// paths a past bundle shipped that have since moved/retired and the shipped
// GENERATED outputs that must never be git-tracked.
export interface BundleManifest {
  readonly files: Record<string, string>
  readonly generatedPaths?: readonly string[] | undefined
  readonly movedPaths?: ReadonlyArray<{ from: string; to: string }> | undefined
  readonly removedPaths?: readonly string[] | undefined
  readonly templateSha: string
  readonly version: string
}

async function run(command: string, args: readonly string[]): Promise<void> {
  await spawn(command, args as string[], { stdioString: true })
}

// Recursively list files under `dir`, returned relative to `base`.
export function walkFiles(dir: string, base: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs, base))
    } else if (entry.isFile()) {
      out.push(path.relative(base, abs))
    }
  }
  return out
}

// Compare every manifest entry against the extracted file's actual SHA-256.
// Returns the list of problems, missing or mismatched — empty means verified.
export function verifyFiles(
  filesDir: string,
  manifest: BundleManifest,
): string[] {
  const problems: string[] = []
  const relList = Object.keys(manifest.files)
  for (let i = 0, { length } = relList; i < length; i += 1) {
    const rel = relList[i]!
    const abs = path.join(filesDir, rel)
    if (!existsSync(abs)) {
      problems.push(`missing from bundle: ${rel}`)
      continue
    }
    const actual = hash('sha256', readFileSync(abs), 'hex')
    if (actual !== manifest.files[rel]) {
      problems.push(`sha256 mismatch: ${rel}`)
    }
  }
  return problems
}

// Place verified bundle files into the repo. Sentinel-scoped ONLY for the
// DESIGNATED segment files (FLEET_CANONICAL_SPLICE_FILES — today
// `.config/fleet/oxlintrc.json`): the bundle bytes replace everything through
// the fleet-canonical end sentinel, and the repo-local tail after it survives
// byte-for-byte. The lint runner re-emits that tail as CLI ignore args, so a
// whole-file copy there silently unmasks hundreds of findings — the recurring
// socket-registry incident. Every other file is a plain byte copy — the PATH
// gate is load-bearing: content-only gating spliced ANY placed file that
// merely mentioned the sentinel token, stitching stale member tails onto
// fresh bundle heads (the v1.0.14 fetcher-chimera incident, seeded by this
// very comment carrying the raw token). A designated file landing for the
// first time also byte-copies.
export function placeFiles(
  filesDir: string,
  rels: readonly string[],
  destDir: string,
): void {
  for (let i = 0, { length } = rels; i < length; i += 1) {
    const rel = rels[i]!
    const src = path.join(filesDir, rel)
    const dest = path.join(destDir, rel)
    mkdirSync(path.dirname(dest), { recursive: true })
    if (isFleetCanonicalSpliceFile(rel) && existsSync(dest)) {
      const srcContent = readFileSync(src, 'utf8')
      if (hasFleetCanonicalEndSentinel(srcContent)) {
        writeThroughMirrorLock(
          dest,
          spliceFleetCanonicalContent(srcContent, readFileSync(dest, 'utf8')),
        )
        continue
      }
    }
    withMirrorLockLiftedSync(dest, () => cpSync(src, dest))
  }
}

// Untrack the manifest's GENERATED outputs (`generatedPaths`) after
// placement, mirroring the bootstrap installer's untrackGeneratedOutputs: the
// bundle SHIPS these files, placement keeps them on disk, while the fleet
// gitignore block ignores them and `generated-outputs-are-untracked` forbids
// TRACKING them. A member that historically committed one (the root MCP
// projections `opencode.json` + `.kimi-code/mcp.json`, `fleet-pack.cjs` et al.)
// heals on the next fetch: the file stays on disk but leaves the index.
// Non-fatal by design; a non-git dest or an already-clean index is a no-op
// (`--ignore-unmatch`). Returns the count of declared paths submitted for
// untracking (0 when skipped or failed).
export async function untrackGeneratedOutputs(
  destDir: string,
  manifest: BundleManifest,
): Promise<number> {
  const generatedPaths = manifest.generatedPaths
  if (!generatedPaths || generatedPaths.length === 0) {
    return 0
  }
  // `.git` is a dir in a normal checkout and a FILE in a worktree/submodule;
  // existsSync covers both. A non-git dest has no index to heal.
  if (!existsSync(path.join(destDir, '.git'))) {
    return 0
  }
  try {
    await spawn(
      'git',
      [
        'rm',
        '--cached',
        '--quiet',
        '--ignore-unmatch',
        '--',
        ...generatedPaths,
      ],
      { cwd: destDir, stdioString: true },
    )
  } catch (e) {
    logger.warn(
      `Untracking generated outputs failed (non-fatal): ${errorMessage(e)}`,
    )
    return 0
  }
  return generatedPaths.length
}

// Apply the manifest's per-repo-owned file MOVES (movedPaths) — the rename
// half of relocating a file the fleet does NOT byte-mirror, mirroring the
// bootstrap installer's applyMovedPaths. A plain tombstone would delete the
// member's only copy (the file is repo-owned; the bundle never ships it), so
// rename `from` → `to` when `to` is absent — repo-owned content survives
// byte-for-byte — and delete a stale `from` leftover once `to` exists. Runs
// BEFORE removeTombstonedPaths. Belt: a move whose `from` the manifest ships
// a file at/under is skipped. Returns the count of paths acted on.
export function applyMovedPaths(
  destDir: string,
  manifest: BundleManifest,
): number {
  const movedPaths = manifest.movedPaths
  if (!movedPaths || movedPaths.length === 0) {
    return 0
  }
  const shipped = Object.keys(manifest.files).map(rel => normalizePath(rel))
  let moved = 0
  for (let i = 0, { length } = movedPaths; i < length; i += 1) {
    const entry = movedPaths[i]!
    const from = normalizePath(entry.from)
    const to = normalizePath(entry.to)
    if (
      !from ||
      !to ||
      shipped.some(f => f === from || f.startsWith(`${from}/`))
    ) {
      continue
    }
    const fromAbs = path.join(destDir, from)
    if (!existsSync(fromAbs)) {
      continue
    }
    const toAbs = path.join(destDir, to)
    if (existsSync(toAbs)) {
      // The canonical copy already exists — the leftover source is stale.
      safeDeleteSync(fromAbs)
    } else {
      mkdirSync(path.dirname(toAbs), { recursive: true })
      renameSync(fromAbs, toAbs)
    }
    moved += 1
  }
  return moved
}

// Delete the manifest's TOMBSTONED paths, files or whole dirs, that still
// exist in the repo — the deletion half of a fleet move/retire, mirroring the
// bootstrap installer's removeTombstonedPaths (a bundle refresh must be a true
// sync: the v1.0.12 `.github/actions/fleet/lib` → `_shared` move shipped no
// deletion and orphaned `lib/` fleet-wide). Belt: a tombstone the current
// manifest ships a file at/under is skipped, so a bad producer entry can never
// delete freshly placed payload. Returns the count deleted.
export function removeTombstonedPaths(
  destDir: string,
  manifest: BundleManifest,
): number {
  const removedPaths = manifest.removedPaths
  if (!removedPaths || removedPaths.length === 0) {
    return 0
  }
  const shipped = Object.keys(manifest.files).map(rel => normalizePath(rel))
  let removed = 0
  for (let i = 0, { length } = removedPaths; i < length; i += 1) {
    const rel = normalizePath(removedPaths[i]!)
    if (!rel || shipped.some(f => f === rel || f.startsWith(`${rel}/`))) {
      continue
    }
    const abs = path.join(destDir, rel)
    if (existsSync(abs)) {
      safeDeleteSync(abs)
      removed += 1
    }
  }
  return removed
}

export async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.ref) {
    logger.error(
      'Missing --ref. Pass the release tag to fetch, e.g. `--ref fleet-pack-<sha>`.',
    )
    return 1
  }

  // Membership gate — refuse a non-member destination before anything is
  // downloaded or placed. `--dry-run` writes nothing, so it is exempt.
  if (!opts.dryRun) {
    const gate = gateWriteDest({
      destDir: opts.dest,
      override: { allowNonMember: opts.allowNonMember, reason: opts.reason },
      toolName: 'fetch-fleet-pack',
    })
    if (!gate.allowed) {
      logger.error(gate.message)
      return 1
    }
    if (gate.note !== undefined) {
      logger.warn(gate.note)
    }
  }

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fleet-pack-'))
  try {
    // 1. Download the tarball + manifest assets via gh, ambient auth.
    logger.log(`Downloading bundle ${opts.ref} from ${opts.repo}…`)
    try {
      await run('gh', [
        'release',
        'download',
        opts.ref,
        '--repo',
        opts.repo,
        '--pattern',
        'socket-wheelhouse-fleet-*.tar.gz',
        '--pattern',
        MANIFEST_NAME,
        '--dir',
        tmp,
      ])
    } catch (e) {
      logger.error(
        `Download failed for ${opts.repo}@${opts.ref}: ${errorMessage(e)}. ` +
          'Check the tag exists and GH_TOKEN can read the repo.',
      )
      return 1
    }

    // 2. Read the manifest.
    const manifestPath = path.join(tmp, MANIFEST_NAME)
    if (!existsSync(manifestPath)) {
      logger.error(`Release ${opts.ref} has no ${MANIFEST_NAME} asset.`)
      return 1
    }
    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as BundleManifest

    // 3. Extract the tarball → tmp/extracted/files/<repo-relative-path>.
    const tarball = readdirSync(tmp).find(f => f.endsWith('.tar.gz'))
    if (!tarball) {
      logger.error(`Release ${opts.ref} has no .tar.gz asset.`)
      return 1
    }
    const extractDir = path.join(tmp, 'extracted')
    mkdirSync(extractDir, { recursive: true })
    await run('tar', ['-xzf', path.join(tmp, tarball), '-C', extractDir])
    const filesDir = path.join(extractDir, 'files')
    if (!existsSync(filesDir)) {
      logger.error(
        `Bundle ${opts.ref} has no files/ directory — unexpected layout.`,
      )
      return 1
    }

    // 4. Verify EVERY file's SHA-256 before placing anything, fail closed.
    const problems = verifyFiles(filesDir, manifest)
    if (problems.length > 0) {
      logger.error(
        `Bundle verification FAILED for ${opts.ref} (${problems.length} ` +
          `problem(s)); nothing written. First few:\n  ${problems.slice(0, 5).join('\n  ')}`,
      )
      return 1
    }

    const count = Object.keys(manifest.files).length
    if (opts.dryRun) {
      logger.log(
        `[dry-run] ${count} file(s) verified for ${opts.ref} (template ` +
          `${manifest.templateSha}). Would write into ${opts.dest}.`,
      )
      return 0
    }

    // 5. Place the verified files into the repo, then drop any tombstoned
    // paths (moved/retired payload) still present — the deletion half of a
    // fleet move, so a refresh is a true sync.
    placeFiles(filesDir, Object.keys(manifest.files), opts.dest)
    await untrackGeneratedOutputs(opts.dest, manifest)
    const moved = applyMovedPaths(opts.dest, manifest)
    const tombstoned = removeTombstonedPaths(opts.dest, manifest)
    const movedNote = moved > 0 ? `, moved ${moved} relocated path(s)` : ''
    const tombstonedNote =
      tombstoned > 0 ? `, removed ${tombstoned} tombstoned path(s)` : ''
    logger.log(
      `Placed ${count} verified file(s)${movedNote}${tombstonedNote} from ${opts.ref} (template ${manifest.templateSha}).`,
    )
    return 0
  } finally {
    safeDeleteSync(tmp)
  }
}

main().then(
  code => {
    process.exitCode = code
  },
  (e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  },
)
