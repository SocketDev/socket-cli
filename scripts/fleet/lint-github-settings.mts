/**
 * @file Fleet lint: validate (and optionally fix) the GitHub repository
 *   settings against the canonical fleet config. Why this exists: a half-dozen
 *   repo settings determine whether the fleet enforces signed commits,
 *   restricts PRs to collaborators, disables wikis/discussions/projects/forks,
 *   and forces squash-only merges. GitHub doesn't make these flags discoverable
 *   to the maintainer, and the only signal a repo is misconfigured is when
 *   something breaks in production. This script audits them and prints the
 *   exact URL to fix each, or PATCHes them itself with `--fix`. Run cadence:
 *   weekly, locally. The first successful run writes
 *   `.cache/socket-wheelhouse-github-settings.json` with a timestamp;
 *   subsequent runs within 7 days are no-ops (use `--force` to override). CI
 *   behavior: if `CI=true` is in the env (GitHub Actions, etc.), the script
 *   skips entirely. Settings audits aren't a CI gate — the local cache write is
 *   the gate. CI failing on a missing/stale cache would burn API quota on every
 *   job and serialize maintainers behind it. Auth: requires `gh` CLI
 *   authenticated, OR `GITHUB_TOKEN` / `GH_TOKEN` in env. Read-only audit needs
 *   `repo:read`; `--fix` needs `repo:admin` (PATCH /repos/{owner}/{repo}).
 *   Usage: node scripts/fleet/lint-github-settings.mts # audit (uses cache)
 *   node scripts/fleet/lint-github-settings.mts --force # audit (skip cache)
 *   node scripts/fleet/lint-github-settings.mts --fix # audit + apply fixes
 *   node scripts/fleet/lint-github-settings.mts --json # machine-readable.
 *   Detection helpers (`gh api` wrapper, app/workflow probes) live in
 *   `lint-github-settings-detect.mts`; the settings→findings decision tree
 *   lives in `lint-github-settings-evaluate.mts`; shared types live in
 *   `lint-github-settings-types.mts` — split out to keep each file under the
 *   500-line soft cap.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { REPO_ROOT } from './paths.mts'
import {
  detectInstalledApps,
  detectLocalShadows,
  ghApi,
  loadCustomProperties,
  readDeclaredApps,
  resolveRepo,
} from './lint-github-settings-detect.mts'
import { evaluate } from './lint-github-settings-evaluate.mts'
import type {
  BranchProtectionPayload,
  CacheEntry,
  CliFlags,
  Finding,
  RepoApiPayload,
} from './lint-github-settings-types.mts'
import { isMainModule } from './_shared/is-main-module.mts'

// Inline path equivalent of the wheelhouse template's paths.mts helper.
// `lint-github-settings.mts` cascades into fleet repos whose per-package
// `paths.mts` is intentionally minimal (`socket-cli`, `ultrathink`, etc.
// only export REPO_ROOT + package-specific build paths). Importing
// `NODE_MODULES_CACHE_DIR` from `./paths.mts` would force every consumer
// to widen their paths.mts surface — wrong direction. Keep the
// per-package paths.mts narrow; carry the standalone constant here.
const NODE_MODULES_CACHE_DIR = path.join(REPO_ROOT, 'node_modules', '.cache')

// Cache lives at `node_modules/.cache/` — fleet convention for
// build-tool state (vitest, etc.) and the only `.cache/` flavor
// that's auto-ignored everywhere (via pnpm/npm's gitignore + the
// fleet's `**/.cache/` rule). Path constructed once.
// Cache file name mirrors the script name (`lint-github-settings`)
// + the `socket-wheelhouse-` fleet prefix so it doesn't collide with
// any other tool's cache file under node_modules/.cache/.
const CACHE_FILE = path.join(
  NODE_MODULES_CACHE_DIR,
  'socket-wheelhouse-lint-github-settings.json',
)
// 7 days in ms. Mirrors the fleet's npm catalog soak time
// (minimumReleaseAge: 10080 minutes), which is the same governing
// timeframe for "things we don't need to re-verify constantly."
const TTL_MS = 7 * 24 * 60 * 60 * 1000

export function parseFlags(): CliFlags {
  const argv = process.argv.slice(2)
  return {
    fix: argv.includes('--fix'),
    force: argv.includes('--force'),
    json: argv.includes('--json'),
  }
}

/**
 * Read a fresh cache entry, or undefined if absent/stale/malformed. Stale is
 * decided by `verifiedAt + ttl < now`. Malformed entries (parse error, missing
 * fields, wrong repo) are treated as absent — the next run will rewrite them.
 * `options.cacheFile` defaults to the real fleet cache path; a test points it
 * at a fixture file instead.
 */
export function readCache(
  repo: string,
  options?: { cacheFile?: string | undefined } | undefined,
): CacheEntry | undefined {
  const opts = { __proto__: null, ...options } as {
    cacheFile?: string | undefined
  }
  const cacheFile = opts.cacheFile ?? CACHE_FILE
  if (!existsSync(cacheFile)) {
    return undefined
  }
  let raw: string
  try {
    raw = readFileSync(cacheFile, 'utf8')
  } catch {
    return undefined
  }
  let entry: CacheEntry
  try {
    entry = JSON.parse(raw) as CacheEntry
  } catch {
    return undefined
  }
  if (entry.repo !== repo) {
    return undefined
  }
  const verifiedAt = Date.parse(entry.verifiedAt)
  if (!Number.isFinite(verifiedAt)) {
    return undefined
  }
  if (Date.now() - verifiedAt > (entry.ttl ?? TTL_MS)) {
    return undefined
  }
  return entry
}

export function writeCache(
  entry: CacheEntry,
  options?: { cacheFile?: string | undefined } | undefined,
): void {
  const opts = { __proto__: null, ...options } as {
    cacheFile?: string | undefined
  }
  const cacheFile = opts.cacheFile ?? CACHE_FILE
  const cacheDir = path.dirname(cacheFile)
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
  }
  writeFileSync(cacheFile, JSON.stringify(entry, null, 2) + '\n')
}

export function applyFixes(repo: string, findings: readonly Finding[]): number {
  const patchable = findings.filter(f => f.fixable && f.fixPatch)
  if (patchable.length === 0) {
    return 0
  }
  // Merge all PATCH bodies into one call — /repos/{owner}/{repo}
  // accepts arbitrary subsets of settings.
  const patch: Record<string, unknown> = {}
  for (let i = 0, { length } = patchable; i < length; i += 1) {
    const f = patchable[i]!
    Object.assign(patch, f.fixPatch)
  }
  process.stdout.write(
    `\n🔧 Applying ${patchable.length} fixes via PATCH /repos/${repo}:\n`,
  )
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

export function printReport(
  findings: readonly Finding[],
  repo: string,
  { json }: { json: boolean },
): void {
  if (json) {
    process.stdout.write(JSON.stringify({ repo, findings }, null, 2) + '\n')
    return
  }
  if (findings.length === 0) {
    process.stdout.write(`✓ GitHub settings audit passed for ${repo}.\n`)
    return
  }
  const errors = findings.filter(f => f.severity === 'error')
  const warns = findings.filter(f => f.severity === 'warn')
  process.stdout.write(
    `\n${repo}: ${errors.length} error(s), ${warns.length} warning(s)\n\n`,
  )
  // Errors first, then warnings — operator should fix errors before
  // worrying about warnings.
  for (const f of [...errors, ...warns]) {
    const marker = f.severity === 'error' ? '✗' : '⚠'
    process.stdout.write(`  ${marker} [${f.severity}] ${f.rule}\n`)
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
  process.stdout.write(
    `  • Commit comments must be disabled: ${settingsUrl} → General → Commits\n`,
  )
  process.stdout.write(
    `  • Copilot Memory (store/retrieve repository facts) disabled: ${settingsUrl} → Copilot → Memory\n`,
  )
  process.stdout.write(
    `  • Release immutability enabled: ${settingsUrl} → General → Releases\n`,
  )
  process.stdout.write(
    `  • Sponsorships button off: ${settingsUrl} → General → Features\n`,
  )
  process.stdout.write(
    `  • Auto-close issues with merged linked PRs ON: ${settingsUrl} → General → Pull Requests\n`,
  )
  process.stdout.write(
    `  • Single-push branch+tag update limit = 5: ${settingsUrl} → General → Pushes\n`,
  )
  process.stdout.write(
    `  • Required Actions secrets present (ANTHROPIC_API_KEY, SOCKET_API_TOKEN): ${settingsUrl}/secrets/actions\n`,
  )
}

export function main(
  options?: { cacheFile?: string | undefined } | undefined,
): number {
  const opts = { __proto__: null, ...options } as {
    cacheFile?: string | undefined
  }
  const cacheFile = opts.cacheFile ?? CACHE_FILE

  // CI bypass — settings audits are local-run only. See header comment.
  if (process.env['CI'] === 'true') {
    process.stdout.write(
      'CI=true detected; skipping GitHub settings audit (local-run only).\n',
    )
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
    const cached = readCache(repo, { cacheFile })
    if (cached?.pass) {
      const ageHours = Math.round(
        (Date.now() - Date.parse(cached.verifiedAt)) / 3_600_000,
      )
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

  // Branch protection lookup must use the repo's actual default
  // branch — a fork on a legacy `master` default would never have
  // protection on `main`. Default to 'main' when the API doesn't
  // expose it (rare).
  const defaultBranch = apiRepo.default_branch ?? 'main'
  const apiProtection = ghApi<BranchProtectionPayload>(
    `repos/${repo}/branches/${defaultBranch}/protection`,
  )
  // Union of apps actually-observed via check-suites + apps
  // declared in .github/required-apps.yml. Declared-apps are how
  // socket-trufflehog (which only posts on findings) gets credit.
  const installedApps = new Set<string>([
    ...detectInstalledApps(repo, defaultBranch),
    ...readDeclaredApps(),
  ])
  const localShadows = detectLocalShadows(repo)
  const customProps = loadCustomProperties(repo)

  let findings = evaluate(
    repo,
    apiRepo,
    apiProtection,
    installedApps,
    localShadows,
    customProps,
  )

  if (flags.fix && findings.length > 0) {
    const fixedCount = applyFixes(repo, findings)
    if (fixedCount > 0) {
      // Re-fetch + re-evaluate so the report + cache reflect post-fix
      // state. Cheap (one extra GET).
      const apiRepoAfter = ghApi<RepoApiPayload>(`repos/${repo}`)
      if (apiRepoAfter) {
        findings = evaluate(
          repo,
          apiRepoAfter,
          apiProtection,
          installedApps,
          localShadows,
          customProps,
        )
      }
    }
  }

  printReport(findings, repo, { json: flags.json })

  // Exit-status policy: only error-severity findings fail the run.
  // Warnings (custom-property downgrades, mid-remediation flags) are
  // informational — they show in the report but don't block CI or
  // the maintainer's local `pnpm run` chain. Cache the result either
  // way so the 7-day TTL is honored; the next run will re-check.
  const errors = findings.filter(f => f.severity === 'error')
  const pass = errors.length === 0
  writeCache(
    {
      verifiedAt: new Date().toISOString(),
      repo,
      pass,
      ttl: TTL_MS,
      findings,
    },
    { cacheFile },
  )

  return pass ? 0 : 1
}

if (isMainModule(import.meta.url)) {
  process.exit(main())
}
