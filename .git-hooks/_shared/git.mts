// Git subprocess wrappers for the hooks. Gate-free.
//
// Two flavors:
//
//   git(...)         — loose. Returns '' on failure. Used by callers that
//                      legitimately tolerate a missing ref (e.g. probing
//                      remote default-branch HEAD which may not be set up
//                      locally) and provide their own fallback. Silent
//                      by design — _shared/helpers.mts can't import the canonical
//                      logger because it runs before the Node-version
//                      gate has cleared, and a fire-and-forget dynamic
//                      import races process exit. Callers that need to
//                      know about failure should use gitOrThrow().
//
//   gitOrThrow(...)  — strict. Throws on either spawn error (git not on
//                      PATH, EAGAIN, …) or non-zero exit. Used by gitLines
//                      and every security-gate caller in pre-commit /
//                      pre-push: if `git diff --cached --name-only` fails
//                      we MUST refuse to greenlight the commit, not pass
//                      it with "no files to check."
//
// gitLines goes through gitOrThrow because every call site we have
// staged-file iteration, push-range walking, repo-toplevel lookup
// makes a security or correctness decision based on the result; an
// empty array from a failed git invocation is a fail-open.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { splitLines } from './scan-core.mts'

export const git = (...args: string[]): string => {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  return (result.stdout ?? '').trim()
}

export const gitOrThrow = (...args: string[]): string => {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (result.error) {
    throw new Error(`git ${args.join(' ')}: ${result.error.message}`)
  }
  if (typeof result.status !== 'number' || result.status !== 0) {
    const err = result.stderr?.trim() || `exit ${result.status}`
    throw new Error(`git ${args.join(' ')}: ${err}`)
  }
  return (result.stdout ?? '').trim()
}

export const gitLines = (...args: string[]): string[] => {
  const out = gitOrThrow(...args)
  return out ? splitLines(out) : []
}
