/*
 * @file Fleet check — the gh CLI's default repo for this checkout matches the
 *   `origin` remote's owner/name. In a FORK checkout, a bare `gh` command
 *   (`gh run list`, `gh workflow run`, `gh issue list`, `gh api` helpers) that
 *   has no explicit `-R` resolves its target through gh's default-repo logic —
 *   and without an explicit `gh repo set-default`, that resolution lands on
 *   the fork NETWORK'S PARENT, not origin. Incident (2026-07-24, twice): bare
 *   gh commands in the socket-packageurl-js checkout (a fork of
 *   package-url/packageurl-js) targeted the upstream parent — a workflow
 *   dispatch 404'd (npm-publish.yml does not exist on the parent) and issue
 *   queries read the wrong repo.
 *   RED when:
 *
 *   - a `remote.<r>.gh-resolved` marker exists and its EFFECTIVE repo (`base` →
 *     that remote's own repo, else the literal `owner/repo` value) differs from
 *     origin's owner/name, OR
 *   - NO marker exists and the checkout has 2+ distinct GitHub repos among its
 *     remotes (e.g. origin + upstream) — the ambiguous shape where a bare gh
 *     mis-resolves or prompts. PASS when origin is absent / not GitHub (nothing
 *     to assert), when the marker resolves to origin, or when a single-repo
 *     checkout has no marker (gh uses the only remote). Entirely LOCAL (git
 *     config + git remote parses; no network, no gh dependency). Fail-open on
 *     any git error. Fix: `gh repo set-default <origin-owner/name>` —
 *     equivalently `git config remote.origin.gh-resolved base`, which is what
 *     `--fix` applies (also wired into `doctor --fix`, so the cascade fixer
 *     heals it). Usage: node
 *     scripts/fleet/check/gh-default-repo-matches-origin.mts [--fix]
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

/**
 * Parse a GitHub remote URL (https / ssh / scp-like) to `owner/repo`.
 * Returns undefined for non-GitHub or unparsable URLs.
 */
export function parseGitHubRepo(url: string): string | undefined {
  const trimmed = url.trim()
  // Three URL shapes share one host prefix: `https://[user@]github.com/`,
  // `ssh://[user@]github.com/`, or scp-like `git@github.com:`. Then capture
  // owner (`[^/\s]+`) and repo (`[^/\s]+?`, lazy so a trailing `.git` and/or
  // `/` stays out of the name).
  const m =
    /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(
      trimmed,
    )
  if (!m) {
    return undefined
  }
  return `${m[1]}/${m[2]}`
}

/**
 * Parse `git remote -v` output into remote name → `owner/repo` (GitHub
 * fetch remotes only).
 */
export function parseRemotes(remoteVOutput: string): Map<string, string> {
  const out = new Map<string, string>()
  const lines = remoteVOutput.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (!line || !line.endsWith('(fetch)')) {
      continue
    }
    // A `git remote -v` fetch line: remote name, URL, literal `(fetch)`,
    // separated by whitespace.
    const m = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line)
    if (!m) {
      continue
    }
    const repo = parseGitHubRepo(m[2]!)
    if (repo) {
      out.set(m[1]!, repo)
    }
  }
  return out
}

/**
 * Parse `git config --get-regexp '^remote\..+\.gh-resolved$'` output into
 * remote name → raw value (`base` or an explicit `owner/repo`).
 */
export function parseGhResolved(configOutput: string): Map<string, string> {
  const out = new Map<string, string>()
  const lines = configOutput.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    // A `git config --get-regexp` line: `remote.<name>.gh-resolved` with an
    // optional whitespace-separated value (absent for the bare-key form).
    const m = /^remote\.(.+)\.gh-resolved(?:\s+(.*))?$/.exec(line)
    if (!m) {
      continue
    }
    // A bare `remote.origin.gh-resolved` (no value) is how gh marks "this
    // remote's own repo is the default" in some versions — same as `base`.
    out.set(m[1]!, m[2]?.trim() || 'base')
  }
  return out
}

export interface GhDefaultRepoGap {
  /**
   * What gh currently resolves to (or undefined when no marker exists).
   */
  effective: string | undefined
  /**
   * The fix command to surface.
   */
  fix: string
  /**
   * Origin's owner/repo.
   */
  origin: string
  /**
   * Human-readable reason.
   */
  reason: string
}

/**
 * Pure core: given the parsed remotes + gh-resolved markers, return the gap
 * (or undefined when healthy). See the file header for the rules.
 */
export function evaluateGhDefaultRepo(
  remotes: ReadonlyMap<string, string>,
  resolved: ReadonlyMap<string, string>,
): GhDefaultRepoGap | undefined {
  const origin = remotes.get('origin')
  if (!origin) {
    // No GitHub origin — nothing to assert (fail-open).
    return undefined
  }
  const fix = `gh repo set-default ${origin}`
  if (resolved.size > 0) {
    for (const [remoteName, value] of resolved) {
      const effective = value === 'base' ? remotes.get(remoteName) : value
      if (!effective || effective.toLowerCase() !== origin.toLowerCase()) {
        return {
          effective,
          fix,
          origin,
          reason:
            `gh's default repo marker (remote.${remoteName}.gh-resolved = ${value}) ` +
            `resolves to ${effective ?? 'an unknown repo'}, not origin (${origin}) — ` +
            'bare gh commands target the wrong repo.',
        }
      }
    }
    return undefined
  }
  // No marker: ambiguous only when 2+ distinct GitHub repos are configured
  // (fork checkout with an upstream remote) — the shape that mis-resolves.
  const distinct = new Set<string>()
  for (const repo of remotes.values()) {
    distinct.add(repo.toLowerCase())
  }
  if (distinct.size > 1) {
    return {
      effective: undefined,
      fix,
      origin,
      reason:
        `no gh default-repo marker and ${distinct.size} distinct GitHub repos ` +
        'among the remotes — a bare gh command resolves the fork parent (or ' +
        'prompts) instead of origin.',
    }
  }
  return undefined
}

function git(args: readonly string[], cwd: string): string | undefined {
  const r = spawnSync('git', args as string[], {
    cwd,
    stdioString: true,
    timeout: 10_000,
  })
  // `git config --get-regexp` exits 1 with empty output when nothing matches —
  // that is a valid "no markers" answer, not an error.
  if (typeof r.stdout !== 'string') {
    return undefined
  }
  return r.stdout
}

/**
 * Read the checkout's state and evaluate. Returns the gap or undefined.
 * Fail-open: any git read failure returns undefined.
 */
export function detectGhDefaultRepoGap(
  cwd: string = REPO_ROOT,
): GhDefaultRepoGap | undefined {
  const remoteV = git(['remote', '-v'], cwd)
  if (remoteV === undefined) {
    return undefined
  }
  const configOut = git(
    ['config', '--get-regexp', '^remote\\..+\\.gh-resolved$'],
    cwd,
  )
  return evaluateGhDefaultRepo(
    parseRemotes(remoteV),
    parseGhResolved(configOut ?? ''),
  )
}

/**
 * Apply the fix: clear any stray markers, then mark origin as gh's default
 * (`remote.origin.gh-resolved = base` — byte-what `gh repo set-default`
 * writes when the chosen default is origin's own repo). Local-only + safe.
 * Returns true when the post-state is healthy.
 */
export function applyGhDefaultRepoFix(cwd: string = REPO_ROOT): boolean {
  const configOut = git(
    ['config', '--get-regexp', '^remote\\..+\\.gh-resolved$'],
    cwd,
  )
  const stray = parseGhResolved(configOut ?? '')
  for (const remoteName of stray.keys()) {
    if (remoteName !== 'origin') {
      spawnSync(
        'git',
        ['config', '--unset-all', `remote.${remoteName}.gh-resolved`],
        { cwd, stdio: 'ignore', timeout: 10_000 },
      )
    }
  }
  spawnSync('git', ['config', 'remote.origin.gh-resolved', 'base'], {
    cwd,
    stdio: 'ignore',
    timeout: 10_000,
  })
  return detectGhDefaultRepoGap(cwd) === undefined
}

export function runCheck(
  options?: { fix?: boolean | undefined } | undefined,
): number {
  const opts = { __proto__: null, ...options } as { fix?: boolean | undefined }
  const gap = detectGhDefaultRepoGap()
  if (!gap) {
    logger.success(
      '[gh-default-repo-matches-origin] gh default repo resolves to origin.',
    )
    return 0
  }
  if (opts.fix && applyGhDefaultRepoFix()) {
    logger.success(
      `[gh-default-repo-matches-origin] fixed: gh default repo set to ${gap.origin}.`,
    )
    return 0
  }
  logger.fail(
    [
      '[gh-default-repo-matches-origin] gh default repo does not match origin.',
      '',
      `  Saw:    ${gap.reason}`,
      `  Wanted: bare gh commands targeting origin (${gap.origin}).`,
      '  Why: in a fork checkout, an unset/misdirected default sends workflow',
      '  dispatches and issue/PR queries to the UPSTREAM PARENT (2026-07-24:',
      '  npm-publish.yml dispatch 404d on package-url/packageurl-js).',
      '  Fix:',
      `    ${gap.fix}`,
      '  (or re-run this check with --fix, or `pnpm run fix --all`).',
      '',
    ].join('\n'),
  )
  return 1
}

async function main(): Promise<void> {
  process.exitCode = runCheck({ fix: process.argv.includes('--fix') })
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
