/**
 * @file Registry-agnostic post-publish release orchestration: derive the
 *   GitHub release body from CHANGELOG.md, then create the git tag + the
 *   IMMUTABLE (draft → upload → undraft) GitHub release carrying the tarball
 *   \+ a checksums file. A future cargo publish reuses this tier verbatim.
 */

import crypto from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { sleep } from '@socketsecurity/lib/promises/timers'

import { logger, rootPath, runCapture } from './shared.mts'

/**
 * Extract the CHANGELOG.md section for `version` (from its `## <version>`
 * heading to the next `## `). The release body comes from here so the GitHub
 * release and the changelog can never tell different stories. Falls back to a
 * one-liner when the file or section is missing.
 */
export function extractChangelogSection(version: string): string {
  const changelogPath = path.join(rootPath, 'CHANGELOG.md')
  if (!existsSync(changelogPath)) {
    return `Release ${version}.`
  }
  const text = readFileSync(changelogPath, 'utf8')
  const lines = text.split('\n')
  // Heading shapes seen across the fleet: `## 1.2.3`, `## [1.2.3]`,
  // `## v1.2.3`, each optionally followed by a date.
  const isVersionHeading = (line: string): boolean => {
    if (!line.startsWith('## ')) {
      return false
    }
    const rest = line.slice(3).trim().replace(/^\[/, '').replace(/^v/, '')
    return rest.startsWith(version)
  }
  const start = lines.findIndex(isVersionHeading)
  if (start === -1) {
    return `Release ${version}.`
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i]!.startsWith('## ')) {
      end = i
      break
    }
  }
  const body = lines
    .slice(start + 1, end)
    .join('\n')
    .trim()
  return body || `Release ${version}.`
}

/**
 * The registry-liveness gate the tag + GitHub release stand behind: the git
 * tag and the immutable release are the LAST markers of a release, so they
 * may only exist once the version is actually resolvable on its registry. A
 * STAGED package is not published — staging may never be approved — and a
 * near-miss (v6.2.0) once cut the immutable release first, then the publish
 * failed on auth, leaving a release with no artifact that even 422-rejected
 * its own checksums upload. Polls `isLive` (registry propagation lags a few
 * seconds behind a publish), fails LOUD and returns false when the version
 * never turns up. `sleepFn` is injectable for tests.
 */
export async function requireRegistryLive(config: {
  attempts?: number | undefined
  delayMs?: number | undefined
  isLive: () => Promise<boolean>
  registry: string
  sleepFn?: ((ms: number) => Promise<void>) | undefined
  subject: string
}): Promise<boolean> {
  const cfg = { __proto__: null, ...config } as typeof config
  const attempts = cfg.attempts ?? 6
  const delayMs = cfg.delayMs ?? 5000
  const sleepFn = cfg.sleepFn ?? sleep
  for (let i = 0; i < attempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await cfg.isLive()) {
      return true
    }
    if (i < attempts - 1) {
      logger.log(
        `${cfg.subject} not yet resolvable on ${cfg.registry} ` +
          `(attempt ${i + 1}/${attempts}); retrying in ${delayMs / 1000}s…`,
      )
      // eslint-disable-next-line no-await-in-loop
      await sleepFn(delayMs)
    }
  }
  logger.fail(
    `Refusing to cut the tag + GitHub release: ${cfg.subject} is not ` +
      `resolvable on ${cfg.registry} after ${attempts} attempts.\n` +
      `  The immutable release is the FINAL marker of a release — it can only ` +
      `follow a live registry publish, never precede one.\n` +
      `  Fix: confirm the publish actually completed (auth? staged-but-never-` +
      `approved?), then re-run — the release step is idempotent.`,
  )
  return false
}

/**
 * The shared post-publish tail every channel funnels through: gate on
 * registry liveness (requireRegistryLive), then — and only then — create the
 * git tag + immutable GitHub release. Returns false (after failing loud)
 * when the version never turned up, so the caller can set a non-zero exit
 * code; the release is never attempted in that case. `ensureRelease` and
 * `sleepFn` are injectable for tests.
 */
export async function releaseBehindLiveGate(config: {
  attempts?: number | undefined
  delayMs?: number | undefined
  ensureRelease?:
    | ((
        pkg: { name: string; version: string },
        options?:
          | { packAssets?: (() => Promise<string[]>) | undefined }
          | undefined,
      ) => Promise<void>)
    | undefined
  isLive: () => Promise<boolean>
  packAssets?: (() => Promise<string[]>) | undefined
  pkg: { name: string; version: string }
  registry: string
  sleepFn?: ((ms: number) => Promise<void>) | undefined
}): Promise<boolean> {
  const cfg = { __proto__: null, ...config } as typeof config
  const live = await requireRegistryLive({
    attempts: cfg.attempts,
    delayMs: cfg.delayMs,
    isLive: cfg.isLive,
    registry: cfg.registry,
    sleepFn: cfg.sleepFn,
    subject: `${cfg.pkg.name}@${cfg.pkg.version}`,
  })
  if (!live) {
    return false
  }
  const ensureRelease = cfg.ensureRelease ?? ensureTagAndRelease
  await ensureRelease(
    cfg.pkg,
    cfg.packAssets ? { packAssets: cfg.packAssets } : undefined,
  )
  return true
}

/**
 * Default (npm) release-asset packer: `pnpm pack` the tarball in this same run
 * (the bytes the registry received) + write a `checksums.txt` (sha1 + sha512),
 * returning both paths. Returns an empty array (with a warning) when the pack
 * fails, so the release still lands without assets. Extracted so
 * `ensureTagAndRelease` can accept an alternate packer without changing the npm
 * behavior.
 */
async function defaultPackAssets(pkg: {
  name: string
  version: string
}): Promise<string[]> {
  const packed = await runCapture('pnpm', ['pack'], rootPath)
  const tarballName = `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`
  const tarballPath = path.join(rootPath, tarballName)
  if (packed.code !== 0 || !existsSync(tarballPath)) {
    logger.warn(`pnpm pack failed (${packed.code}); releasing without assets.`)
    return []
  }
  const bytes = readFileSync(tarballPath)
  const sha1 = crypto.createHash('sha1').update(bytes).digest('hex')
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64')
  const checksumsPath = path.join(rootPath, 'checksums.txt')
  writeFileSync(
    checksumsPath,
    `sha1: ${sha1}  ${tarballName}\nsha512-base64: ${sha512}  ${tarballName}\n`,
  )
  logger.log(`Tarball sha1 ${sha1} (compare with the npm staged shasum).`)
  return [tarballPath, checksumsPath]
}

/**
 * Post-publish: make the git tag + GitHub release exist for this version.
 * Tag-if-missing (push tolerated when the remote already has it); the release
 * body is the version's CHANGELOG section; the release ships IMMUTABLE via the
 * 3-step draft → upload → undraft flow. Assets are the tarball packed from
 * this same tree in this same run — the identical bytes the registry just
 * received — plus a checksums file (sha1 + sha512), so the GitHub-release
 * shasum is directly comparable to the npm staged/published shasum.
 *
 * A failure here exits non-zero so the gap is visible, but the registry write
 * has already succeeded — the operator fixes the tag/release, not the publish.
 *
 * `options.packAssets` generalizes the release asset packing off npm: when
 * provided it is called to produce the asset file paths (the cargo tier passes
 * a packer that returns `[cratePath, checksumsPath]`); when omitted the exact
 * `pnpm pack` behavior is kept, so the npm path is unchanged.
 */
export async function ensureTagAndRelease(
  pkg: {
    name: string
    version: string
  },
  options?:
    | {
        packAssets?: (() => Promise<string[]>) | undefined
      }
    | undefined,
): Promise<void> {
  const opts = { __proto__: null, ...options } as {
    packAssets?: (() => Promise<string[]>) | undefined
  }
  const tagName = `v${pkg.version}`
  const tagCheck = await runCapture(
    'git',
    ['rev-parse', '-q', '--verify', `refs/tags/${tagName}`],
    rootPath,
  )
  if (tagCheck.code !== 0) {
    const created = await runCapture('git', ['tag', tagName], rootPath)
    if (created.code !== 0) {
      logger.fail(`could not create tag ${tagName}`)
      process.exitCode = 1
      return
    }
    logger.log(`Created tag ${tagName}.`)
  }
  // Tolerate an already-pushed tag (a parallel/earlier push); any other push
  // failure surfaces below via the release steps needing the remote tag.
  await runCapture('git', ['push', 'origin', tagName], rootPath)

  const view = await runCapture(
    'gh',
    ['release', 'view', tagName, '--json', 'tagName'],
    rootPath,
  )
  if (view.code === 0) {
    logger.log(`Release ${tagName} already exists; leaving it untouched.`)
    return
  }

  const notesFile = path.join(os.tmpdir(), `release-notes-${pkg.version}.md`)
  writeFileSync(notesFile, extractChangelogSection(pkg.version))

  // Pack the release assets: a caller-supplied packer (the cargo tier's
  // `.crate` + checksums) when provided, else the default `pnpm pack` (npm).
  const assets = opts.packAssets
    ? await opts.packAssets()
    : await defaultPackAssets(pkg)

  // Immutable-release pattern: create as draft, upload assets, then undraft.
  // A single-call create would race the Sigstore attestation.
  const create = await runCapture(
    'gh',
    [
      'release',
      'create',
      tagName,
      '--draft',
      '--verify-tag',
      '--title',
      tagName,
      '--notes-file',
      notesFile,
    ],
    rootPath,
  )
  if (create.code !== 0) {
    logger.fail(`gh release create failed (${create.code})`)
    process.exitCode = 1
    return
  }
  if (assets.length) {
    const upload = await runCapture(
      'gh',
      ['release', 'upload', tagName, ...assets],
      rootPath,
    )
    if (upload.code !== 0) {
      logger.fail(`gh release upload failed (${upload.code})`)
      process.exitCode = 1
      return
    }
  }
  const undraft = await runCapture(
    'gh',
    ['release', 'edit', tagName, '--draft=false'],
    rootPath,
  )
  if (undraft.code !== 0) {
    logger.fail(`gh release edit --draft=false failed (${undraft.code})`)
    process.exitCode = 1
    return
  }
  logger.success(`Release ${tagName} published from the CHANGELOG entry.`)
}
