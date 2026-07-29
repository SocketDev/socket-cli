/**
 * @file Export-map walk shared by the two fleet doc generators,
 *   `scripts/fleet/make-api-md.mts` and `scripts/fleet/make-llms-txt.mts`.
 *   Turns a package.json `exports` map into one row per documented subpath,
 *   carrying the three things both renderers need: the source module under
 *   `src/` (what a human-facing table links), the shipped declaration file
 *   (what a publish-facing index links, since a tarball has no `src/`), and the
 *   first sentence of the module's `@file` block as its description.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { exportEntriesOf } from '../exports-conditions.mts'

/**
 * One documented subpath export.
 */
export interface ApiExportRow {
  /**
   * Subpath as a consumer writes it, without the leading `./` — `ai/http`.
   */
  readonly subpath: string
  /**
   * Repo-relative unix-slash path to the source module under `src/`.
   */
  readonly sourceFile: string
  /**
   * Package-relative path to the shipped declaration file.
   */
  readonly typesPath: string
  /**
   * First sentence of the module's `@file` block; empty when it has none.
   */
  readonly summary: string
}

/**
 * The bucket every ungrouped (single-segment) subpath falls into.
 */
export const TOP_LEVEL_GROUP = 'Top-level'

// A runtime export target of the form `./<outDir>/<rest>.js` — the build output
// a published subpath points at. Capture 1 is the out dir (`dist`, `lib`, …) so
// the `src/` twin can be resolved without hard-coding one repo's layout;
// capture 2 is the extension-less path shared by the source and the output.
const RUNTIME_TARGET_RE = /^\.\/([^/]+)\/(.+)\.(?:cjs|js|mjs)$/

// The first JSDoc-style block comment in a file. Non-greedy so a file with
// several blocks yields only the leading one — the `@file` header.
const LEADING_BLOCK_COMMENT_RE = /\/\*\*([\s\S]*?)\*\//

// A JSDoc tag boundary in the flattened description text, used to stop the
// summary before a following `@param` / `@see` / … bleeds into it.
const TRAILING_TAG_RE = /\s@\w+/

/**
 * Longest summary kept before it is truncated with an ellipsis.
 */
const SUMMARY_MAX_LENGTH = 220

/**
 * First sentence of a module's `@file` (or `@fileoverview`) block. Returns an
 * empty string when the file is unreadable or carries no such block — a missing
 * description is a documentation gap, never a generator failure.
 */
export function extractModuleSummary(sourcePath: string): string {
  let content: string
  try {
    content = readFileSync(sourcePath, 'utf8')
  } catch {
    return ''
  }
  const match = LEADING_BLOCK_COMMENT_RE.exec(content)
  if (!match) {
    return ''
  }
  const block = match[1] ?? ''
  // Check the longer tag first so a `@fileoverview` block is not matched as
  // `@file` with a leftover "overview" prefix bleeding into the description.
  let tagIndex = block.indexOf('@fileoverview')
  let tagLength = '@fileoverview'.length
  if (tagIndex < 0) {
    tagIndex = block.indexOf('@file')
    tagLength = '@file'.length
  }
  if (tagIndex < 0) {
    return ''
  }
  const flattened = block
    .slice(tagIndex + tagLength)
    .split('\n')
    .map(line => line.replace(/^\s*\*\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const tagBoundary = flattened.search(TRAILING_TAG_RE)
  const trimmed = (
    tagBoundary > 0 ? flattened.slice(0, tagBoundary) : flattened
  ).trim()
  const sentenceEnd = trimmed.indexOf('. ')
  if (sentenceEnd > 0 && sentenceEnd < SUMMARY_MAX_LENGTH) {
    return trimmed.slice(0, sentenceEnd + 1)
  }
  return trimmed.length > SUMMARY_MAX_LENGTH
    ? `${trimmed.slice(0, SUMMARY_MAX_LENGTH - 3)}...`
    : trimmed
}

/**
 * One row per documented subpath, sorted by subpath. The root entry (`.`),
 * `./index`, and JSON data exports are skipped: they are the package handle and
 * its shipped data, not namespaces a reader navigates.
 */
export function buildApiExportRows(
  exportsValue: unknown,
  repoRoot: string,
): ApiExportRow[] {
  const rows: ApiExportRow[] = []
  for (const { 0: subpath, 1: value } of exportEntriesOf(exportsValue)) {
    if (subpath === '.' || subpath === './index' || subpath.endsWith('.json')) {
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue
    }
    const conditions = value as Record<string, unknown>
    const runtimeTarget = conditions['default']
    if (typeof runtimeTarget !== 'string') {
      continue
    }
    const targetMatch = RUNTIME_TARGET_RE.exec(runtimeTarget)
    if (!targetMatch) {
      continue
    }
    const sourceRel = path.join('src', `${targetMatch[2]!}.ts`)
    const declared = conditions['types']
    const typesPath =
      typeof declared === 'string'
        ? declared
        : runtimeTarget.replace(/\.js$/, '.d.mts').replace(/\.cjs$/, '.d.cts')
    rows.push({
      sourceFile: sourceRel.replaceAll(path.sep, '/'),
      subpath: subpath.slice(2),
      summary: extractModuleSummary(path.join(repoRoot, sourceRel)),
      typesPath,
    })
  }
  rows.sort((a, b) => a.subpath.localeCompare(b.subpath))
  return rows
}

/**
 * Bucket rows by their first subpath segment (`ai/http` → `ai/`); a
 * single-segment subpath lands in {@link TOP_LEVEL_GROUP}.
 */
export function groupApiExportRows(
  rows: readonly ApiExportRow[],
): Map<string, ApiExportRow[]> {
  const groups = new Map<string, ApiExportRow[]>()
  for (let i = 0, { length } = rows; i < length; i += 1) {
    const row = rows[i]!
    const key = row.subpath.includes('/')
      ? `${row.subpath.split('/')[0]}/`
      : TOP_LEVEL_GROUP
    const bucket = groups.get(key) ?? []
    bucket.push(row)
    groups.set(key, bucket)
  }
  return groups
}

/**
 * Group keys in render order: {@link TOP_LEVEL_GROUP} first, then alphabetical.
 */
export function sortApiGroupKeys(
  groups: ReadonlyMap<string, readonly ApiExportRow[]>,
): string[] {
  return [...groups.keys()].toSorted((a, b) => {
    if (a === TOP_LEVEL_GROUP) {
      return -1
    }
    if (b === TOP_LEVEL_GROUP) {
      return 1
    }
    return a.localeCompare(b)
  })
}
