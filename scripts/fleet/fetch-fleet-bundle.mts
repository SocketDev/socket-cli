#!/usr/bin/env node
/**
 * @file Phase-2 consumer of the fleet release bundle. Members run this to pull
 *   byte-identical scaffolding from a socket-wheelhouse GitHub Release instead
 *   of a per-file cascade. Downloads the release's tarball + manifest, verifies
 *   EVERY file's SHA-256 against the manifest, and only then places the files
 *   into the repo — a single mismatch fails the whole fetch closed (nothing is
 *   written), so a tampered/partial asset can never land.
 *   Auth: ambient `gh` (GH_TOKEN env / keychain). socket-wheelhouse is private,
 *   so in CI the release App token is exported as GH_TOKEN before this runs.
 *   USAGE — `node scripts/fleet/fetch-fleet-bundle.mts --ref <tag>
 *   [--repo <owner/repo>] [--dest <dir>] [--dry-run]`. `--ref` is the release
 *   tag (e.g. `fleet-<sha>`). Default repo SocketDev/socket-wheelhouse, default
 *   dest the repo root.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { hash } from '@socketsecurity/lib/crypto/hash'
import { errorMessage } from '@socketsecurity/lib/errors'
import { safeDeleteSync } from '@socketsecurity/lib/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'
import { spawn } from '@socketsecurity/lib/process/spawn/child'

const logger = getDefaultLogger()

const DEFAULT_REPO = 'SocketDev/socket-wheelhouse'
const MANIFEST_NAME = 'release-bundle-manifest.json'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

export interface FetchOptions {
  dest: string
  dryRun: boolean
  ref: string | undefined
  repo: string
}

export function parseArgs(argv: readonly string[]): FetchOptions {
  const opts = {
    __proto__: null,
    dest: repoRoot,
    dryRun: argv.includes('--dry-run'),
    ref: undefined,
    repo: DEFAULT_REPO,
  } as unknown as FetchOptions
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
// tarball: a flat map of repo-relative path → sha256 hex.
export interface BundleManifest {
  readonly files: Record<string, string>
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
// Returns the list of problems (missing or mismatched) — empty means verified.
export function verifyFiles(
  filesDir: string,
  manifest: BundleManifest,
): string[] {
  const problems: string[] = []
  for (const rel of Object.keys(manifest.files)) {
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

export async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.ref) {
    logger.error(
      'Missing --ref. Pass the release tag to fetch, e.g. `--ref fleet-<sha>`.',
    )
    return 1
  }

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fleet-bundle-'))
  try {
    // 1. Download the tarball + manifest assets via gh (ambient auth).
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

    // 4. Verify EVERY file's SHA-256 before placing anything (fail closed).
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

    // 5. Place the verified files into the repo.
    for (const rel of Object.keys(manifest.files)) {
      const dest = path.join(opts.dest, rel)
      mkdirSync(path.dirname(dest), { recursive: true })
      cpSync(path.join(filesDir, rel), dest)
    }
    logger.log(
      `Placed ${count} verified file(s) from ${opts.ref} (template ${manifest.templateSha}).`,
    )
    return 0
  } finally {
    safeDeleteSync(tmp)
  }
}

process.exitCode = await main()
