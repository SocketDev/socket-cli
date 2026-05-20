import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { getErrorCause } from '../../../utils/errors.mts'

import type {
  RepoProbe,
  ValidationResult,
} from './bazel-repo-discovery.mts'

// Maximum size (bytes) we will read for any single Bazel workspace file.
// Prevents DoS via maliciously large MODULE.bazel / WORKSPACE / .bzl files.
const MAX_WORKSPACE_FILE_BYTES = 5 * 1024 * 1024

// Maximum candidate count we will return (deduped) before failing.
// Real repos have <20; this is a hard ceiling against pathological inputs.
const MAX_CANDIDATES = 256

// Regex strategy: anchored, bounded character classes, no nested quantifiers.

// Bzlmod: discover `use_extension(..., "pip")` bindings, then match
// `${binding}.parse(...)` to find pip hub declarations.
// Bounded: matches up to ~256 chars of path to avoid catastrophic backtracking.
const USE_EXTENSION_PIP_RE =
  /(\w+)\s*=\s*use_extension\s*\(\s*["'][^"']{0,256}pip\.bzl["']\s*,\s*["']pip["']\s*\)/g

// Extract hub_name, requirements_lock, and python_version from a pip.parse
// argument blob. Bounded character classes and length caps.
const HUB_NAME_ATTR_RE = /hub_name\s*=\s*"([A-Za-z0-9_]{1,129})"/
const REQUIREMENTS_LOCK_ATTR_RE =
  /requirements_lock\s*=\s*"([^"]{1,512})"/
const PYTHON_VERSION_ATTR_RE =
  /python_version\s*=\s*"([0-9._+!]{1,32})"/

// Legacy WORKSPACE patterns: pip_parse, pip_install, pip_repository.
// Bounded: matches up to ~8KB of argument list.
const PIP_PARSE_NAME_RE =
  /pip_parse\s*\(\s*([^)]{0,8192})\)/g
const PIP_INSTALL_NAME_RE =
  /pip_install\s*\(\s*([^)]{0,8192})\)/g
const PIP_REPOSITORY_NAME_RE =
  /pip_repository\s*\(\s*([^)]{0,8192})\)/g
const NAME_ATTR_RE = /name\s*=\s*"([A-Za-z0-9_]{1,129})"/
const LEGACY_REQ_LOCK_RE =
  /requirements_lock\s*=\s*"([^"]{1,512})"/

// Hub validation: accept alias rules or `:pkg` targets in probe stdout.
// Does NOT require `pypi_name=` (that marker lives on spoke repos).
const PYPI_HUB_MARKER_RE = /:pkg\b|alias\s*\(/

export type PypiHubInfo = {
  hubName: string
  source:
    | 'MODULE.bazel'
    | 'WORKSPACE'
    | 'WORKSPACE.bazel'
    | '.bzl'
    | 'visible-repos'
    | 'default-seed'
  workspaceMode: 'bzlmod' | 'legacy' | 'unknown'
  pythonVersion?: string | undefined
  requirementsLockLabel?: string | undefined
  requirementsLockPath?: string | undefined
  probeStdout: string
  visibleRepoNames?: string[] | undefined
}

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

// Returns deduplicated list of items, capped at MAX_CANDIDATES.
// Throws a clear error if the cap is exceeded so callers do not silently
// truncate.
function dedupCapped(
  items: Array<Omit<PypiHubInfo, 'probeStdout' | 'visibleRepoNames'>>,
): Array<Omit<PypiHubInfo, 'probeStdout' | 'visibleRepoNames'>> {
  const seen = new Set<string>()
  const out: Array<Omit<PypiHubInfo, 'probeStdout' | 'visibleRepoNames'>> = []
  for (const item of items) {
    if (!seen.has(item.hubName)) {
      seen.add(item.hubName)
      out.push(item)
      if (out.length >= MAX_CANDIDATES) {
        throw new Error(
          `Discovered more than ${MAX_CANDIDATES} pip hub candidates. ` +
            'This exceeds the safety ceiling; aborting discovery.',
        )
      }
    }
  }
  return out
}

// Build a dynamic regex for `${binding}.parse(...)` given a validated binding
// name (word characters only, so safe to embed). Bounded arg list.
function buildPipParseRe(binding: string): RegExp {
  return new RegExp(
    `${binding}\\.parse\\s*\\(\\s*([^)]{0,8192})\\)`,
    'g',
  )
}

// Extract candidate hub fields from a pip.parse / pip_parse / pip_install /
// pip_repository argument blob (without probeStdout or visibleRepoNames).
function extractHubInfoFromArgBlob(
  argBlob: string,
  source: PypiHubInfo['source'],
  workspaceMode: PypiHubInfo['workspaceMode'],
): Omit<PypiHubInfo, 'probeStdout' | 'visibleRepoNames'> | undefined {
  const hubMatch = HUB_NAME_ATTR_RE.exec(argBlob)
  const nameMatch = NAME_ATTR_RE.exec(argBlob)
  const hubName = hubMatch?.[1] ?? nameMatch?.[1]
  if (!hubName) {
    return undefined
  }
  const lockMatch = REQUIREMENTS_LOCK_ATTR_RE.exec(argBlob)
    ?? LEGACY_REQ_LOCK_RE.exec(argBlob)
  const pythonVersion = PYTHON_VERSION_ATTR_RE.exec(argBlob)?.[1]
  return {
    hubName,
    source,
    workspaceMode,
    pythonVersion,
    requirementsLockLabel: lockMatch?.[1],
  }
}

// Step 1: parse candidate pip hub names from Bzlmod MODULE.bazel and legacy
// WORKSPACE / .bzl entry points.
export function parsePypiHubCandidates(
  cwd: string,
  verbose?: boolean,
): Array<Omit<PypiHubInfo, 'probeStdout' | 'visibleRepoNames'>> {
  const candidates: Array<Omit<PypiHubInfo, 'probeStdout' | 'visibleRepoNames'>> =
    []

  // Bzlmod path: parse MODULE.bazel for use_extension bindings to pip,
  // then match ${binding}.parse(...).
  const moduleBazel = path.join(cwd, 'MODULE.bazel')
  const moduleContent = safeReadFile(moduleBazel)
  if (moduleContent) {
    const bindings: string[] = []
    for (const m of moduleContent.matchAll(USE_EXTENSION_PIP_RE)) {
      bindings.push(m[1] as string)
    }
    if (verbose) {
      logger.log(
        '[VERBOSE] discovery: scanned',
        moduleBazel,
        `(${bindings.length} use_extension pip binding(s))`,
      )
    }

    for (const binding of bindings) {
      const parseRe = buildPipParseRe(binding)
      for (const m of moduleContent.matchAll(parseRe)) {
        const argBlob = m[1] ?? ''
        const info = extractHubInfoFromArgBlob(
          argBlob,
          'MODULE.bazel',
          'bzlmod',
        )
        if (info) {
          candidates.push(info)
        }
      }
    }

    if (verbose) {
      logger.log(
        '[VERBOSE] discovery: MODULE.bazel pip.parse hits:',
        candidates.length,
      )
    }
  } else if (verbose) {
    logger.log(
      '[VERBOSE] discovery:',
      moduleBazel,
      'not present (skipping bzlmod scan)',
    )
  }

  // Legacy path: scan WORKSPACE + top-level .bzl files for pip_parse,
  // pip_install, and pip_repository.
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
    const fileHits: Array<Omit<PypiHubInfo, 'probeStdout' | 'visibleRepoNames'>> =
      []
    const source: PypiHubInfo['source'] = file.endsWith('.bzl')
      ? '.bzl'
      : path.basename(file) === 'WORKSPACE.bazel'
        ? 'WORKSPACE.bazel'
        : 'WORKSPACE'

    for (const m of content.matchAll(PIP_PARSE_NAME_RE)) {
      const info = extractHubInfoFromArgBlob(m[1] ?? '', source, 'legacy')
      if (info) {
        fileHits.push(info)
      }
    }
    for (const m of content.matchAll(PIP_INSTALL_NAME_RE)) {
      const info = extractHubInfoFromArgBlob(m[1] ?? '', source, 'legacy')
      if (info) {
        fileHits.push(info)
      }
    }
    for (const m of content.matchAll(PIP_REPOSITORY_NAME_RE)) {
      const info = extractHubInfoFromArgBlob(m[1] ?? '', source, 'legacy')
      if (info) {
        fileHits.push(info)
      }
    }

    candidates.push(...fileHits)
    if (verbose) {
      logger.log(
        '[VERBOSE] discovery: scanned',
        file,
        `(${fileHits.length} legacy pip hub match(es))`,
      )
    }
  }

  return dedupCapped(candidates)
}

// Step 2: validate a candidate by running the probe and confirming
// `:pkg` labels or alias rules appear in stdout. Does NOT require
// `pypi_name=` (that marker lives on spoke repos).
export async function validatePypiHub(
  hubName: string,
  probe: RepoProbe,
  verbose?: boolean,
): Promise<ValidationResult> {
  try {
    const result = await probe(hubName)
    if (result.code !== 0) {
      if (verbose) {
        logger.log(
          `[VERBOSE] discovery: probe @${hubName}: REJECT (code=${result.code})`,
        )
      }
      return { valid: false, stdout: result.stdout }
    }
    const valid = PYPI_HUB_MARKER_RE.test(result.stdout)
    if (verbose) {
      logger.log(
        `[VERBOSE] discovery: probe @${hubName}:`,
        valid
          ? 'ACCEPT (hub alias/pkg marker found)'
          : 'REJECT (no hub alias/pkg marker in probe stdout)',
      )
    }
    return { valid, stdout: result.stdout }
  } catch (e) {
    if (verbose) {
      logger.log(
        `[VERBOSE] discovery: probe @${hubName}: REJECT (probe threw):`,
        getErrorCause(e),
      )
    }
    return { valid: false, stdout: '' }
  }
}

// The default pip hub name when no explicit hub_name/name is given.
// Included as a seed so repos whose pip.parse is in a sub-module (not
// found by static scanning) can still be discovered via probe validation.
const DEFAULT_PYPI_HUB_SEED = 'pypi'

// Composition: parse, then validate each candidate; return validated subset
// as a Map keyed by hub name with the validated PypiHubInfo.
// Always seeds with the default 'pypi' hub name first.
export async function discoverPypiHubs(
  cwd: string,
  probe: RepoProbe,
  nativeCandidates?: string[],
  verbose?: boolean,
): Promise<Map<string, PypiHubInfo>> {
  const parsed =
    nativeCandidates && nativeCandidates.length
      ? nativeCandidates.map(
          (hubName): Omit<PypiHubInfo, 'probeStdout' | 'visibleRepoNames'> => ({
            hubName,
            source: 'visible-repos',
            workspaceMode: 'unknown',
          }),
        )
      : parsePypiHubCandidates(cwd, verbose)
  if (verbose) {
    logger.log(
      '[VERBOSE] discovery: candidate source:',
      nativeCandidates && nativeCandidates.length
        ? `bzlmod visible-repos (${nativeCandidates.length})`
        : `static parse (${parsed.length})`,
    )
  }
  // Seed with the default hub name first (so it appears first in output if
  // validated). Parsed candidates overwrite the seed when they share the same
  // hub name so metadata (requirements_lock, python_version) is preserved.
  const seen = new Set<string>()
  const candidates: Array<Omit<PypiHubInfo, 'probeStdout' | 'visibleRepoNames'>> =
    []
  for (const c of parsed) {
    if (!seen.has(c.hubName)) {
      seen.add(c.hubName)
      candidates.push(c)
    }
  }
  if (!seen.has(DEFAULT_PYPI_HUB_SEED)) {
    candidates.unshift({
      hubName: DEFAULT_PYPI_HUB_SEED,
      source: 'default-seed',
      workspaceMode: 'unknown',
    })
  }
  if (verbose) {
    logger.log(
      '[VERBOSE] discovery: candidate set to probe (seed-first, deduped):',
      candidates.map(c => c.hubName),
    )
  }
  const validated = new Map<string, PypiHubInfo>()
  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const result = await validatePypiHub(c.hubName, probe, verbose)
    if (result.valid) {
      validated.set(c.hubName, {
        ...c,
        probeStdout: result.stdout,
      })
    }
  }
  if (verbose) {
    logger.log(
      '[VERBOSE] discovery: validated pip hubs:',
      Array.from(validated.keys()),
    )
  }
  return validated
}
