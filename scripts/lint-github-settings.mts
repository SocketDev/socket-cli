/**
 * @fileoverview Fleet lint: validate (and optionally fix) the GitHub
 * repository settings against the canonical fleet config.
 *
 * Why this exists: a half-dozen repo settings determine whether the
 * fleet enforces signed commits, restricts PRs to collaborators,
 * disables wikis/discussions/projects/forks, and forces squash-only
 * merges. GitHub doesn't make these flags discoverable to the
 * maintainer, and the only signal a repo is misconfigured is when
 * something breaks in production. This script audits them and prints
 * the exact URL to fix each, or PATCHes them itself with `--fix`.
 *
 * Run cadence: weekly, locally. The first successful run writes
 * `.cache/socket-wheelhouse-github-settings.json` with a timestamp;
 * subsequent runs within 7 days are no-ops (use `--force` to override).
 *
 * CI behavior: if `CI=true` is in the env (GitHub Actions, etc.), the
 * script skips entirely. Settings audits aren't a CI gate — the local
 * cache write is the gate. CI failing on a missing/stale cache would
 * burn API quota on every job and serialize maintainers behind it.
 *
 * Auth: requires `gh` CLI authenticated, OR `GITHUB_TOKEN` /
 * `GH_TOKEN` in env. Read-only audit needs `repo:read`; `--fix` needs
 * `repo:admin` (PATCH /repos/{owner}/{repo}).
 *
 * Usage:
 *   node scripts/lint-github-settings.mts            # audit (uses cache)
 *   node scripts/lint-github-settings.mts --force    # audit (skip cache)
 *   node scripts/lint-github-settings.mts --fix      # audit + apply fixes
 *   node scripts/lint-github-settings.mts --json     # machine-readable
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Walk up from this script's own location to find the repo root —
 * the nearest ancestor that has a `package.json`. `process.cwd()` is
 * wrong here because the user might invoke `node scripts/foo.mts`
 * from any subdirectory; we want the repo, not the invocation
 * directory.
 */
function findRepoRoot(): string {
  let cur = path.dirname(fileURLToPath(import.meta.url))
  const root = path.parse(cur).root
  while (cur && cur !== root) {
    if (existsSync(path.join(cur, 'package.json'))) {
      return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  throw new Error(
    `Could not resolve repo root from ${fileURLToPath(import.meta.url)} ` +
      '(no ancestor has package.json).',
  )
}

const REPO_ROOT = findRepoRoot()

interface RepoApiPayload {
  default_branch?: string
  has_wiki?: boolean
  has_discussions?: boolean
  has_projects?: boolean
  allow_forking?: boolean
  allow_squash_merge?: boolean
  allow_merge_commit?: boolean
  allow_rebase_merge?: boolean
  allow_auto_merge?: boolean
  allow_update_branch?: boolean
  delete_branch_on_merge?: boolean
  pull_request_creation_policy?: string
  full_name?: string
}

interface BranchProtectionPayload {
  required_signatures?: { enabled?: boolean }
}

interface Finding {
  rule: string
  current: unknown
  expected: unknown
  fixUrl: string
  fixable: boolean
  /** PATCH-shaped patch payload to apply when --fix is given. */
  fixPatch?: Record<string, unknown>
  /** Required permission for the PATCH; informational. */
  fixRequires?: string
}

interface CacheEntry {
  verifiedAt: string
  repo: string
  pass: boolean
  ttl: number
  findings: Finding[]
}

// Cache lives at `node_modules/.cache/` — fleet convention for
// build-tool state (vitest, etc.) and the only `.cache/` flavor
// that's auto-ignored everywhere (via pnpm/npm's gitignore + the
// fleet's `**/.cache/` rule). Path constructed once.
const CACHE_DIR = path.join(REPO_ROOT, 'node_modules', '.cache')
// Cache file name mirrors the script name (`lint-github-settings`)
// + the `socket-wheelhouse-` fleet prefix so it doesn't collide with
// any other tool's cache file under node_modules/.cache/.
const CACHE_FILE = path.join(
  CACHE_DIR,
  'socket-wheelhouse-lint-github-settings.json',
)
// 7 days in ms. Mirrors the fleet's npm catalog soak window
// (minimumReleaseAge: 10080 minutes), which is the same governing
// timeframe for "things we don't need to re-verify constantly."
const TTL_MS = 7 * 24 * 60 * 60 * 1000

interface CliFlags {
  fix: boolean
  force: boolean
  json: boolean
}

function parseFlags(): CliFlags {
  const argv = process.argv.slice(2)
  return {
    fix: argv.includes('--fix'),
    force: argv.includes('--force'),
    json: argv.includes('--json'),
  }
}

/**
 * Read a fresh cache entry, or undefined if absent/stale/malformed.
 * Stale is decided by `verifiedAt + ttl < now`. Malformed entries
 * (parse error, missing fields, wrong repo) are treated as absent —
 * the next run will rewrite them.
 */
function readCache(repo: string): CacheEntry | undefined {
  if (!existsSync(CACHE_FILE)) return undefined
  let raw: string
  try {
    raw = readFileSync(CACHE_FILE, 'utf8')
  } catch {
    return undefined
  }
  let entry: CacheEntry
  try {
    entry = JSON.parse(raw) as CacheEntry
  } catch {
    return undefined
  }
  if (entry.repo !== repo) return undefined
  const verifiedAt = Date.parse(entry.verifiedAt)
  if (!Number.isFinite(verifiedAt)) return undefined
  if (Date.now() - verifiedAt > (entry.ttl ?? TTL_MS)) return undefined
  return entry
}

function writeCache(entry: CacheEntry): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true })
  }
  writeFileSync(CACHE_FILE, JSON.stringify(entry, null, 2) + '\n')
}

/**
 * Resolve `<owner>/<repo>` by asking `gh repo view` (which knows the
 * current dir's git remote). Falls back to `git config remote.origin.url`
 * + manual parse if `gh` is missing.
 */
function resolveRepo(): string | undefined {
  // Try gh first. cwd=REPO_ROOT so gh resolves the repo from this
  // checkout's git remote rather than whatever shell dir the user
  // invoked node from.
  const gh = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (gh.status === 0) {
    try {
      const obj = JSON.parse(gh.stdout) as { nameWithOwner?: string }
      if (obj.nameWithOwner) return obj.nameWithOwner
    } catch {
      // fall through
    }
  }
  // Fallback: parse origin URL. Same cwd-pinning rationale.
  const remote = spawnSync(
    'git',
    ['config', '--get', 'remote.origin.url'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  if (remote.status !== 0) return undefined
  const url = remote.stdout.trim()
  // Match `git@github.com:owner/repo[.git]` or
  // `https://github.com/owner/repo[.git]`.
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url)
  if (!m) return undefined
  return `${m[1]}/${m[2]}`
}

/**
 * Thin wrapper around `gh api`. Returns JSON-parsed body on success
 * or undefined on any error. The caller decides whether undefined is
 * an audit-failing condition or a soft skip.
 */
function ghApi<T>(
  endpoint: string,
  method: 'GET' | 'PATCH' = 'GET',
  body?: Record<string, unknown>,
): T | undefined {
  const args = ['api', endpoint]
  if (method !== 'GET') {
    args.push('-X', method)
  }
  if (body) {
    for (const [k, v] of Object.entries(body)) {
      // gh api uses -F for raw JSON values (bool/null), -f for strings.
      const isRaw =
        typeof v === 'boolean' ||
        typeof v === 'number' ||
        v === null ||
        Array.isArray(v) ||
        typeof v === 'object'
      const flag = isRaw ? '-F' : '-f'
      args.push(flag, `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    }
  }
  const r = spawnSync('gh', args, { encoding: 'utf8' })
  if (r.status !== 0) {
    if (process.env['DEBUG']) {
      process.stderr.write(`gh ${args.join(' ')} failed: ${r.stderr}\n`)
    }
    return undefined
  }
  if (!r.stdout.trim()) return undefined as unknown as T
  try {
    return JSON.parse(r.stdout) as T
  } catch {
    return undefined
  }
}

/**
 * Canonical fleet config. Each rule names the API field, expected
 * value, and the fix URL. `fixPatch` is the body to send to PATCH
 * /repos/{owner}/{repo} when --fix is given (undefined = manual fix
 * required, no API endpoint yet).
 */
function evaluate(
  repo: string,
  apiRepo: RepoApiPayload,
  apiProtection: BranchProtectionPayload | undefined,
): Finding[] {
  const findings: Finding[] = []
  const settingsUrl = `https://github.com/${repo}/settings`
  const branchesUrl = `https://github.com/${repo}/settings/branches`

  const check = (
    rule: string,
    current: unknown,
    expected: unknown,
    fixUrl: string,
    fixPatch: Record<string, unknown> | undefined,
  ): void => {
    if (current === expected) return
    findings.push({
      rule,
      current,
      expected,
      fixUrl,
      fixable: fixPatch !== undefined,
      ...(fixPatch !== undefined ? { fixPatch, fixRequires: 'repo:admin' } : {}),
    })
  }

  check(
    'default_branch must be main',
    apiRepo.default_branch,
    'main',
    branchesUrl,
    // No PATCH for default_branch via /repos/{owner}/{repo} — need to
    // rename the branch first via /repos/{owner}/{repo}/rename-branch
    // and then set it. Manual.
    undefined,
  )
  check('has_wiki must be false', apiRepo.has_wiki, false, `${settingsUrl}#features`, { has_wiki: false })
  check('has_discussions must be false', apiRepo.has_discussions, false, `${settingsUrl}#features`, { has_discussions: false })
  check('has_projects must be false', apiRepo.has_projects, false, `${settingsUrl}#features`, { has_projects: false })
  check('allow_forking must be false', apiRepo.allow_forking, false, `${settingsUrl}#features`, { allow_forking: false })
  check('allow_squash_merge must be true', apiRepo.allow_squash_merge, true, `${settingsUrl}#pull-requests`, { allow_squash_merge: true })
  check('allow_merge_commit must be false', apiRepo.allow_merge_commit, false, `${settingsUrl}#pull-requests`, { allow_merge_commit: false })
  check('allow_rebase_merge must be false', apiRepo.allow_rebase_merge, false, `${settingsUrl}#pull-requests`, { allow_rebase_merge: false })
  check('allow_auto_merge must be true', apiRepo.allow_auto_merge, true, `${settingsUrl}#pull-requests`, { allow_auto_merge: true })
  check('allow_update_branch must be true', apiRepo.allow_update_branch, true, `${settingsUrl}#pull-requests`, { allow_update_branch: true })
  check('delete_branch_on_merge must be true', apiRepo.delete_branch_on_merge, true, `${settingsUrl}#pull-requests`, { delete_branch_on_merge: true })
  check(
    'pull_request_creation_policy must be collaborators_only',
    apiRepo.pull_request_creation_policy,
    'collaborators_only',
    `${settingsUrl}#pull-requests`,
    { pull_request_creation_policy: 'collaborators_only' },
  )

  // Branch protection on main — signed commits.
  if (!apiProtection) {
    findings.push({
      rule: 'main branch protection must exist',
      current: undefined,
      expected: '{ required_signatures: { enabled: true } }',
      fixUrl: branchesUrl,
      fixable: false,
    })
  } else if (apiProtection.required_signatures?.enabled !== true) {
    findings.push({
      rule: 'main branch protection: required_signatures must be enabled',
      current: apiProtection.required_signatures?.enabled ?? false,
      expected: true,
      fixUrl: branchesUrl,
      // PATCH /repos/{owner}/{repo}/branches/{branch}/protection/required_signatures
      // is the endpoint; this script's --fix doesn't auto-apply it
      // because rewriting branch protection rules can clobber custom
      // status-check requirements set by the maintainer. Manual.
      fixable: false,
    })
  }

  return findings
}

function applyFixes(repo: string, findings: readonly Finding[]): number {
  const patchable = findings.filter(f => f.fixable && f.fixPatch)
  if (patchable.length === 0) {
    return 0
  }
  // Merge all PATCH bodies into one call — /repos/{owner}/{repo}
  // accepts arbitrary subsets of settings.
  const patch: Record<string, unknown> = {}
  for (const f of patchable) {
    Object.assign(patch, f.fixPatch)
  }
  process.stdout.write(`\n🔧 Applying ${patchable.length} fixes via PATCH /repos/${repo}:\n`)
  for (const [k, v] of Object.entries(patch)) {
    process.stdout.write(`    ${k} = ${JSON.stringify(v)}\n`)
  }
  const result = ghApi(`repos/${repo}`, 'PATCH', patch)
  if (!result) {
    process.stderr.write(
      '::error::PATCH failed. Token may lack `repo:admin` permission.\n',
    )
    return 0
  }
  return patchable.length
}

function printReport(findings: readonly Finding[], repo: string, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify({ repo, findings }, null, 2) + '\n')
    return
  }
  if (findings.length === 0) {
    process.stdout.write(`✓ GitHub settings audit passed for ${repo}.\n`)
    return
  }
  process.stdout.write(`\n${findings.length} finding(s) for ${repo}:\n\n`)
  for (const f of findings) {
    process.stdout.write(`  ✗ ${f.rule}\n`)
    process.stdout.write(`      current: ${JSON.stringify(f.current)}\n`)
    process.stdout.write(`      expected: ${JSON.stringify(f.expected)}\n`)
    process.stdout.write(`      fix: ${f.fixUrl}\n`)
    if (f.fixable) {
      process.stdout.write(`      auto-fix: --fix (requires repo:admin)\n`)
    }
    process.stdout.write('\n')
  }
  // Manual-verify items — always print.
  const settingsUrl = `https://github.com/${repo}/settings`
  process.stdout.write('Manual-verify (no REST API; check via UI):\n')
  process.stdout.write(`  • Commit comments must be disabled: ${settingsUrl} → General → Commits\n`)
  process.stdout.write(`  • Release immutability enabled: ${settingsUrl} → General → Releases\n`)
  process.stdout.write(`  • Sponsorships button off: ${settingsUrl} → General → Features\n`)
  process.stdout.write(`  • Auto-close issues with merged linked PRs ON: ${settingsUrl} → General → Pull Requests\n`)
  process.stdout.write(`  • Single-push branch+tag update limit = 5: ${settingsUrl} → General → Pushes\n`)
  process.stdout.write(`  • Required Actions secrets present (ANTHROPIC_API_KEY, SOCKET_API_TOKEN): ${settingsUrl}/secrets/actions\n`)
}

function main(): number {
  // CI bypass — settings audits are local-run only. See header comment.
  if (process.env['CI'] === 'true') {
    process.stdout.write('CI=true detected; skipping GitHub settings audit (local-run only).\n')
    return 0
  }

  const flags = parseFlags()
  const repo = resolveRepo()
  if (!repo) {
    process.stderr.write(
      '::error::Could not resolve <owner>/<repo>. Run from inside a git checkout with a github.com remote.\n',
    )
    return 1
  }

  // Cache hit shortcut (unless --force or --fix).
  if (!flags.force && !flags.fix) {
    const cached = readCache(repo)
    if (cached?.pass) {
      const ageHours = Math.round((Date.now() - Date.parse(cached.verifiedAt)) / 3600_000)
      process.stdout.write(
        `✓ Cache fresh (${ageHours}h old, < 7d TTL). Use --force to re-check.\n`,
      )
      return 0
    }
  }

  const apiRepo = ghApi<RepoApiPayload>(`repos/${repo}`)
  if (!apiRepo) {
    process.stderr.write(
      `::error::Could not fetch repos/${repo}. Check gh auth status / token permissions.\n`,
    )
    return 1
  }

  const apiProtection = ghApi<BranchProtectionPayload>(
    `repos/${repo}/branches/main/protection`,
  )

  let findings = evaluate(repo, apiRepo, apiProtection)

  if (flags.fix && findings.length > 0) {
    const fixedCount = applyFixes(repo, findings)
    if (fixedCount > 0) {
      // Re-fetch + re-evaluate so the report + cache reflect post-fix
      // state. Cheap (one extra GET).
      const apiRepoAfter = ghApi<RepoApiPayload>(`repos/${repo}`)
      if (apiRepoAfter) {
        findings = evaluate(repo, apiRepoAfter, apiProtection)
      }
    }
  }

  printReport(findings, repo, flags.json)

  // Cache only when there's nothing left unresolved — a partial pass
  // shouldn't suppress next-week's re-check.
  const pass = findings.length === 0
  writeCache({
    verifiedAt: new Date().toISOString(),
    repo,
    pass,
    ttl: TTL_MS,
    findings,
  })

  return pass ? 0 : 1
}

process.exit(main())
