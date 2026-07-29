/**
 * Pip hub candidate parsing for `socket manifest bazel --ecosystem pypi`:
 * bounded static scans of MODULE.bazel / WORKSPACE / top-level .bzl files,
 * plus parsers for `bazel mod show_extension` and `bazel mod
 * dump_repo_mapping` output.
 *
 * Security gate: every regex uses bounded character classes to prevent
 * catastrophic backtracking on hostile input.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

// PyPI-only repo-name predicate (Bazel apparent-name grammar).
const PYPI_REPO_NAME_PATTERN = '[A-Za-z0-9._+-]{1,129}'
// Anchored full-string form of the apparent-name grammar above.
const PYPI_REPO_NAME_RE = new RegExp(`^${PYPI_REPO_NAME_PATTERN}$`)

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
const HUB_NAME_ATTR_RE = /hub_name\s*=\s*(["'])([A-Za-z0-9_]{1,129})\1/
// The lockfile label attribute inside a pip.parse argument blob.
const REQUIREMENTS_LOCK_ATTR_RE =
  /requirements_lock\s*=\s*(["'])([^"']{1,512})\1/
// The python_version attribute inside a pip.parse argument blob.
const PYTHON_VERSION_ATTR_RE = /python_version\s*=\s*(["'])([0-9._+!]{1,32})\1/

// Legacy WORKSPACE patterns: pip_parse, pip_install, pip_repository.
// Bounded: matches up to ~8KB of argument list.
const PIP_PARSE_NAME_RE = /pip_parse\s*\(\s*([^)]{0,8192})\)/g
// Legacy pip_install call with its argument blob.
const PIP_INSTALL_NAME_RE = /pip_install\s*\(\s*([^)]{0,8192})\)/g
// Legacy pip_repository call with its argument blob.
const PIP_REPOSITORY_NAME_RE = /pip_repository\s*\(\s*([^)]{0,8192})\)/g
// The `name = "<hub>"` attribute inside a legacy rule's argument blob.
const NAME_ATTR_RE = /name\s*=\s*(["'])([A-Za-z0-9_]{1,129})\1/
// The requirements_lock attribute inside a legacy rule's argument blob.
const LEGACY_REQ_LOCK_RE = /requirements_lock\s*=\s*(["'])([^"']{1,512})\1/
// pip.parse call inside `bazel mod show_extension` output.
const MOD_SHOW_PIP_PARSE_RE = /pip\.parse\s*\(\s*([^)]{0,8192})\)/g
// use_repo export inside `bazel mod show_extension` output.
const MOD_SHOW_USE_REPO_RE =
  /use_repo\s*\(\s*\w+\s*,\s*(["'])([A-Za-z0-9_]{1,129})\1\s*\)/g

export type PypiHubInfo = {
  hubName: string
  source:
    | 'MODULE.bazel'
    | 'WORKSPACE'
    | 'WORKSPACE.bazel'
    | '.bzl'
    | 'visible-repos'
    | 'default-seed'
    | 'bazel-mod-show-extension'
  workspaceMode: 'bzlmod' | 'legacy' | 'unknown'
  pythonVersion?: string | undefined
  requirementsLockLabel?: string | undefined
  requirementsLockPath?: string | undefined
  probeStdout: string
  visibleRepoNames?: string[] | undefined
}

export type PypiHubCandidate = Omit<
  PypiHubInfo,
  'probeStdout' | 'visibleRepoNames'
>

// Build a dynamic regex for `${binding}.parse(...)` given a validated binding
// name (word characters only, so safe to embed). Bounded arg list.
export function buildPipParseRe(binding: string): RegExp {
  return new RegExp(`${binding}\\.parse\\s*\\(\\s*([^)]{0,8192})\\)`, 'g')
}

// Returns deduplicated list of items, capped at MAX_CANDIDATES.
// Precedence: the first occurrence of a given hubName wins. Callers
// must order inputs so the preferred source comes first (e.g., Bzlmod
// hits before legacy WORKSPACE hits during migration).
// Throws a clear error if the cap is exceeded so callers do not silently
// truncate. Emits a verbose warning when a later entry is dropped due to
// a name collision so users can see implicit precedence at work.
export function dedupCapped(
  items: PypiHubCandidate[],
  options?: { verbose?: boolean | undefined } | undefined,
): PypiHubCandidate[] {
  const { verbose } = { __proto__: null, ...options } as {
    verbose?: boolean | undefined
  }
  const seen = new Map<string, PypiHubCandidate>()
  const out: PypiHubCandidate[] = []
  for (let i = 0, { length } = items; i < length; i += 1) {
    const item = items[i]!
    const existing = seen.get(item.hubName)
    if (!existing) {
      seen.set(item.hubName, item)
      out.push(item)
      if (out.length >= MAX_CANDIDATES) {
        throw new Error(
          `Discovered more than ${MAX_CANDIDATES} pip hub candidates. ` +
            'This exceeds the safety ceiling; aborting discovery.',
        )
      }
    } else if (verbose) {
      logger.log(
        `[VERBOSE] discovery: dropping duplicate pip hub candidate '${item.hubName}' ` +
          `(kept first occurrence from ${existing.source}/${existing.workspaceMode}, ` +
          `dropped ${item.source}/${item.workspaceMode}).`,
      )
    }
  }
  return out
}

// Extract candidate hub fields from a pip.parse / pip_parse / pip_install /
// pip_repository argument blob (without probeStdout or visibleRepoNames).
export function extractHubInfoFromArgBlob(
  argBlob: string,
  source: PypiHubInfo['source'],
  workspaceMode: PypiHubInfo['workspaceMode'],
): PypiHubCandidate | undefined {
  const hubMatch = HUB_NAME_ATTR_RE.exec(argBlob)
  const nameMatch = NAME_ATTR_RE.exec(argBlob)
  const hubName = hubMatch?.[2] ?? nameMatch?.[2]
  if (!hubName) {
    return undefined
  }
  const lockMatch =
    REQUIREMENTS_LOCK_ATTR_RE.exec(argBlob) ?? LEGACY_REQ_LOCK_RE.exec(argBlob)
  const pythonVersion = PYTHON_VERSION_ATTR_RE.exec(argBlob)?.[2]
  return {
    hubName,
    source,
    workspaceMode,
    pythonVersion,
    requirementsLockLabel: lockMatch?.[2],
  }
}

// Walks workspace root for legacy Starlark sources we can scan: WORKSPACE
// (and WORKSPACE.bazel) plus top-level .bzl files. Non-recursive by design;
// the pipeline explicitly avoids static Starlark parsing at depth.
export function listLegacyStarlarkFiles(cwd: string): string[] {
  const files: string[] = []
  const candidates = ['WORKSPACE', 'WORKSPACE.bazel']
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const p = path.join(cwd, candidates[i]!)
    if (existsSync(p)) {
      files.push(p)
    }
  }
  // Top-level .bzl files only.
  try {
    const entries = readdirSync(cwd)
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      if (entry.endsWith('.bzl')) {
        files.push(path.join(cwd, entry))
      }
    }
  } catch {
    // Ignore unreadable cwd.
  }
  return files
}

export function parseBazelModPipExtensionCandidates(
  stdout: string,
  options?: { verbose?: boolean | undefined } | undefined,
): PypiHubCandidate[] {
  const { verbose } = { __proto__: null, ...options } as {
    verbose?: boolean | undefined
  }
  const useRepoNames = new Set<string>()
  for (const m of stdout.matchAll(MOD_SHOW_USE_REPO_RE)) {
    useRepoNames.add(m[2] as string)
  }

  const candidates: PypiHubCandidate[] = []
  for (const m of stdout.matchAll(MOD_SHOW_PIP_PARSE_RE)) {
    const info = extractHubInfoFromArgBlob(
      m[1] ?? '',
      'bazel-mod-show-extension',
      'bzlmod',
    )
    if (!info) {
      continue
    }
    if (useRepoNames.size && !useRepoNames.has(info.hubName)) {
      if (verbose) {
        logger.log(
          `[VERBOSE] discovery: dropping pip.parse hub '${info.hubName}' because show_extension did not report matching use_repo.`,
        )
      }
      continue
    }
    candidates.push(info)
  }

  if (verbose) {
    logger.log(
      '[VERBOSE] discovery: bazel mod show_extension pip.parse hits:',
      candidates.length,
      'use_repo:',
      Array.from(useRepoNames),
    )
  }
  return dedupCapped(candidates, { verbose })
}

// Parse candidate pip hub names from Bzlmod MODULE.bazel and legacy
// WORKSPACE / .bzl entry points.
//
// Precedence: Bzlmod (MODULE.bazel pip.parse) hits are pushed first, then
// legacy (pip_parse / pip_install / pip_repository) hits. dedupCapped keeps
// the first occurrence, so during migration scenarios where both
// MODULE.bazel and WORKSPACE define a hub with the same name, the Bzlmod
// entry wins implicitly. Pass verbose to surface dropped duplicates.
export function parsePypiHubCandidates(
  cwd: string,
  options?: { verbose?: boolean | undefined } | undefined,
): PypiHubCandidate[] {
  const { verbose } = { __proto__: null, ...options } as {
    verbose?: boolean | undefined
  }
  const candidates: PypiHubCandidate[] = []

  // Bzlmod path: parse MODULE.bazel for use_extension bindings to pip,
  // then match ${binding}.parse(...).
  const moduleBazel = path.join(cwd, 'MODULE.bazel')
  const moduleContent = safeReadWorkspaceFile(moduleBazel)
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

    for (let i = 0, { length } = bindings; i < length; i += 1) {
      const parseRe = buildPipParseRe(bindings[i]!)
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
  for (let i = 0, { length } = legacyFiles; i < length; i += 1) {
    const file = legacyFiles[i]!
    const content = safeReadWorkspaceFile(file)
    if (!content) {
      continue
    }
    const fileHits: PypiHubCandidate[] = []
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

  return dedupCapped(candidates, { verbose })
}

// Parse `bazel mod dump_repo_mapping "" --output=json` output. Also accepts
// the older streamed jsonproto shape (apparentName / apparent_name records).
// PyPI-only; the Maven path consumes `bazel mod show_extension` instead.
export function parseVisibleRepoCandidates(output: string): string[] {
  const seen = new Set<string>()
  const candidates: string[] = []
  // Line separator tolerant of Windows CRLF output.
  const lines = output.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const trimmed = lines[i]!.trim()
    if (!trimmed) {
      continue
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const mappingNames = pypiApparentNamesFromRepoMapping(parsed)
      for (let j = 0, nameCount = mappingNames.length; j < nameCount; j += 1) {
        const c = mappingNames[j]!
        if (!seen.has(c)) {
          seen.add(c)
          candidates.push(c)
        }
      }
      const apparentName = pypiApparentNameFromJsonValue(parsed)
      if (apparentName) {
        const repo = pypiNormalizeRepoName(apparentName)
        if (repo && !seen.has(repo)) {
          seen.add(repo)
          candidates.push(repo)
        }
      }
    } catch {
      // Skip malformed lines; caller falls back to static discovery when no
      // usable visible repo names are found.
    }
  }
  return candidates.toSorted()
}

export function pypiApparentNameFromJsonValue(
  value: unknown,
): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const obj = value as Record<string, unknown>
  const direct = obj['apparentName'] ?? obj['apparent_name']
  if (typeof direct === 'string') {
    return direct
  }
  const nestedValues = Object.values(obj)
  for (let i = 0, { length } = nestedValues; i < length; i += 1) {
    const found = pypiApparentNameFromJsonValue(nestedValues[i])
    if (found) {
      return found
    }
  }
  return undefined
}

export function pypiApparentNamesFromRepoMapping(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return []
  }
  const candidates: string[] = []
  const entries = Object.entries(value)
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const { 0: name, 1: canonicalName } = entries[i]!
    if (name.startsWith('@') || typeof canonicalName !== 'string') {
      continue
    }
    if (PYPI_REPO_NAME_RE.test(name)) {
      candidates.push(name)
    }
  }
  return candidates
}

export function pypiNormalizeRepoName(name: string): string | undefined {
  const repo = name.startsWith('@') ? name.slice(1) : name
  return PYPI_REPO_NAME_RE.test(repo) ? repo : undefined
}

// Reads file contents, refusing files that exceed MAX_WORKSPACE_FILE_BYTES.
// Returns undefined when the file is missing, oversized, or unreadable.
export function safeReadWorkspaceFile(file: string): string | undefined {
  if (!existsSync(file)) {
    return undefined
  }
  try {
    const stat = statSync(file)
    if (stat.size > MAX_WORKSPACE_FILE_BYTES) {
      return undefined
    }
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}
