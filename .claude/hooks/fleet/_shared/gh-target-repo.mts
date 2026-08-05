/*
 * @file Target-repo resolution for guards that gate `gh` commands. A
 *   `--repo`/`-R` flag re-points gh at a repo that may not be the invoking
 *   checkout, so a guard reading only local state (local tags, the local
 *   squash-history marker) answers the wrong question for it. These helpers
 *   let a guard tell "this checkout's own repo" apart from a foreign target:
 *   release-tag-tied-guard probes GitHub for foreign tags, and
 *   no-pr-in-squash-repo-guard stands down entirely — a foreign repo's
 *   landing conventions are its own.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

/**
 * `OWNER/REPO` from any form `gh --repo` (or a git origin URL) carries:
 * `owner/repo`, `host/owner/repo`, `https://host/owner/repo[.git]`,
 * `git@host:owner/repo[.git]`. '' when no owner/repo pair is present.
 */
export function normalizeRepoSlug(value: string): string {
  let rest = value.trim()
  const protoAt = rest.indexOf('://')
  if (protoAt !== -1) {
    rest = rest.slice(protoAt + 3)
  }
  // scp-like `host:owner/repo` — the colon plays the role of a slash.
  rest = rest.replace(':', '/').replace(/\.git$/, '')
  const parts = rest.split('/').filter(Boolean)
  if (parts.length < 2) {
    return ''
  }
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

// True when `repo` (an OWNER/REPO slug) is the same repo the checkout at
// `cwd` tracks as origin. No origin, or an unreadable one, is "not the same".
export function repoMatchesOrigin(repo: string, cwd: string): boolean {
  const origin = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd,
    stdio: 'pipe',
  })
  if (origin.error || origin.status !== 0) {
    return false
  }
  const originSlug = normalizeRepoSlug(String(origin.stdout).trim())
  return !!originSlug && originSlug.toLowerCase() === repo.toLowerCase()
}

/**
 * The raw `--repo`/`-R` value of a gh argv, or '' when the flag is absent.
 * Handles the `--repo value`, `--repo=value`, and `-R=value` forms.
 */
export function ghExplicitRepoArg(args: readonly string[]): string {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (arg === '--repo' || arg === '-R') {
      return args[i + 1] ?? ''
    }
    if (arg.startsWith('--repo=') || arg.startsWith('-R=')) {
      return arg.slice(arg.indexOf('=') + 1)
    }
  }
  return ''
}
