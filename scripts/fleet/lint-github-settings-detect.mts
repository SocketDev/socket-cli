/**
 * @file GitHub-API detection helpers backing `lint-github-settings.mts`'s
 *   audit: repo config loading, `gh api` wrapper, and the app / workflow
 *   presence probes. Split out to keep each file in the split under the
 *   500-line soft cap.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { REPO_ROOT } from './paths.mts'
import {
  REQUIRED_APP_SLUGS,
  SHARED_WORKFLOW_BASENAMES,
} from './lint-github-settings-types.mts'
import type {
  CheckSuitesPayload,
  CustomPropertyValue,
  WorkflowsPayload,
} from './lint-github-settings-types.mts'

// Inline path + config-loader equivalents of the wheelhouse template's
// paths.mts helpers. `lint-github-settings.mts` cascades into fleet
// repos whose per-package `paths.mts` is intentionally minimal
// (`socket-cli`, `ultrathink`, etc. only export REPO_ROOT +
// package-specific build paths). Importing `NODE_MODULES_CACHE_DIR` /
// `loadSocketWheelhouseConfig` from `./paths.mts` would force every
// consumer to widen their paths.mts surface — wrong direction. Keep
// the per-package paths.mts narrow; carry the standalone helpers here.
const SOCKET_WHEELHOUSE_CONFIG_PRIMARY_REL = '.config/socket-wheelhouse.json'
const SOCKET_WHEELHOUSE_CONFIG_LEGACY_REL = '.socket-wheelhouse.json'

interface LoadedSocketWheelhouseConfig {
  readonly value: Record<string, unknown>
}

function loadSocketWheelhouseConfig(
  repoRoot: string,
): LoadedSocketWheelhouseConfig | undefined {
  const primary = path.join(repoRoot, SOCKET_WHEELHOUSE_CONFIG_PRIMARY_REL)
  const legacy = path.join(repoRoot, SOCKET_WHEELHOUSE_CONFIG_LEGACY_REL)
  const target = existsSync(primary)
    ? primary
    : existsSync(legacy)
      ? legacy
      : undefined
  if (!target) {
    return undefined
  }
  let raw: string
  try {
    raw = readFileSync(target, 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined
  }
  return { value: parsed as Record<string, unknown> }
}

/**
 * Resolve `<owner>/<repo>` by parsing the `origin` git remote. We deliberately
 * use `origin` instead of `gh repo view` because in a fork checkout (e.g.
 * socket-packageurl-js, a fork of package-url/packageurl-js), `gh repo view`
 * returns the UPSTREAM parent, not the SocketDev fork. The audit needs to
 * inspect the SocketDev fork's settings, not upstream's. The git remote is the
 * source of truth for "which repo does this checkout push to."
 */
export function resolveRepo(): string | undefined {
  const remote = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
    cwd: REPO_ROOT,
  })
  if (remote.status !== 0) {
    return undefined
  }
  const url = String(remote.stdout).trim()
  // Match `git@github.com:owner/repo[.git]` or
  // `https://github.com/owner/repo[.git]`.
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url)
  if (!m) {
    return undefined
  }
  return `${m[1]}/${m[2]}`
}

/**
 * Thin wrapper around `gh api`. Returns JSON-parsed body on success or
 * undefined on any error. The caller decides whether undefined is an
 * audit-failing condition or a soft skip.
 */
export function ghApi<T>(
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
  const r = spawnSync('gh', args, {})
  if (r.status !== 0) {
    if (process.env['DEBUG']) {
      process.stderr.write(`gh ${args.join(' ')} failed: ${r.stderr}\n`)
    }
    return undefined
  }
  if (!String(r.stdout).trim()) {
    return undefined as unknown as T
  }
  try {
    return JSON.parse(String(r.stdout)) as T
  } catch {
    return undefined
  }
}

/**
 * Load the repo's custom-property values. Returns `{ <name>: <value or null>
 * }`. Empty object when the API isn't available or the call fails — equivalent
 * to "no opt-outs."
 */
export function loadCustomProperties(
  repo: string,
): Record<string, string | null> {
  const props = ghApi<CustomPropertyValue[]>(`repos/${repo}/properties/values`)
  if (!Array.isArray(props)) {
    return {}
  }
  const out: Record<string, string | null> = {}
  for (let i = 0, { length } = props; i < length; i += 1) {
    const p = props[i]!
    if (typeof p.property_name === 'string') {
      if (p.value === null || typeof p.value === 'string') {
        out[p.property_name] = p.value
      }
    }
  }
  return out
}

/**
 * Read the declared GitHub apps from this checkout's
 * `.config/socket-wheelhouse.json` (the fleet-config canon — sibling of
 * `claude`, `workspace`, `hooks` blocks). Schema:
 *
 * { "github": { "apps": ["cursor", "socket-security", "socket-trufflehog"] } }
 *
 * Used for apps whose installation can't be reliably inferred from check-suites
 * — socket-trufflehog being the canonical example (it only posts a check-suite
 * when a secret is found, so a clean repo with the app installed would
 * false-negative under check-suites detection alone).
 *
 * Audit treats apps listed here as installed (trust the manifest). The
 * maintainer's signed statement IS the install record — trust +
 * verify-once-via-eyeballs > unreliable automation.
 */
export function readDeclaredApps(): Set<string> {
  const declared = new Set<string>()
  const loaded = loadSocketWheelhouseConfig(REPO_ROOT)
  if (!loaded) {
    return declared
  }
  const github = loaded.value['github']
  if (typeof github !== 'object' || github === null) {
    return declared
  }
  const apps = (github as Record<string, unknown>)['apps']
  if (Array.isArray(apps)) {
    for (let i = 0, { length } = apps; i < length; i += 1) {
      const a = apps[i]!
      if (typeof a === 'string') {
        declared.add(a)
      }
    }
  }
  return declared
}

/**
 * Probe app presence by listing check-SUITES (not check-runs) on recent
 * commits. Why suites and not runs: - Check-runs are only created when an app
 * posts a finding. Apps like socket-trufflehog that only report on
 * secrets-found don't post check-runs on clean commits — listing check-runs
 * would false-negative. - Check-suites are created whenever an app receives the
 * commit webhook, regardless of whether it ultimately posted a run. This is the
 * broader signal — "did this app see the event."
 *
 * Walks the most recent 10 commits on the repo's default branch (resolved at
 * call time so forks with `main` work the same as `master`-only legacy repos).
 * Returns the union of app slugs observed.
 */
export function detectInstalledApps(
  repo: string,
  defaultBranch: string,
): Set<string> {
  const seen = new Set<string>()
  // List of commits, not a single commit — `/commits` (plural) with
  // `sha` query for the branch ref. The singular `/commits/{ref}`
  // endpoint returns ONE commit, which is the bug shape this fixes.
  const commits = ghApi<Array<{ sha?: string | undefined }>>(
    `repos/${repo}/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=10`,
  )
  for (const c of commits ?? []) {
    if (!c.sha) {
      continue
    }
    const suites = ghApi<CheckSuitesPayload>(
      `repos/${repo}/commits/${c.sha}/check-suites?per_page=100`,
    )
    for (const s of suites?.check_suites ?? []) {
      if (s.app?.slug) {
        seen.add(s.app.slug)
      }
    }
    if (seen.size >= REQUIRED_APP_SLUGS.length) {
      break
    }
  }
  return seen
}

export function detectLocalShadows(
  repo: string,
): Array<{ basename: string; localPath: string }> {
  const out: Array<{ basename: string; localPath: string }> = []
  const wf = ghApi<WorkflowsPayload>(
    `repos/${repo}/actions/workflows?per_page=100`,
  )
  if (!wf?.workflows) {
    return out
  }
  for (const w of wf.workflows) {
    if (!w.path || !w.path.startsWith('.github/workflows/')) {
      continue
    }
    const basename = w.path.slice('.github/workflows/'.length)
    if (basename.startsWith('_local-not-for-reuse-')) {
      continue
    }
    if (
      !SHARED_WORKFLOW_BASENAMES.includes(
        basename as (typeof SHARED_WORKFLOW_BASENAMES)[number],
      )
    ) {
      continue
    }
    const r = spawnSync('gh', ['api', `repos/${repo}/contents/${w.path}`], {
      cwd: REPO_ROOT,
    })
    if (r.status !== 0) {
      continue
    }
    let bodyRaw: string
    try {
      const obj = JSON.parse(String(r.stdout)) as {
        content?: string | undefined
        encoding?: string | undefined
      }
      if (obj.encoding !== 'base64' || !obj.content) {
        continue
      }
      bodyRaw = Buffer.from(obj.content, 'base64').toString('utf8')
    } catch {
      continue
    }
    // Exemption 1: delegates to the shared workflow via `uses:`.
    if (
      /uses:\s*SocketDev\/socket-registry\/\.github\/workflows\//.test(bodyRaw)
    ) {
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
