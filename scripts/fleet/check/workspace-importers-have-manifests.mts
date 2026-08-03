#!/usr/bin/env node
/**
 * @file Asserts every directory pnpm reads as a workspace importer carries a
 *   `package.json`, and sweeps the ones that don't.
 *   pnpm treats a directory holding `node_modules/` as an importer candidate.
 *   When such a dir has NO `package.json`, every `pnpm run <script>` in the
 *   repo dies with `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` — lint, format,
 *   test, the pre-commit gate, all of it, until a human finds the stray dir.
 *   That happened for real: a fleet script resolved its runtime cache
 *   relative to a `template/base/**` file instead of the repo root and wrote
 *   `template/base/node_modules/.cache/fleet/`. 280 KB of regenerable cache
 *   in a package-shaped path took the whole toolchain down, and the failure
 *   names only `template/base`, which points nowhere near the writer.
 *   A stray is a `node_modules/` dir whose parent has no manifest and which
 *   is therefore not a real workspace package. It holds only regenerable
 *   artifacts by definition (nothing declares it, so nothing installs into
 *   it), which is why `--fix` can delete it outright.
 *   Usage: `node scripts/fleet/check/workspace-importers-have-manifests.mts`
 *   reports; `--fix` sweeps them.
 */

import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isMainModule } from '../_shared/is-main-module.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Directory names never descended while hunting strays: installed trees,
// build output, and VCS metadata.
const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  '.jj',
  'node_modules',
  'target',
])

/**
 * A `node_modules/` dir is STRAY when its parent directory carries no
 * `package.json` — pnpm then sees an importer it cannot resolve. Exported
 * for tests.
 */
export function isStrayImporter(nodeModulesDir: string): boolean {
  return !existsSync(path.join(path.dirname(nodeModulesDir), 'package.json'))
}

/**
 * The static prefix of a workspace glob — everything before its first `*`.
 * `template/base/.claude/hooks/fleet/*` → `template/base/.claude/hooks/fleet`.
 * Exported for tests.
 */
export function globPrefix(glob: string): string {
  const star = glob.indexOf('*')
  const head = star === -1 ? glob : glob.slice(0, star)
  return normalizePath(head).replace(/\/+$/, '')
}

/**
 * Read the `packages:` globs from a repo's pnpm-workspace.yaml. Best-effort:
 * an unreadable/absent file yields no globs, so the caller flags nothing.
 */
export function workspaceGlobs(root: string): string[] {
  let raw
  try {
    raw = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')
  } catch {
    return []
  }
  const globs: string[] = []
  let inPackages = false
  const lines = raw.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (/^packages:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    if (inPackages) {
      const item = /^\s+-\s*['"]?([^'"#]+?)['"]?\s*$/.exec(line)
      if (item) {
        globs.push(item[1]!)
        continue
      }
      if (line.trim() !== '' && !line.startsWith(' ')) {
        break
      }
    }
  }
  return globs
}

/**
 * True when `parentRel` (repo-relative POSIX, the dir holding the stray
 * node_modules) is an ANCESTOR of some workspace-glob path. Only then does
 * pnpm walk into it as an importer candidate and blow up on the missing
 * manifest — a stray anywhere else (docker staging output, a vendored tree)
 * is inert, and flagging it would make the guard cry wolf. Exported for
 * tests.
 */
export function poisonsWorkspace(
  parentRel: string,
  globs: readonly string[],
): boolean {
  const parent = normalizePath(parentRel).replace(/\/+$/, '')
  if (parent === '' || parent === '.') {
    return false
  }
  return globs.some(g => globPrefix(g).startsWith(`${parent}/`))
}

/**
 * Walk `root` for stray `node_modules/` dirs, returning repo-relative POSIX
 * paths (sorted). The repo's own top-level `node_modules/` is never stray —
 * its parent is the root manifest.
 */
export async function findStrayImporters(root: string): Promise<string[]> {
  const globs = workspaceGlobs(root)
  const found: string[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      // An unreadable dir cannot be judged; skip rather than fail the gate.
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      const abs = path.join(dir, entry.name)
      if (entry.name === 'node_modules') {
        const rel = normalizePath(path.relative(root, abs))
        if (
          isStrayImporter(abs) &&
          poisonsWorkspace(path.posix.dirname(rel), globs)
        ) {
          found.push(rel)
        }
        // Never descend an installed tree — its nested node_modules dirs are
        // pnpm's business, not strays.
        continue
      }
      if (SKIP_DIRS.has(entry.name)) {
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      await walk(abs)
    }
  }
  await walk(root)
  return found.toSorted()
}

export async function main(): Promise<void> {
  const fix = process.argv.includes('--fix')
  const strays = await findStrayImporters(REPO_ROOT)
  if (strays.length === 0) {
    return
  }
  if (fix) {
    for (const rel of strays) {
      // eslint-disable-next-line no-await-in-loop
      await safeDelete(path.join(REPO_ROOT, rel))
      logger.success(`Swept stray importer: ${rel}`)
    }
    return
  }
  logger.fail(
    `${strays.length} stray node_modules dir(s) poison pnpm workspace ` +
      `resolution.`,
  )
  for (const rel of strays) {
    logger.substep(rel)
  }
  logger.log(
    'Their parent has no package.json, so pnpm reads each as an importer it ' +
      'cannot resolve and EVERY `pnpm run <script>` fails with ' +
      'ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND. Fix: re-run with --fix to sweep ' +
      "them, then anchor the writing script's cache at the REPO ROOT — never " +
      'relative to a payload file.',
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main().catch(() => {
    process.exitCode = 1
  })
}
