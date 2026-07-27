// File classification + content reading for the git-hook scanners: which paths
// to skip, and how to read a file's text (binaries run through `strings`).
// Gate-free.

import { existsSync, readFileSync, statSync } from 'node:fs'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

// ── File classification ────────────────────────────────────────────

// Files we never scan: hooks themselves (both the .mts files and the
// shell shims under .git-hooks/), test fixtures, vendored lockfiles.
const SKIP_FILE_RE =
  /\.(?:spec|test)\.(?:cts|m?[jt]s|mts|tsx?)$|\.example$|\/test\/|\/tests\/|fixtures\/|\.git-hooks\/|node_modules\/|pnpm-lock\.yaml/

export const shouldSkipFile = (filePath: string): boolean =>
  SKIP_FILE_RE.test(filePath)

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
