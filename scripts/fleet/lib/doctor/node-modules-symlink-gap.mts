/**
 * @file GAP 13 engine — worktree node_modules is a FOREIGN symlink. Pure
 *   functions, no FS reads, no network. The doctor probe caller does the
 *   lstat/readlink and passes the already-resolved absolute target here; each
 *   detect/format pair returns a DoctorFinding in the four-ingredient
 *   What/Where/Saw/Fix shape so the engine is trivially fixture-testable. A
 *   worktree whose node_modules is symlinked into ANOTHER repo (e.g. the
 *   primary checkout) makes `pnpm exec` / pre-push validation reinstall +
 *   operate on the TARGET repo — collateral edits — and fail
 *   ERR_MODULE_NOT_FOUND on `-stable` catalog aliases resolved against the
 *   wrong tree. A real node_modules directory, or none, is healthy.
 */

import path from 'node:path'

import type { DoctorFinding } from './catalog-gap.mts'

/**
 * PURE: is `linkTarget` — an already-resolved absolute node_modules symlink
 * target — OUTSIDE `repoRoot`? undefined/absent target, or a target inside (or
 * equal to) repoRoot, is not foreign. The GAP does the lstat/readlink and
 * passes the resolved target in, so this stays a fixture-free string
 * predicate.
 */
export function isForeignNodeModulesSymlink(
  repoRoot: string,
  linkTarget: string | undefined,
): boolean {
  if (!linkTarget) {
    return false
  }
  const root = path.resolve(repoRoot)
  const target = path.resolve(linkTarget)
  if (target === root) {
    return false
  }
  const rel = path.relative(root, target)
  return rel === '' ? false : rel.startsWith('..') || path.isAbsolute(rel)
}

/**
 * Report-only finding for a foreign node_modules symlink. Fixable under --fix
 * (remove the LINK, never the target, then reinstall).
 */
export function formatForeignNodeModulesFinding(
  nodeModulesPath: string,
  target: string,
): DoctorFinding {
  return {
    fix: [
      'Remove the symlink (the LINK only, never the target) and reinstall:',
      '',
      '  rm node_modules   # unlinks the symlink; leaves the target repo untouched',
      '  pnpm install --frozen-lockfile',
      '',
      'Or run `node scripts/fleet/doctor.mts --fix` to do both automatically.',
      'A node_modules symlinked into another repo makes pnpm exec / pre-push',
      'validation reinstall + operate on the TARGET repo and fail',
      'ERR_MODULE_NOT_FOUND on -stable catalog aliases.',
    ].join('\n'),
    fixable: true,
    saw: `node_modules is a symlink into another repo: → ${target}`,
    wanted: 'a real node_modules directory installed inside this worktree',
    what: 'Foreign node_modules symlink in worktree',
    where: nodeModulesPath,
  }
}

/**
 * Finding for a reinstall that failed AFTER --fix removed a foreign
 * node_modules symlink — surfaced so the operator finishes it by hand.
 */
export function formatReinstallFailedFinding(
  cwd: string,
  detail: string,
): DoctorFinding {
  return {
    fix: 'Run `pnpm install --frozen-lockfile` in the worktree and resolve the failure manually.',
    fixable: false,
    saw: detail,
    wanted: 'a local node_modules installed from the frozen lockfile',
    what: 'Reinstall after removing foreign node_modules symlink failed',
    where: `${cwd} (pnpm install --frozen-lockfile)`,
  }
}
