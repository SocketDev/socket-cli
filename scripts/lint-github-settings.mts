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

import {
  loadSocketWheelhouseConfig,
  NODE_MODULES_CACHE_DIR,
  REPO_ROOT,
} from './paths.mts'

interface RepoApiPayload {
  default_branch?: string | undefined
  has_wiki?: boolean | undefined
  has_discussions?: boolean | undefined
  has_projects?: boolean | undefined
  allow_forking?: boolean | undefined
  allow_squash_merge?: boolean | undefined
  allow_merge_commit?: boolean | undefined
  allow_rebase_merge?: boolean | undefined
  allow_auto_merge?: boolean | undefined
  allow_update_branch?: boolean | undefined
  delete_branch_on_merge?: boolean | undefined
  pull_request_creation_policy?: string | undefined
  full_name?: string | undefined
  fork?: boolean | undefined
}

interface BranchProtectionPayload {
  required_signatures?: { enabled?: boolean | undefined } | undefined
}

/**
 * GitHub custom-property values for the repo, shaped as the API
 * returns: an array of `{ property_name, value }` pairs. We
 * normalize to `Record<string, string | null>` at read time.
 *
 * Recognized fleet properties:
 *   - `disable-github-actions-security` ('true' | 'false')
 *     When 'true', the fleet's branch-protection-must-require-signed-
 *     commits rule downgrades from error → warn. Rationale: the
 *     shared socket-registry setup/install action IS the security
 *     gate; per-repo branch protection is belt-and-suspenders.
 *   - `doesnt-touch-customers` ('true' | 'false')
 *     Public repos default 'false' (they DO touch customers; full
 *     fleet rules apply). Private repos not published to npm can
 *     set 'true' to opt out of customer-facing rules.
 *   - `temporarily-doesnt-touch-customers` ('true' | 'false')
 *     Escape hatch for repos mid-remediation. Always downgrades
 *     customer-facing rules to warn. Should be removed once the
 *     remediation lands.
 */
interface CustomPropertyValue {
  property_name?: string | undefined
  value?: string | null | undefined
}

type Severity = 'error' | 'warn'

interface Finding {
  rule: string
  severity: Severity
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
// Cache file name mirrors the script name (`lint-github-settings`)
// + the `socket-wheelhouse-` fleet prefix so it doesn't collide with
// any other tool's cache file under node_modules/.cache/.
const CACHE_FILE = path.join(
  NODE_MODULES_CACHE_DIR,
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
  if (!existsSync(NODE_MODULES_CACHE_DIR)) {
    mkdirSync(NODE_MODULES_CACHE_DIR, { recursive: true })
  }
  writeFileSync(CACHE_FILE, JSON.stringify(entry, null, 2) + '\n')
}

/**
 * Resolve `<owner>/<repo>` by parsing the `origin` git remote. We
 * deliberately use `origin` instead of `gh repo view` because in a
 * fork checkout (e.g. socket-packageurl-js, a fork of
 * package-url/packageurl-js), `gh repo view` returns the UPSTREAM
 * parent, not the SocketDev fork. The audit needs to inspect the
 * SocketDev fork's settings, not upstream's. The git remote is the
 * source of truth for "which repo does this checkout push to."
 */
function resolveRepo(): string | undefined {
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
 * Required GitHub Apps. We can't list installations directly without
 * `admin:org` scope, so we infer presence from recent check-run
 * activity on main HEAD. An app that's installed but inactive on
 * main may false-negative; for the fleet's hot repos this is rare.
 *
 * Alphabetical order.
 */
const REQUIRED_APP_SLUGS = ['cursor', 'socket-security', 'socket-trufflehog'] as const

interface CheckSuitesPayload {
  check_suites?: Array<{
    app?: { slug?: string }
  }>
}

/**
 * Probe app presence by listing check-SUITES (not check-runs) on
 * recent commits. Why suites and not runs:
 *   - Check-runs are only created when an app posts a finding.
 *     Apps like socket-trufflehog that only report on secrets-found
 *     don't post check-runs on clean commits — listing check-runs
 *     would false-negative.
 *   - Check-suites are created whenever an app receives the commit
 *     webhook, regardless of whether it ultimately posted a run.
 *     This is the broader signal — "did this app see the event."
 *
 * Walks the most recent 10 commits on the repo's default branch
 * (resolved at call time so forks with `main` work the same as
 * `master`-only legacy repos). Returns the union of app slugs
 * observed.
 */
/**
 * Load the repo's custom-property values. Returns
 * `{ <name>: <value or null> }`. Empty object when the API isn't
 * available or the call fails — equivalent to "no opt-outs."
 */
function loadCustomProperties(repo: string): Record<string, string | null> {
  const props = ghApi<CustomPropertyValue[]>(`repos/${repo}/properties/values`)
  if (!Array.isArray(props)) return {}
  const out: Record<string, string | null> = {}
  for (const p of props) {
    if (typeof p.property_name === 'string') {
      out[p.property_name] =
        p.value === null || typeof p.value === 'string' ? p.value : null
    }
  }
  return out
}

/**
 * Read the declared GitHub apps from this checkout's
 * `.config/socket-wheelhouse.json` (the fleet-config canon —
 * sibling of `claude`, `workspace`, `hooks` blocks). Schema:
 *
 *   {
 *     "github": {
 *       "apps": ["cursor", "socket-security", "socket-trufflehog"]
 *     }
 *   }
 *
 * Used for apps whose installation can't be reliably inferred from
 * check-suites — socket-trufflehog being the canonical example (it
 * only posts a check-suite when a secret is found, so a clean repo
 * with the app installed would false-negative under check-suites
 * detection alone).
 *
 * Audit treats apps listed here as installed (trust the manifest).
 * The maintainer's signed statement IS the install record — trust +
 * verify-once-via-eyeballs > unreliable automation.
 */
function readDeclaredApps(): Set<string> {
  const declared = new Set<string>()
  const loaded = loadSocketWheelhouseConfig(REPO_ROOT)
  if (!loaded) return declared
  const github = loaded.value['github']
  if (typeof github !== 'object' || github === null) return declared
  const apps = (github as Record<string, unknown>)['apps']
  if (Array.isArray(apps)) {
    for (const a of apps) {
      if (typeof a === 'string') declared.add(a)
    }
  }
  return declared
}

function detectInstalledApps(repo: string, defaultBranch: string): Set<string> {
  const seen = new Set<string>()
  // List of commits, not a single commit — `/commits` (plural) with
  // `sha` query for the branch ref. The singular `/commits/{ref}`
  // endpoint returns ONE commit, which is the bug shape this fixes.
  const commits = ghApi<Array<{ sha?: string }>>(
    `repos/${repo}/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=10`,
  )
  for (const c of commits ?? []) {
    if (!c.sha) continue
    const suites = ghApi<CheckSuitesPayload>(
      `repos/${repo}/commits/${c.sha}/check-suites?per_page=100`,
    )
    for (const s of suites?.check_suites ?? []) {
      if (s.app?.slug) seen.add(s.app.slug)
    }
    if (seen.size >= REQUIRED_APP_SLUGS.length) break
  }
  return seen
}

interface WorkflowsPayload {
  workflows?: Array<{
    name?: string | undefined
    path?: string | undefined
    state?: string | undefined
  }> | undefined
}

/**
 * Names of canonical shared workflows hosted in socket-registry.
 * When a fleet repo has a local workflow file whose path basename
 * matches one of these AND the workflow body doesn't `uses:` the
 * shared variant AND doesn't carry the explicit opt-out marker,
 * that's drift.
 *
 * Two exemption shapes:
 *   1. `_local-not-for-reuse-*` filename prefix — the
 *      socket-registry convention for local triggers that consume a
 *      shared workflow. The file IS the right shape.
 *   2. `# socket-wheelhouse-shadow-allow: <reason>` header line —
 *      maintainer's explicit, audit-able commitment that the local
 *      workflow inlines logic by design (e.g. socket-cli's
 *      provenance.yml does CLI-specific multi-package release
 *      orchestration that doesn't fit the generic shared shape).
 *      The comment text serves as the documented reason.
 */
const SHARED_WORKFLOW_BASENAMES = [
  'build.yml',
  'install.yml',
  'lint.yml',
  'provenance.yml',
  'release.yml',
  'setup.yml',
  'test.yml',
] as const

function detectLocalShadows(
  repo: string,
): Array<{ basename: string; localPath: string }> {
  const out: Array<{ basename: string; localPath: string }> = []
  const wf = ghApi<WorkflowsPayload>(`repos/${repo}/actions/workflows?per_page=100`)
  if (!wf?.workflows) return out
  for (const w of wf.workflows) {
    if (!w.path || !w.path.startsWith('.github/workflows/')) continue
    const basename = w.path.slice('.github/workflows/'.length)
    if (basename.startsWith('_local-not-for-reuse-')) continue
    if (!SHARED_WORKFLOW_BASENAMES.includes(basename as typeof SHARED_WORKFLOW_BASENAMES[number])) continue
    const r = spawnSync(
      'gh',
      ['api', `repos/${repo}/contents/${w.path}`],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    if (r.status !== 0) continue
    let bodyRaw: string
    try {
      const obj = JSON.parse(r.stdout) as { content?: string; encoding?: string }
      if (obj.encoding !== 'base64' || !obj.content) continue
      bodyRaw = Buffer.from(obj.content, 'base64').toString('utf8')
    } catch {
      continue
    }
    // Exemption 1: delegates to the shared workflow via `uses:`.
    if (/uses:\s*SocketDev\/socket-registry\/\.github\/workflows\//.test(bodyRaw)) {
      continue
    }
    // Exemption 2: explicit opt-out comment. Single unified fleet
    // marker `socket-bypass: <name>` (one prefix for hooks, custom
    // lints, audits — fewer prefixes to remember).
    //   # socket-bypass: workflow-shadow -- <reason>
    // Free-text reason after `--` is encouraged but not parsed;
    // maintainer accountability via git blame.
    if (/^#\s*socket-bypass:\s*workflow-shadow\b/m.test(bodyRaw)) {
      continue
    }
    out.push({ basename, localPath: w.path })
  }
  return out
}

/**
 * Canonical fleet config. Each rule names the API field, expected
 * value, and the fix URL. `fixPatch` is the body to send to PATCH
 * /repos/{owner}/{repo} when --fix is given (undefined = manual fix
 * required, no API endpoint yet).
 */
/**
 * Custom-property opt-out knobs that downgrade specific rules from
 * 'error' to 'warn'. Reading the property values is one API call per
 * audit (see `loadCustomProperties`).
 *
 * Why warn-not-skip: a maintainer marking a repo
 * `temporarily-doesnt-touch-customers: true` should still see a
 * reminder of what's deferred — silencing the finding entirely
 * would mean the eventual lift forgets the reminder existed. Warn
 * = visible-but-not-CI-blocking.
 */
function severityOverride(
  ruleKey: string,
  props: Record<string, string | null>,
): Severity {
  const disableGhAS = props['disable-github-actions-security'] === 'true'
  const doesntTouchCustomers = props['doesnt-touch-customers'] === 'true'
  const tempDoesntTouchCustomers =
    props['temporarily-doesnt-touch-customers'] === 'true'

  // The shared socket-registry setup/install IS the security gate;
  // per-repo branch protection is belt-and-suspenders. When the
  // maintainer has explicitly opted out of redundant GH Actions
  // security, downgrade branch-protection findings to warn.
  if (
    disableGhAS &&
    (ruleKey === 'branch-protection-exists' ||
      ruleKey === 'branch-protection-required-signatures')
  ) {
    return 'warn'
  }

  // Customer-facing rules: only enforce on repos that DO touch
  // customers. Private/unpublished or in-remediation repos get
  // warnings instead of errors so the maintainer sees the reminder
  // without CI red.
  const customerFacingRules = new Set([
    'has_wiki must be false',
    'has_discussions must be false',
    'has_projects must be false',
    'pull_request_creation_policy must be collaborators_only',
  ])
  if (
    (doesntTouchCustomers || tempDoesntTouchCustomers) &&
    customerFacingRules.has(ruleKey)
  ) {
    return 'warn'
  }

  return 'error'
}

function evaluate(
  repo: string,
  apiRepo: RepoApiPayload,
  apiProtection: BranchProtectionPayload | undefined,
  installedApps: Set<string>,
  localShadows: ReadonlyArray<{ basename: string; localPath: string }>,
  customProps: Record<string, string | null>,
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
      severity: severityOverride(rule, customProps),
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
  // Note: `allow_forking` is intentionally NOT checked. The actual
  // "no outside-contributor PRs" gate is `pull_request_creation_
  // policy: collaborators_only` (checked below). Letting people fork
  // for read access / personal-use is the open-source default and
  // doesn't bypass PR review.
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
      severity: severityOverride('branch-protection-exists', customProps),
      current: undefined,
      expected: '{ required_signatures: { enabled: true } }',
      fixUrl: branchesUrl,
      fixable: false,
    })
  } else if (apiProtection.required_signatures?.enabled !== true) {
    findings.push({
      rule: 'main branch protection: required_signatures must be enabled',
      severity: severityOverride('branch-protection-required-signatures', customProps),
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

  // Required apps. Each missing app gets one finding with the install URL.
  for (const slug of REQUIRED_APP_SLUGS) {
    if (!installedApps.has(slug)) {
      findings.push({
        rule: `GitHub App must be installed: ${slug}`,
        // App findings stay 'error' regardless of custom properties —
        // app installation is universal. (Could be made overridable
        // per-property if a use case emerges.)
        severity: 'error',
        current: 'not detected on recent check-suites or declared in .github/required-apps.yml',
        expected: 'installed + declared',
        fixUrl: `https://github.com/apps/${slug}`,
        fixable: false,
      })
    }
  }

  // Local shadows of shared workflows. Either delete the local file
  // (and `uses:` the shared one), or add the explicit opt-out header
  // `# socket-wheelhouse-shadow-allow: <reason>` documenting why the
  // local version is intentional.
  for (const shadow of localShadows) {
    findings.push({
      rule: `Local workflow shadows a shared one: ${shadow.basename}`,
      severity: 'error',
      current: shadow.localPath,
      expected:
        `uses: SocketDev/socket-registry/.github/workflows/${shadow.basename}@<sha> ` +
        `OR add a header comment '# socket-bypass: workflow-shadow -- <reason>' ` +
        `to document why this local workflow is intentional`,
      fixUrl: `https://github.com/${repo}/blob/${apiRepo.default_branch ?? 'main'}/${shadow.localPath}`,
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

  printReport(findings, repo, flags.json)

  // Exit-status policy: only error-severity findings fail the run.
  // Warnings (custom-property downgrades, mid-remediation flags) are
  // informational — they show in the report but don't block CI or
  // the maintainer's local `pnpm run` chain. Cache the result either
  // way so the 7-day TTL is honored; the next run will re-check.
  const errors = findings.filter(f => f.severity === 'error')
  const pass = errors.length === 0
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
