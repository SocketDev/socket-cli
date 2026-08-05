// Shared by BOTH mass-deletion tiers — the PreToolUse
// `mass-delete-guard` and the pre-commit `staged-gates` twin — so one
// definition of "this deletion is not a clobber" serves both and they cannot
// drift apart.
//
// The problem this solves: `git rm --cached <ignored-path>` stages a deletion
// for every untracked path. Untracking a build tree, a cache dir, or a fuzz
// corpus routinely stages hundreds at once, which reads to a raw deletion
// count exactly like a clobbered index. Both tiers blocked it, and the
// pre-commit tier has no bypass by design. That left two escapes, and neither
// is a real answer: `--no-verify` skips every other staged gate along with
// this one, and splitting the commit into sub-threshold chunks just games the
// count.
//
// The discriminator: a deletion is BENIGN UNTRACKING when the path STILL
// EXISTS on disk AND git would ignore it. That is precisely the
// `git rm --cached` signature — the index drops the entry, the working tree
// keeps the file. A genuine clobber has the opposite shape: it deletes
// TRACKED, NON-IGNORED files, and in the wipe cases that motivated these
// guards the files were gone from disk as well. Requiring BOTH conditions
// means a real wipe can never be laundered through this path, because a wiped
// file is neither still-on-disk nor ignored.
//
// Fail-closed: if the ignore query errors, NOTHING is classified benign, so
// every deletion counts toward the threshold and the guard still blocks. A
// broken query makes the guard stricter, never more permissive.

// `git check-ignore` follows the `git grep` exit convention: 0 = at least one
// path matched, 1 = none matched, anything higher = a real error.
const CHECK_IGNORE_MATCHED = 0
const CHECK_IGNORE_NONE_MATCHED = 1

export type StagedDeletionSplit = {
  // Deletions explained by untracking a still-present ignored path.
  benign: string[]
  // Deletions that look like a real wipe and must count toward the threshold.
  clobberish: string[]
}

/**
 * Run `git check-ignore` and return the subset of `paths` git would ignore.
 *
 * `--no-index` asks whether the ignore RULES cover the path, independent of
 * whether it is currently tracked. That is the question worth asking here:
 * the paths are already staged for deletion, so their index state is exactly
 * what is in flux.
 *
 * Returns an empty set on any error, which is the fail-closed direction — no
 * path gets excused and the caller's threshold sees every deletion.
 */
export function ignoredAmong(
  paths: readonly string[],
  runCheckIgnore: (stdin: string) => {
    status: number | undefined
    stdout: string
  },
): ReadonlySet<string> {
  if (!paths.length) {
    return new Set()
  }
  let result
  try {
    result = runCheckIgnore(`${paths.join('\n')}\n`)
  } catch {
    return new Set()
  }
  if (
    result.status !== CHECK_IGNORE_MATCHED &&
    result.status !== CHECK_IGNORE_NONE_MATCHED
  ) {
    return new Set()
  }
  return new Set(
    String(result.stdout)
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean),
  )
}

/**
 * Split staged deletions into benign untrackings and the rest.
 *
 * Pure: the ignore set and the disk probe are both supplied by the caller, so
 * each tier reads git its own way (the pre-commit tier must inherit git's
 * temporary `GIT_INDEX_FILE`) while sharing this classification.
 */
export function splitStagedDeletions(
  paths: readonly string[],
  ignored: ReadonlySet<string>,
  existsOnDisk: (path: string) => boolean,
): StagedDeletionSplit {
  const benign: string[] = []
  const clobberish: string[] = []
  for (const path of paths) {
    if (ignored.has(path) && existsOnDisk(path)) {
      benign.push(path)
    } else {
      clobberish.push(path)
    }
  }
  return { benign, clobberish }
}

/**
 * The note appended to a guard's report when some deletions were excused, so
 * the operator can see the count that was set aside and why.
 *
 * Returns undefined when nothing was excused, so a caller can append it
 * unconditionally.
 */
export function describeBenignUntrackings(
  split: StagedDeletionSplit,
): string | undefined {
  const { benign } = split
  if (!benign.length) {
    return undefined
  }
  return `${benign.length} further deletion(s) are gitignored paths that still exist on disk (a \`git rm --cached\` untracking), and do not count toward the threshold.`
}
