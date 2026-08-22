// A durable-backup ref: pushed to get work OFF THE MACHINE, never to be
// consumed. Nothing builds from it, nothing installs it, no CI runs it.
//
// Why the namespace exists: on a shared checkout local main carries every
// session's commits, so one session's lint debt gates another session's push.
// The work then lives on one disk. That is how an afternoon of commits was lost
// when a checkout was deleted - the commits were real, reviewed, and nowhere
// else.
//
// So the QUALITY bar is scoped to the branches people consume. A backup push
// still runs every SAFETY scan: a leaked secret or an unsigned commit is a fact
// about the bytes, and a backup ref is as public as any other. What it skips is
// lint, format, types, and dispatch drift - because a backup that has to be
// green is a backup you cannot take at the moment you need it most.

/**
 * The namespaces reserved for durable backups. A branch here is understood to
 * be UNTESTED: rebase or cherry-pick from it, never merge it as-is.
 */
export const DURABLE_REF_PREFIXES: readonly string[] = [
  'refs/heads/wip/',
  'refs/heads/worktree/',
]

/**
 * Whether `remoteRef` names a durable backup rather than a consumed branch.
 *
 * Matched on the FULL remote ref, so a local branch merely named `wip/x` cannot
 * opt a push to `main` out of the gates. The trailing slash is required, so a
 * branch called `wip-something` does not qualify by prefix accident, and a bare
 * `refs/heads/wip` with nothing after it does not either.
 */
export function isDurableBackupRef(remoteRef: string): boolean {
  for (let i = 0, { length } = DURABLE_REF_PREFIXES; i < length; i += 1) {
    const prefix = DURABLE_REF_PREFIXES[i]!
    if (remoteRef.startsWith(prefix) && remoteRef.length > prefix.length) {
      return true
    }
  }
  return false
}

/**
 * Whether this push carries ONLY durable-backup refs.
 *
 * Every ref must qualify. A push that updates a backup ref AND a real branch in
 * one invocation is a real push, because the real branch is what people consume
 * - reading it as a backup would let any ref smuggle a main update past the
 * quality gates.
 *
 * An empty list is NOT durable. No refs means nothing was proven, and
 * defaulting to "skip the gates" on an unreadable stdin is the wrong direction
 * to fail.
 */
export function isDurableBackupPush(remoteRefs: readonly string[]): boolean {
  if (remoteRefs.length === 0) {
    return false
  }
  for (let i = 0, { length } = remoteRefs; i < length; i += 1) {
    if (!isDurableBackupRef(remoteRefs[i]!)) {
      return false
    }
  }
  return true
}

/**
 * The branch name to back the current work up to, given a session label.
 *
 * Slashes and whitespace in the label would create nested refs or an invalid
 * name, so everything outside the safe set collapses to a dash. The `wip/`
 * prefix is not optional: it is what the gate keys on.
 */
export function durableBackupBranch(label: string): string {
  const safe = label
    .toLowerCase()
    // Anything outside the safe set becomes one dash, so a slash cannot nest a
    // ref and whitespace cannot invalidate the name.
    .replace(/[^a-z0-9._-]+/g, '-')
    // `^-+` and `-+$` - the dashes the collapse above leaves at either edge.
    .replace(/^-+|-+$/g, '')
  return `wip/${safe || 'session'}`
}
