// Fleet check — every tool entry with release:"asset"|"archive" and a
// github: repository references a tag that exists as a real GitHub release.
//
// Schema shape (external-tools-are-valid.mts) catches renamed fields and wrong
// types at the data layer, but it does NOT verify that the pinned version
// actually shipped — a developer can type any string for `version`/`tag` and
// the schema accepts it. The first signal of a fabricated tag is then an
// asset-download failure deep in the build, far from the edit that caused it.
//
// This check closes that gap: for every `release:"asset"|"archive"` entry that
// declares a `repository: "github:<owner>/<repo>"` it runs
// `gh release view <tag> --repo <owner>/<repo> --json tagName` and fails if the
// release is not found. Tag derivation mirrors the build scripts: the `tag`
// field takes precedence; when absent, `version` is used; when the stored tag
// has no `v` prefix, the check also probes `v<tag>` as a fallback (many tools
// tag as `vX.Y.Z` but document the version without the prefix).
//
// Network-gated: the check skips gracefully when:
//   - `gh` is not on PATH,
//   - `gh auth status` fails (unauthenticated),
//   - the `gh release view` call returns a network error.
// In each skip case the script logs the reason and exits 0 so offline
// development and CI environments without a gh token are not broken.
//
// Wire-up: called as a separate step in scripts/fleet/check.mts AFTER the
// fast schema check (external-tools-are-valid.mts). Keeping the two steps
// separate preserves the offline-safe property of the schema check.
//
// --dry-run: print every tool→tag probe (as SKIP/FOUND/NOT FOUND) without
// actually failing the check. Useful for verifying the script's own logic.
//
// Usage:
//   node scripts/fleet/check/external-tools-release-tags-resolve.mts
//   node scripts/fleet/check/external-tools-release-tags-resolve.mts --dry-run
//   node scripts/fleet/check/external-tools-release-tags-resolve.mts --quiet

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { findToolFiles } from './external-tools-are-valid.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

export interface TagProbe {
  readonly file: string
  readonly toolName: string
  readonly ownerRepo: string
  readonly tag: string
  readonly resolvedTag: string | undefined
  readonly found: boolean
  readonly skipped: boolean
  readonly skipReason: string | undefined
}

export interface ReleaseCheckResult {
  readonly probes: TagProbe[]
  readonly skippedAll: boolean
  readonly skipReason: string | undefined
}

/**
 * Derive the GitHub release tag to probe for a tool entry. The `tag` field
 * takes precedence; when absent, `version` is used. Returns undefined when
 * neither field is set (the entry lacks enough data to check).
 */
export function deriveTag(tool: Record<string, unknown>): string | undefined {
  const tag = tool['tag']
  if (typeof tag === 'string' && tag.length > 0) {
    return tag
  }
  const version = tool['version']
  if (typeof version === 'string' && version.length > 0) {
    return version
  }
  return undefined
}

/**
 * Parse "github:<owner>/<repo>" repository strings. Returns the "<owner>/<repo>"
 * portion or undefined when the value is not a github: reference.
 */
export function parseGithubRepo(repository: unknown): string | undefined {
  if (typeof repository !== 'string') {
    return undefined
  }
  if (!repository.startsWith('github:')) {
    return undefined
  }
  const ownerRepo = repository.slice('github:'.length)
  if (!ownerRepo.includes('/')) {
    return undefined
  }
  return ownerRepo
}

/**
 * Check whether gh is available and authenticated. Returns undefined when
 * everything is fine, or a skip-reason string when the gate should be skipped.
 */
export function checkGhAvailable(): string | undefined {
  const which = spawnSync('which', ['gh'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (which.status !== 0) {
    return 'gh not found on PATH — install the GitHub CLI to enable release-tag probing'
  }
  const auth = spawnSync('gh', ['auth', 'status'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (auth.status !== 0) {
    return 'gh is not authenticated (gh auth status failed) — run `gh auth login` to enable release-tag probing'
  }
  return undefined
}

/**
 * Probe a single GitHub release tag. Returns the resolved tag name on success,
 * or undefined when the release is not found. Throws on a non-network gh
 * error so the caller can decide to skip.
 */
export function probeReleaseTag(
  ownerRepo: string,
  tag: string,
): string | undefined {
  const r = spawnSync(
    'gh',
    ['release', 'view', tag, '--repo', ownerRepo, '--json', 'tagName'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (r.status === 0) {
    try {
      const parsed = JSON.parse(String(r.stdout)) as unknown
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'tagName' in parsed &&
        typeof (parsed as Record<string, unknown>)['tagName'] === 'string'
      ) {
        return (parsed as Record<string, string>)['tagName']
      }
    } catch {}
    return tag
  }
  const stderr = String(r.stderr ?? '')
  if (
    stderr.includes('release not found') ||
    stderr.includes('Could not find release') ||
    stderr.includes('HTTP 404')
  ) {
    return undefined
  }
  if (
    stderr.includes('network') ||
    stderr.includes('dial tcp') ||
    stderr.includes('no such host') ||
    stderr.includes('connection refused') ||
    stderr.includes('timeout') ||
    r.status == null
  ) {
    throw new Error(`network error probing ${ownerRepo}@${tag}: ${stderr}`)
  }
  return undefined
}

/**
 * Scan all tool-data files under repoRoot and probe each qualifying entry.
 */
export function checkReleases(repoRoot: string): ReleaseCheckResult {
  const ghSkip = checkGhAvailable()
  if (ghSkip) {
    return { probes: [], skippedAll: true, skipReason: ghSkip }
  }

  const files = findToolFiles(repoRoot)
  const probes: TagProbe[] = []

  for (let i = 0, { length } = files; i < length; i += 1) {
    const relPath = files[i]!
    const abs = path.join(repoRoot, relPath)
    if (!existsSync(abs)) {
      continue
    }
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(abs, 'utf8'))
    } catch {
      continue
    }
    if (typeof raw !== 'object' || raw === null) {
      continue
    }
    const config = raw as Record<string, unknown>
    const tools = config['tools']
    if (typeof tools !== 'object' || tools === null) {
      continue
    }
    const toolsMap = tools as Record<string, unknown>
    for (const [toolName, toolValue] of Object.entries(toolsMap)) {
      if (typeof toolValue !== 'object' || toolValue === null) {
        continue
      }
      const tool = toolValue as Record<string, unknown>
      const release = tool['release']
      if (release !== 'archive' && release !== 'asset') {
        continue
      }
      const ownerRepo = parseGithubRepo(tool['repository'])
      if (!ownerRepo) {
        continue
      }
      const storedTag = deriveTag(tool)
      if (!storedTag) {
        continue
      }
      let resolvedTag: string | undefined
      let found = false
      let skipped = false
      let skipReason: string | undefined

      try {
        resolvedTag = probeReleaseTag(ownerRepo, storedTag)
        if (resolvedTag !== undefined) {
          found = true
        } else if (!storedTag.startsWith('v')) {
          const withV = `v${storedTag}`
          resolvedTag = probeReleaseTag(ownerRepo, withV)
          if (resolvedTag !== undefined) {
            found = true
          }
        }
      } catch (e) {
        skipped = true
        skipReason = `network error — ${errorMessage(e)}`
        found = false
      }

      probes.push({
        file: relPath,
        toolName,
        ownerRepo,
        tag: storedTag,
        resolvedTag,
        found,
        skipped,
        skipReason,
      })
    }
  }

  return { probes, skippedAll: false, skipReason: undefined }
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const dryRun = process.argv.includes('--dry-run')

  const result = checkReleases(REPO_ROOT)

  if (result.skippedAll) {
    if (!quiet) {
      logger.log(
        `[check-external-tools-release-tags-resolve] skipped: ${result.skipReason}`,
      )
    }
    return
  }

  if (result.probes.length === 0) {
    if (!quiet) {
      logger.success(
        '[check-external-tools-release-tags-resolve] no github-release tool entries found.',
      )
    }
    return
  }

  const failures: TagProbe[] = []
  const networkSkips: TagProbe[] = []

  for (let i = 0, { length } = result.probes; i < length; i += 1) {
    const p = result.probes[i]!
    if (p.skipped) {
      networkSkips.push(p)
      if (!quiet) {
        logger.log(
          `  ⚠ ${p.file}#${p.toolName} (${p.ownerRepo}@${p.tag}): ${p.skipReason}`,
        )
      }
    } else if (dryRun) {
      const status = p.found
        ? `FOUND as ${p.resolvedTag}`
        : `NOT FOUND (tried ${p.tag}${!p.tag.startsWith('v') ? ` and v${p.tag}` : ''})`
      logger.log(
        `  ${p.found ? '✓' : '✗'} ${p.file}#${p.toolName} (${p.ownerRepo}@${p.tag}): ${status}`,
      )
    } else if (!p.found) {
      failures.push(p)
    }
  }

  if (networkSkips.length > 0 && !quiet) {
    logger.log(
      `[check-external-tools-release-tags-resolve] ${networkSkips.length} probe(s) skipped due to network errors.`,
    )
  }

  if (dryRun) {
    if (!quiet) {
      logger.log(
        `[check-external-tools-release-tags-resolve] dry-run complete: ${result.probes.length} probe(s).`,
      )
    }
    return
  }

  if (failures.length > 0) {
    logger.fail(
      '[check-external-tools-release-tags-resolve] tool entries reference tags with no GitHub release:',
    )
    for (let i = 0, { length } = failures; i < length; i += 1) {
      const f = failures[i]!
      const tried = !f.tag.startsWith('v')
        ? `${f.tag} and v${f.tag}`
        : f.tag
      logger.error(
        `  ✗ ${f.file}#${f.toolName}: ${f.ownerRepo} tag ${tried} — no release found`,
      )
    }
    logger.error(
      '  Each entry with release:"asset"|"archive" and repository:"github:<owner>/<repo>" must reference a real GitHub release tag. Update the version/tag field to a tag that exists, or add the tag field explicitly.',
    )
    process.exitCode = 1
    return
  }

  if (!quiet) {
    logger.success(
      `[check-external-tools-release-tags-resolve] all ${result.probes.length} release-tag probe(s) resolved.`,
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
