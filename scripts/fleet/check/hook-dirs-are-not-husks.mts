// Fleet check — no husk hook directories.
//
// A "husk" is a hook directory that contains ONLY a `node_modules/` dir (or is
// empty): no `index.mts`, no `install.mts`, no `README.md`. These are rename
// leftovers — when a hook dir is renamed, git moves the tracked files but the
// untracked, gitignored `node_modules/` is left behind under the OLD name. The
// husk is unreferenced in settings.json and does nothing, but it clutters the
// hook tree and reads as a real hook in directory listings.
//
// Why a gate: a fleet-wide audit (2026-06-06) found 10 such husks accumulated
// across template + live from prior hook renames (prefer-function-declaration →
// prefer-fn-decl, no-underscore-identifier → no-underscore-ident, etc.). Edit
// tooling never sweeps them because they are untracked. This check fails
// `check --all` so the next rename sweeps its own leftover instead of letting it
// rot.
//
// A directory is a valid hook iff it holds at least one of: index.mts (the
// PreToolUse/PostToolUse/Stop entrypoint), install.mts (setup-* installer
// hooks), or README.md (documentation-only entries are still intentional). The
// `_shared/` directory is exempt — it is a helper library, not a hook.
//
// Usage: node scripts/fleet/check/hook-dirs-are-not-husks.mts [--quiet]

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// A hook dir is real if it carries any of these. `node_modules` is deliberately
// NOT here — a dir whose only content is node_modules is the husk we flag.
const HOOK_MARKER_FILES = ['index.mts', 'install.mts', 'README.md']

// Directories under .claude/hooks/<seg>/ that are not hooks themselves.
// `_shared` is the helper library; `_dispatch` is the rolldown hook-bundle
// infra (the CJS loader + dispatcher + built bundle), not a hook entrypoint.
const NON_HOOK_DIRS = new Set(['_dispatch', '_shared'])

export interface HuskHit {
  // Repo-relative path of the husk directory.
  dir: string
  // What the dir actually contained (for the failure message).
  contents: string[]
}

export function isHusk(absDir: string): boolean {
  for (let i = 0, { length } = HOOK_MARKER_FILES; i < length; i += 1) {
    if (existsSync(path.join(absDir, HOOK_MARKER_FILES[i]!))) {
      return false
    }
  }
  return true
}

export function scanHookDirs(repoRoot: string): HuskHit[] {
  const hits: HuskHit[] = []
  for (const seg of ['fleet', 'repo']) {
    const hooksDir = path.join(repoRoot, '.claude', 'hooks', seg)
    let entries: string[]
    try {
      entries = readdirSync(hooksDir)
    } catch {
      continue
    }
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const name = entries[i]!
      if (NON_HOOK_DIRS.has(name)) {
        continue
      }
      const absDir = path.join(hooksDir, name)
      let contents: string[]
      try {
        contents = readdirSync(absDir)
      } catch {
        continue
      }
      if (isHusk(absDir)) {
        hits.push({ dir: path.relative(repoRoot, absDir), contents })
      }
    }
  }
  return hits
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const hits = scanHookDirs(REPO_ROOT)
  if (hits.length) {
    logger.fail(
      '[check-hook-dirs-are-not-husks] husk hook directories (no index.mts / install.mts / README.md):',
    )
    for (let i = 0, { length } = hits; i < length; i += 1) {
      const h = hits[i]!
      logger.error(`  ✗ ${h.dir} — contains only [${h.contents.join(', ')}]`)
    }
    logger.error(
      '  These are rename leftovers (the old name kept its untracked node_modules). Remove the directory; if it should be a hook, add an index.mts / install.mts / README.md.',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success('[check-hook-dirs-are-not-husks] no husk hook directories.')
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
