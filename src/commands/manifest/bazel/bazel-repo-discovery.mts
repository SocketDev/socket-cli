import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { getErrorCause } from '../../../utils/errors.mts'

// Maximum size (bytes) we will read for any single Bazel workspace file.
// Prevents DoS via maliciously large MODULE.bazel / WORKSPACE / .bzl files.
const MAX_WORKSPACE_FILE_BYTES = 5 * 1024 * 1024

// Maximum candidate count we will return (deduped) before truncating.
// Real repos have <20; this is a hard ceiling against pathological inputs.
const MAX_CANDIDATES = 256

// Regex strategy: anchored, bounded character classes, no nested quantifiers.
// Match `use_repo(maven, "X", "Y", ...)` with a bounded arg-list window to
// avoid catastrophic backtracking on hostile input.

// Bzlmod use_repo(maven, "name1", "name2"...).
// Bounded: matches up to ~4KB of arg list to avoid catastrophic backtracking.
const USE_REPO_RE = /use_repo\s*\(\s*maven\s*,([^)]{0,4096})\)/g
const BAZEL_REPO_NAME_PATTERN = '[A-Za-z0-9._+-]{1,129}'
const BAZEL_REPO_NAME_RE = new RegExp(`^${BAZEL_REPO_NAME_PATTERN}$`)
// Quoted-name extractor inside the captured argument blob.
const QUOTED_NAME_RE = new RegExp(`"(${BAZEL_REPO_NAME_PATTERN})"`, 'g')

// Legacy maven_install(name = "X", ...) on a single statement.
// Match the name= keyword arg specifically; bounded.
const MAVEN_INSTALL_NAME_RE = new RegExp(
  `maven_install\\s*\\([^)]{0,8192}?\\bname\\s*=\\s*"(${BAZEL_REPO_NAME_PATTERN})"`,
  'g',
)
const MAVEN_COORDINATES_MARKER_RE = /\bmaven_coordinates\s*=/

// Reads file contents, refusing files that exceed MAX_WORKSPACE_FILE_BYTES.
// Returns null when the file is missing, oversized, or unreadable.
function safeReadFile(file: string): string | null {
  if (!existsSync(file)) {
    return null
  }
  try {
    const stat = statSync(file)
    if (stat.size > MAX_WORKSPACE_FILE_BYTES) {
      return null
    }
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

// Walks workspace root for legacy Starlark sources we can scan: WORKSPACE
// (and WORKSPACE.bazel) plus top-level .bzl files. Non-recursive by design;
// Phase 1 explicitly avoids static Starlark parsing at depth.
function listLegacyStarlarkFiles(cwd: string): string[] {
  const files: string[] = []
  const candidates = ['WORKSPACE', 'WORKSPACE.bazel']
  for (const c of candidates) {
    const p = path.join(cwd, c)
    if (existsSync(p)) {
      files.push(p)
    }
  }
  // Top-level .bzl files only.
  try {
    for (const entry of readdirSync(cwd)) {
      if (entry.endsWith('.bzl')) {
        files.push(path.join(cwd, entry))
      }
    }
  } catch {
    // Ignore unreadable cwd.
  }
  return files
}

// Returns deduplicated, sorted list of items, capped at MAX_CANDIDATES.
function uniqueSorted(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item)
      out.push(item)
      if (out.length >= MAX_CANDIDATES) {
        break
      }
    }
  }
  return out.sort()
}

function apparentNameFromJsonValue(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const obj = value as Record<string, unknown>
  const direct = obj['apparentName'] ?? obj['apparent_name']
  if (typeof direct === 'string') {
    return direct
  }
  for (const nested of Object.values(obj)) {
    const found = apparentNameFromJsonValue(nested)
    if (found) {
      return found
    }
  }
  return undefined
}

function apparentNamesFromRepoMapping(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return []
  }
  const candidates: string[] = []
  for (const [name, canonicalName] of Object.entries(value)) {
    if (name.startsWith('@') || typeof canonicalName !== 'string') {
      continue
    }
    const repo = normalizeRepoName(name)
    if (repo) {
      candidates.push(repo)
    }
  }
  return candidates
}

function normalizeRepoName(name: string): string | undefined {
  const repo = name.startsWith('@') ? name.slice(1) : name
  return BAZEL_REPO_NAME_RE.test(repo) ? repo : undefined
}

// Parse `bazel mod dump_repo_mapping "" --output=json` output. Also accept the
// older streamed jsonproto shape in case older Bazel versions or fixtures still
// return repository records with apparentName fields.
export function parseVisibleRepoCandidates(output: string): string[] {
  const candidates: string[] = []
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown
      candidates.push(...apparentNamesFromRepoMapping(parsed))
      const apparentName = apparentNameFromJsonValue(parsed)
      if (apparentName) {
        const repo = normalizeRepoName(apparentName)
        if (repo) {
          candidates.push(repo)
        }
      }
    } catch {
      // Ignore malformed lines; caller will fall back to static discovery when
      // no usable visible repo names are found.
    }
  }
  return uniqueSorted(candidates)
}

// Step 1: parse candidate Maven repo names from Bzlmod and legacy entry points.
export function parseMavenRepoCandidates(
  cwd: string,
  verbose?: boolean,
): string[] {
  const candidates: string[] = []

  // Bzlmod path: parse MODULE.bazel for use_repo(maven, ...).
  const moduleBazel = path.join(cwd, 'MODULE.bazel')
  const moduleContent = safeReadFile(moduleBazel)
  if (moduleContent) {
    const bzlmodHits: string[] = []
    for (const m of moduleContent.matchAll(USE_REPO_RE)) {
      const argBlob = m[1] ?? ''
      for (const n of argBlob.matchAll(QUOTED_NAME_RE)) {
        bzlmodHits.push(n[1] as string)
      }
    }
    candidates.push(...bzlmodHits)
    if (verbose) {
      logger.log(
        '[VERBOSE] discovery: scanned',
        moduleBazel,
        `(${bzlmodHits.length} use_repo match(es))`,
      )
    }
  } else if (verbose) {
    logger.log(
      '[VERBOSE] discovery:',
      moduleBazel,
      'not present (skipping bzlmod scan)',
    )
  }

  // Legacy path: scan WORKSPACE + top-level .bzl files for maven_install(name=...).
  const legacyFiles = listLegacyStarlarkFiles(cwd)
  if (verbose) {
    logger.log(
      '[VERBOSE] discovery: legacy files considered:',
      legacyFiles.length ? legacyFiles : '(none)',
    )
  }
  for (const file of legacyFiles) {
    const content = safeReadFile(file)
    if (!content) {
      continue
    }
    const fileHits: string[] = []
    for (const m of content.matchAll(MAVEN_INSTALL_NAME_RE)) {
      fileHits.push(m[1] as string)
    }
    candidates.push(...fileHits)
    if (verbose) {
      logger.log(
        '[VERBOSE] discovery: scanned',
        file,
        `(${fileHits.length} maven_install name match(es))`,
      )
    }
  }

  const deduped = uniqueSorted(candidates)
  if (verbose) {
    logger.log('[VERBOSE] discovery: candidate set (pre-seed):', deduped)
  }
  return deduped
}

export type RepoProbe = (
  repoName: string,
) => Promise<{ stdout: string; code: number }>

export type ValidationResult = {
  valid: boolean
  // Probe stdout — populated whenever the probe was reachable, even when
  // validation rejects the repo. Empty string when the probe itself threw.
  stdout: string
}

// Step 2: validate a candidate by running the probe and confirming
// `maven_coordinates=` appears in stdout (the marker emitted by jvm_import /
// aar_import rules generated by rules_jvm_external). Returns the probe
// stdout alongside the verdict so the caller can cache it and reuse it
// instead of running an identical extraction query.
export async function validateMavenRepo(
  repoName: string,
  probe: RepoProbe,
  verbose?: boolean,
): Promise<ValidationResult> {
  try {
    const result = await probe(repoName)
    if (result.code !== 0) {
      if (verbose) {
        logger.log(
          `[VERBOSE] discovery: probe @${repoName}: REJECT (code=${result.code})`,
        )
      }
      return { valid: false, stdout: result.stdout }
    }
    const valid = MAVEN_COORDINATES_MARKER_RE.test(result.stdout)
    if (verbose) {
      logger.log(
        `[VERBOSE] discovery: probe @${repoName}:`,
        valid
          ? 'ACCEPT (maven_coordinates marker found)'
          : 'REJECT (no maven_coordinates marker in probe stdout)',
      )
    }
    return { valid, stdout: result.stdout }
  } catch (e) {
    if (verbose) {
      logger.log(
        `[VERBOSE] discovery: probe @${repoName}: REJECT (probe threw):`,
        getErrorCause(e),
      )
    }
    return { valid: false, stdout: '' }
  }
}

// The default maven_install repo name when no explicit `name=` is given.
// Included as a seed so repos that define maven_install in a subdirectory
// .bzl file (not scanned by parseMavenRepoCandidates) are still discovered.
const DEFAULT_MAVEN_REPO_SEED = 'maven'

// Composition: parse, then validate each candidate; return validated subset
// as a Map keyed by repo name with the validated probe stdout as value.
// Map iteration order matches insertion order, so callers that just want
// the list of repo names can call `Array.from(repos.keys())`. Callers that
// want to skip re-running the same `bazel query` during extraction can read
// the cached stdout off the Map and parse it directly.
//
// Always seeds with the default `@maven` repo name so repos whose
// maven_install is defined in a sub-directory .bzl file (not reachable by
// the top-level static scan) can still be discovered via probe validation.
export async function discoverMavenRepos(
  cwd: string,
  probe: RepoProbe,
  nativeCandidates?: string[],
  verbose?: boolean,
): Promise<Map<string, string>> {
  const parsed =
    nativeCandidates && nativeCandidates.length
      ? nativeCandidates
      : parseMavenRepoCandidates(cwd, verbose)
  if (verbose) {
    logger.log(
      '[VERBOSE] discovery: candidate source:',
      nativeCandidates && nativeCandidates.length
        ? `bzlmod visible-repos (${nativeCandidates.length})`
        : `static parse (${parsed.length})`,
    )
  }
  // Seed with the default repo name first (so it appears first in output if
  // validated). Dedup via Set before validation.
  const seen = new Set<string>([DEFAULT_MAVEN_REPO_SEED])
  const candidates: string[] = [DEFAULT_MAVEN_REPO_SEED]
  for (const c of parsed) {
    if (!seen.has(c)) {
      seen.add(c)
      candidates.push(c)
    }
  }
  if (verbose) {
    logger.log(
      '[VERBOSE] discovery: candidate set to probe (seed-first, deduped):',
      candidates,
    )
  }
  const validated = new Map<string, string>()
  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const result = await validateMavenRepo(c, probe, verbose)
    if (result.valid) {
      validated.set(c, result.stdout)
    }
  }
  if (verbose) {
    logger.log(
      '[VERBOSE] discovery: validated repos:',
      Array.from(validated.keys()),
    )
  }
  return validated
}
