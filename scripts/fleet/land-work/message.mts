/**
 * @file Commit-message composition for land-work's grouped auto-commits.
 *   Split out of land-work.mts to stay under the file-size cap. commitMessage
 *   is pure — both land-work.mts (the auto-lander) and consolidate-commits.mts
 *   (the regroup tool) share this one engine, and it is unit-tested without a
 *   working tree.
 *   Layout: a deterministic Conventional-Commit SUBJECT naming the touched
 *   sub-areas, then a per-directory file digest a reader scans in `git log`.
 *   The optional `aiSummary` (from land-work/ai-summary.mts, floor-tier) is a
 *   high-level "what & why" inserted below the subject, above the digest;
 *   absent it, the digest stands alone.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type { CommitGroup } from '../land-work.mts'

// Summary bounds — keep the subject scannable and the body a high-level
// digest, not an unbounded file dump.
const MAX_SUBJECT_AREAS = 3
const MAX_BODY_DIRS = 20
const MAX_FILES_PER_DIR = 8

/**
 * A short, scannable label for a directory in the subject line: the last two
 * path segments (the identifying tail), or `(root)` for a repo-root file. The
 * body keeps the full path; the subject only needs enough to recognize the
 * area. Pure.
 */
function shortArea(dir: string): string {
  if (dir === '.') {
    return '(root)'
  }
  const segs = normalizePath(dir).split('/')
  return segs.length <= 2 ? dir : segs.slice(-2).join('/')
}

/**
 * Compose the commit message for an auto-landed group. A single-file group
 * names the file directly (that IS the summary). A multi-file group gets a
 * Conventional-Commit subject naming the touched sub-areas, then a body that
 * lists the changed files grouped by directory — a high-level digest a reader
 * can scan in `git log` to tell WHAT landed, not just how many files.
 *
 * `aiSummary` (optional, from land-work/ai-summary.mts) is a floor-tier "what &
 * why" line inserted below the subject, above the digest, for multi-file groups
 * only; a single-file group already names its file. Deterministic and pure.
 */
export function commitMessage(group: CommitGroup, aiSummary?: string): string {
  const { paths, scope, type } = group
  const n = paths.length
  if (n === 1) {
    return `${type}(${scope}): update ${normalizePath(paths[0]!)}`
  }
  // Bucket files by directory for both the subject areas and the body digest.
  const byDir = new Map<string, string[]>()
  for (const p of paths) {
    const np = normalizePath(p)
    const slash = np.lastIndexOf('/')
    const dir = slash === -1 ? '.' : np.slice(0, slash)
    const base = slash === -1 ? np : np.slice(slash + 1)
    const list = byDir.get(dir)
    if (list) {
      list.push(base)
    } else {
      byDir.set(dir, [base])
    }
  }
  const dirs = [...byDir.keys()].toSorted()
  // Subject: name up to MAX_SUBJECT_AREAS sub-areas, then `+K more`.
  const shownAreas = dirs.slice(0, MAX_SUBJECT_AREAS).map(shortArea)
  const extraAreas = dirs.length - shownAreas.length
  const areas =
    extraAreas > 0
      ? `${shownAreas.join(', ')} +${extraAreas} more`
      : shownAreas.join(', ')
  const subject = `${type}(${scope}): update ${areas} (${n} files)`
  // Body: one bullet per directory (bounded), listing its file basenames.
  const bulletDirs = dirs.slice(0, MAX_BODY_DIRS)
  const lines: string[] = []
  for (const dir of bulletDirs) {
    const files = byDir.get(dir)!.toSorted()
    const shownFiles = files.slice(0, MAX_FILES_PER_DIR)
    const moreFiles = files.length - shownFiles.length
    const suffix = moreFiles > 0 ? `, +${moreFiles} more` : ''
    lines.push(
      `- ${dir === '.' ? '(root)' : dir}: ${shownFiles.join(', ')}${suffix}`,
    )
  }
  const moreDirs = dirs.length - bulletDirs.length
  if (moreDirs > 0) {
    lines.push(`- +${moreDirs} more director${moreDirs === 1 ? 'y' : 'ies'}`)
  }
  const digest = lines.join('\n')
  const summary = aiSummary?.trim()
  const body = summary ? `${summary}\n\n${digest}` : digest
  return `${subject}\n\n${body}`
}
