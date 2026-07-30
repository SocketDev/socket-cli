// File classification + content reading for the git-hook scanners: which paths
// to skip, and how to read a file's text (binaries run through `strings`).
// Gate-free.

import { existsSync, readFileSync, statSync } from 'node:fs'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

// ── File classification ────────────────────────────────────────────

// Files we never scan: hooks themselves (both the .mts files and the
// shell shims under .git-hooks/), test fixtures, vendored lockfiles.
const SKIP_FILE_RE =
  /\.(?:spec|test)\.(?:cts|m?[jt]s|mts|tsx?)$|\.example$|\/test\/|\/tests\/|fixtures\/|\.git-hooks\/|node_modules\/|pnpm-lock\.yaml/

export const shouldSkipFile = (filePath: string): boolean =>
  SKIP_FILE_RE.test(filePath)

/**
 * Source-code extensions. THE canonical definition for the fleet's
 * source-only convention scanners — the commit-time hook and the
 * `private-paths-are-absent` check gate import this one constant so they
 * cannot disagree about what "source code" means.
 *
 * Markdown, docs, JSON, and YAML are deliberately out of scope: they reference
 * these patterns legitimately. That divergence was real — the check script
 * carried a private copy of this regex under a comment claiming it was
 * "lock-step with the hook", while the hook had no such constant and scanned
 * every non-skipped file. Generated JSON therefore passed the gate and failed
 * the hook, and the hook's suggested fix would have corrupted the data.
 */
export const SOURCE_FILE_RE =
  /\.(?:[ch]|[cm]?[jt]sx?|bash|cc|cpp|cxx|go|hh|hpp|java|kt|py|rb|rs|sh|swift|zsh)$/

export const isSourceCodeFile = (filePath: string): boolean =>
  SOURCE_FILE_RE.test(filePath)

/**
 * The composed predicate for a SOURCE-ONLY convention scan: skip the universal
 * exclusions, then skip anything that is not source code.
 */
export const shouldSkipSourceScan = (filePath: string): boolean =>
  shouldSkipFile(filePath) || !isSourceCodeFile(filePath)

// Structured DATA payloads. A generated rule table, detector corpus, or
// fixture blob legitimately CONTAINS the very strings a convention scanner
// hunts for — a detection regex spelling `/Users/`, a rule description warning
// about `npx` — and applying the scanner's suggested fix would corrupt the
// data rather than repair a violation.
const DATA_FILE_RE = /\.(?:jsonc?|ya?ml)$/
// The one exception: a package manifest is data, but an `npx` in its `scripts`
// really is the violation the rule exists to catch.
const PACKAGE_MANIFEST_RE = /(?:^|\/)package\.json$/

export const isStructuredDataFile = (filePath: string): boolean => {
  const p = normalizePath(filePath)
  return DATA_FILE_RE.test(p) && !PACKAGE_MANIFEST_RE.test(p)
}

// Returns file content as a string. Text files stay in-process; binaries run
// through `strings` to catch paths embedded in WASM or compiled artifacts.
// A NUL byte is the stable cross-platform binary signal for the artifacts this
// hook scans, and avoids spawning Git-for-Windows `grep` for every text file.
export const readFileForScan = (filePath: string): string => {
  if (!existsSync(filePath)) {
    return ''
  }
  try {
    if (statSync(filePath).isDirectory()) {
      return ''
    }
  } catch {
    return ''
  }
  let bytes: Buffer
  try {
    bytes = readFileSync(filePath)
  } catch {
    return ''
  }
  if (!bytes.includes(0)) {
    return bytes.toString('utf8')
  }
  // NUL-bearing binary — extract printable strings.
  const stringsResult = spawnSync('strings', [filePath], {
    encoding: 'utf8',
  })
  return stringsResult.stdout || ''
}
