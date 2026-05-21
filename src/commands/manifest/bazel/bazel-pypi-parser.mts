/**
 * Parse `requirements_lock.txt`, `bazel query` output, and spoke-repo
 * `--output=build` tags into a uniform shape for PyPI requirements.txt
 * generation.
 *
 * Security gate: every regex uses bounded character classes to prevent
 * catastrophic backtracking on hostile input.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// Maximum size (bytes) we will read for any requirements lockfile.
// Prevents DoS via maliciously large lockfiles.
const MAX_REQUIREMENTS_FILE_BYTES = 5 * 1024 * 1024

export type ExtractedPypiPackage = {
  name: string
  version: string
  bazelName: string
  source?: 'lockfile' | 'spoke-tag' | undefined
  originalLine?: string | undefined
}

export type ReachedPypiLabel = {
  hubName: string
  originalLabel: string
  bazelName: string
  normalizedName: string
  apparentLabel: string
  spokeLabel?: string | undefined
}

// Normalize a PyPI package name per PEP 503:
// lowercase, then collapse `.`, `_`, and `-` runs to a single `-`.
export function normalizePypiName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
}

// Convert a Bazel underscore_name to a PyPI hyphenated-name.
export function bazelNameToPypiName(bazelName: string): string {
  return bazelName.replace(/_/g, '-')
}

// Validate that a resolved path stays within the workspace root.
function isWithinWorkspace(resolved: string, cwd: string): boolean {
  const rel = path.relative(cwd, resolved)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

// Resolves a Bazel label or workspace-relative path to a filesystem path.
// Returns undefined for labels that cannot be resolved locally.
export function resolveRequirementsLockPath(
  label: string | undefined,
  cwd: string,
): string | undefined {
  if (!label) {
    return undefined
  }
  // Reject labels with path-traversal segments.
  if (label.includes('..')) {
    return undefined
  }
  // Reject external repository labels.
  if (label.startsWith('@')) {
    return undefined
  }
  // Bazel local label forms:
  //   //:requirements_lock.txt
  //   //subdir:requirements_lock.txt
  //   :requirements_lock.txt
  let filePart: string
  if (label.startsWith('//')) {
    const colon = label.indexOf(':')
    if (colon < 0) {
      return undefined
    }
    const pkgPath = label.slice(2, colon)
    const filePart = label.slice(colon + 1)
    if (!filePart) {
      return undefined
    }
    const resolved = path.join(cwd, pkgPath, filePart)
    if (!isWithinWorkspace(resolved, cwd)) {
      return undefined
    }
    return resolved
  }
  if (label.startsWith(':')) {
    filePart = label.slice(1)
    if (!filePart) {
      return undefined
    }
    const resolved = path.join(cwd, filePart)
    if (!isWithinWorkspace(resolved, cwd)) {
      return undefined
    }
    return resolved
  }
  // Reject absolute paths (only for non-label inputs).
  if (path.isAbsolute(label)) {
    return undefined
  }
  // Bare workspace-relative path (no leading // or :).
  const resolved = path.join(cwd, label)
  if (!isWithinWorkspace(resolved, cwd)) {
    return undefined
  }
  return resolved
}

// Parses a single `name==version` line.
// Group 1 = package name, Group 2 = version string (includes ==).
const REQUIREMENT_LINE_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9._+!]+)/

// Skippable line prefixes.
function shouldSkipLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) {
    return true
  }
  if (trimmed.startsWith('#')) {
    return true
  }
  // Hash continuations start with `--hash=`.
  if (trimmed.startsWith('--hash=')) {
    return true
  }
  // Index options, constraint options, editable installs, includes, direct URLs.
  if (
    trimmed.startsWith('--') ||
    trimmed.startsWith('-e ') ||
    trimmed.startsWith('-r ') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://')
  ) {
    return true
  }
  return false
}

// Parse a `requirements_lock.txt`-style file into a map keyed by
// normalized PyPI name.
export function parseRequirementsLock(
  text: string,
): Map<string, ExtractedPypiPackage> {
  const out = new Map<string, ExtractedPypiPackage>()
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    if (rawLine === undefined) {
      continue
    }
    if (shouldSkipLine(rawLine)) {
      continue
    }
    // Handle trailing backslash continuation by concatenating subsequent lines.
    let line = rawLine.trimEnd()
    while (line.endsWith('\\') && i + 1 < lines.length) {
      i++
      const next = lines[i]
      if (next !== undefined) {
        line = line.slice(0, -1).trimEnd() + ' ' + next.trimStart()
      }
    }
    const m = REQUIREMENT_LINE_RE.exec(line)
    if (!m) {
      continue
    }
    const [, rawName, version] = m
    if (!rawName || !version) {
      continue
    }
    const bazelName = rawName.replace(/-/g, '_')
    const normalized = normalizePypiName(rawName)
    const existing = out.get(normalized)
    if (existing) {
      if (existing.version !== version) {
        throw new Error(
          `Conflicting versions for normalized PyPI package ${normalized}: ` +
            `${existing.originalLine ?? existing.name + '==' + existing.version} ` +
            `conflicts with ${line}.`,
        )
      }
      continue
    }
    out.set(normalized, {
      name: rawName,
      version,
      bazelName,
      source: 'lockfile',
      originalLine: line,
    })
  }
  return out
}

// Read and parse a requirements lockfile from a resolved path, capping file
// size. Returns undefined when the file is missing, oversized, or unreadable.
export function readRequirementsLockFile(
  resolvedPath: string | undefined,
): Map<string, ExtractedPypiPackage> | undefined {
  if (!resolvedPath) {
    return undefined
  }
  if (!existsSync(resolvedPath)) {
    return undefined
  }
  try {
    const stat = statSync(resolvedPath)
    if (stat.size > MAX_REQUIREMENTS_FILE_BYTES) {
      return undefined
    }
    const text = readFileSync(resolvedPath, 'utf8')
    return parseRequirementsLock(text)
  } catch {
    return undefined
  }
}

// Extract `pypi_name=` and `pypi_version=` tags from `--output=build` text of a
// spoke target. Returns null when either tag is missing.
const PYPI_NAME_TAG_RE = /pypi_name=\s*([A-Za-z0-9][A-Za-z0-9._-]+)/
const PYPI_VERSION_TAG_RE = /pypi_version=\s*([A-Za-z0-9._+!]+)/

export function parsePypiTagsFromBuildOutput(
  text: string,
): ExtractedPypiPackage | null {
  const nameM = PYPI_NAME_TAG_RE.exec(text)
  const versionM = PYPI_VERSION_TAG_RE.exec(text)
  if (!nameM || !versionM) {
    return null
  }
  const rawName = nameM[1]
  const version = versionM[1]
  if (!rawName || !version) {
    return null
  }
  return {
    name: rawName,
    version,
    bazelName: rawName.replace(/-/g, '_'),
    source: 'spoke-tag',
  }
}

// Extract hub package labels from `bazel query` output that match
// `@<hub>//<name>:pkg` patterns (both line-start and embedded in
// `--output=build` deps arrays).
export function filterReachedPypiPackages(
  queryOutput: string,
  hubName: string,
): ReachedPypiLabel[] {
  const out: ReachedPypiLabel[] = []
  const prefix = `@${hubName}//`
  // Match from the start of a label token (preceded by whitespace, quote, or
  // start of line) to improve robustness across output formats.
  const labelRe = new RegExp(
    `(?:^|[\\s"])${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\s:"]+):pkg`,
    'g',
  )
  let m: RegExpExecArray | null
  while ((m = labelRe.exec(queryOutput)) !== null) {
    const pkgPart = m[1]
    if (!pkgPart) {
      continue
    }
    const bazelName = pkgPart
    const normalized = normalizePypiName(bazelNameToPypiName(bazelName))
    const apparentLabel = `${prefix}${bazelName}:pkg`
    out.push({
      hubName,
      originalLabel: apparentLabel,
      bazelName,
      normalizedName: normalized,
      apparentLabel,
    })
  }
  return out
}

// Collect name==version pairs for the reached closure, resolving versions
// from the lockfile fast path or spoke-tag fallback. Enforces version
// conflict detection and deterministic output.
export function collectPypiPackages(
  reached: ReachedPypiLabel[],
  lockfile: Map<string, ExtractedPypiPackage> | undefined,
  spokeTagLookup: Map<string, ExtractedPypiPackage> | undefined,
): Array<{ name: string; version: string; source: string; label: string }> {
  const collected = new Map<
    string,
    { name: string; version: string; source: string; label: string }
  >()
  for (const r of reached) {
    const normalized = r.normalizedName
    // Lockfile fast path.
    const lockEntry = lockfile?.get(normalized)
    if (lockEntry) {
      const existing = collected.get(normalized)
      if (existing && existing.version !== lockEntry.version) {
        throw new Error(
          `Conflicting versions for ${normalized}: ${existing.label} has ${existing.version}, ${r.originalLabel} has ${lockEntry.version} (lockfile).`,
        )
      }
      if (!existing) {
        collected.set(normalized, {
          name: lockEntry.name,
          version: lockEntry.version,
          source: 'lockfile',
          label: r.originalLabel,
        })
      }
      continue
    }
    // Spoke-tag fallback.
    const spokeEntry = spokeTagLookup?.get(normalized)
    if (spokeEntry) {
      const existing = collected.get(normalized)
      if (existing && existing.version !== spokeEntry.version) {
        throw new Error(
          `Conflicting versions for ${normalized}: ${existing.label} has ${existing.version}, ${r.originalLabel} has ${spokeEntry.version} (spoke tag).`,
        )
      }
      if (!existing) {
        collected.set(normalized, {
          name: spokeEntry.name,
          version: spokeEntry.version,
          source: 'spoke-tag',
          label: r.originalLabel,
        })
      }
      continue
    }
    // Unresolvable package — fail rather than emit an unpinned entry.
    throw new Error(
      `No version found for ${r.originalLabel}. ` +
        'Check that the package is present in the requirements_lock.txt ' +
        'or reachable via a spoke target with pypi_name and pypi_version tags.',
    )
  }
  return Array.from(collected.values())
}
