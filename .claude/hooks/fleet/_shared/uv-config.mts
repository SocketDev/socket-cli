/**
 * @file Single source of truth for the fleet's uv (Astral Python tool) policy —
 *   shared by the uv-lockfiles-are-current check and any future uv guard so
 *   they never diverge. uv is the fleet's Python PROJECT tool (replaces
 *   unpinned `pip3 install`); pipx stays the dev shortcut for one-off CLI
 *   tools. Reproducibility mirrors the pnpm model: a pyproject.toml that opts
 *   into uv (`[tool.uv]`) must ship a hash-verified `uv.lock` (so `uv sync
 *   --locked` in CI is the `--frozen-lockfile` analog), and must pin `[tool.uv]
 *   exclude-newer` to the fleet soak window (the `minimumReleaseAge` analog —
 *   uv refuses any package published after that point, blocking
 *   freshly-published malware).
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// The fleet-pinned uv version (mirror external-tools.json `uv.version`).
export const UV_PINNED_VERSION = '0.11.21'

// The canonical soak window for `[tool.uv] exclude-newer`. uv accepts a
// "friendly" duration; this matches the 7-day `minimumReleaseAge` soak the
// fleet enforces for pnpm.
export const UV_EXCLUDE_NEWER_SOAK = '7 days'

// CI install command that fails when the lockfile is stale (the analog of
// pnpm's `--frozen-lockfile`). Surfaced in check / guard messages.
export const UV_LOCKED_SYNC_CMD = 'uv sync --locked'

export interface UvProjectStatus {
  // The pyproject.toml that opts into uv.
  pyprojectPath: string
  // Whether a sibling uv.lock exists.
  hasLock: boolean
  // Whether `[tool.uv]` declares an `exclude-newer` soak pin.
  hasExcludeNewer: boolean
  // True when the project is fully compliant (lock + soak pin present).
  ok: boolean
  // Human-readable issues for the check / guard message.
  issues: readonly string[]
}

// True when a pyproject.toml opts into uv — it has a `[tool.uv]` table. A plain
// pyproject (e.g. a non-uv build backend) is NOT a uv project and isn't gated.
export function isUvProject(pyprojectText: string): boolean {
  // Match the table header at line start (TOML), tolerant of trailing spaces.
  return /^\[tool\.uv\]/mu.test(pyprojectText)
}

// True when `[tool.uv]` (or `[tool.uv.*]`) sets `exclude-newer`. Conservative
// substring-after-table check: we only need to know the soak pin is present,
// not parse its value.
export function hasExcludeNewer(pyprojectText: string): boolean {
  return /^\s*exclude-newer\s*=/mu.test(pyprojectText)
}

// Inspect one pyproject.toml: is it a uv project, and if so does it ship a
// uv.lock + an exclude-newer soak pin? A non-uv pyproject returns ok:true with
// no issues (not applicable). Never throws — unreadable file → reported issue.
export function inspectUvProject(pyprojectPath: string): UvProjectStatus {
  let text: string
  try {
    text = readFileSync(pyprojectPath, 'utf8')
  } catch {
    return {
      pyprojectPath,
      hasLock: false,
      hasExcludeNewer: false,
      ok: false,
      issues: [`could not read ${pyprojectPath}`],
    }
  }
  if (!isUvProject(text)) {
    return {
      pyprojectPath,
      hasLock: false,
      hasExcludeNewer: false,
      ok: true,
      issues: [],
    }
  }
  const lockPath = path.join(path.dirname(pyprojectPath), 'uv.lock')
  const hasLock = existsSync(lockPath)
  const excludeNewer = hasExcludeNewer(text)
  const issues: string[] = []
  if (!hasLock) {
    issues.push(
      `missing uv.lock next to ${pyprojectPath} — run \`uv lock\` and commit it (CI runs \`${UV_LOCKED_SYNC_CMD}\`)`,
    )
  }
  if (!excludeNewer) {
    issues.push(
      `[tool.uv] has no \`exclude-newer\` soak pin — add \`exclude-newer = "${UV_EXCLUDE_NEWER_SOAK}"\` (the minimumReleaseAge analog)`,
    )
  }
  return {
    pyprojectPath,
    hasLock,
    hasExcludeNewer: excludeNewer,
    ok: issues.length === 0,
    issues,
  }
}
