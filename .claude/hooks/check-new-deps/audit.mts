/**
 * Audit logging + slopsquatting (Threat 2.2) tracking for the
 * check-new-deps hook.
 *
 * Two responsibilities, co-located because they share end-of-hook
 * timing:
 *
 *   1. Audit log — append one JSONL record per checked package to
 *      `~/.claude/audit/check-new-deps.jsonl`. The log is LOCAL ONLY:
 *      no outbound channel, no network. Private package names never
 *      leave the developer's machine via this log.
 *
 *   2. 404 tracking — when a PURL returns "not found" from the
 *      firewall API, bump a persistent cacache-backed TTL counter.
 *      After NOT_FOUND_THRESHOLD attempts on the same nonexistent
 *      package, surface a warning with a "did you mean" suggestion.
 *      The cache survives across sessions and processes so attackers
 *      can't shake the counter by triggering a new session.
 *
 * Failure mode: everything here is best-effort. A disk-full / EACCES
 * audit-log failure or a corrupt cacache entry must NEVER change the
 * verdict the hook returns. All write paths are wrapped in try/catch
 * that logs to stderr and continues.
 */

import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { stringify } from '@socketregistry/packageurl-js-stable'
import type { PackageURL } from '@socketregistry/packageurl-js-stable'
import { createTtlCache } from '@socketsecurity/lib-stable/cache-with-ttl'
import type { TtlCache } from '@socketsecurity/lib-stable/cache-with-ttl'
import { errorMessage } from '@socketsecurity/lib-stable/errors'

import type {
  AuditRecord,
  BatchOutcome,
  CheckResult,
  Dep,
  HookInput,
  NotFoundEntry,
  Verdict,
} from './types.mts'

// How long (ms) we remember that a package didn't exist (7 days).
// Long enough to survive a typical AI hallucination cycle; short enough
// that a newly-registered legitimate name eventually clears.
const NOT_FOUND_CACHE_TTL = 7 * 24 * 60 * 60 * 1_000
// Repeated 404s on the same package before we surface a slopsquatting
// warning. One miss is a typo; three is a pattern worth flagging.
const NOT_FOUND_THRESHOLD = 3
// Where the audit log lives. Single file, append-only JSONL. Local
// only — never read by the hook, only written.
const AUDIT_LOG_DIR = path.join(os.homedir(), '.claude', 'audit')
const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, 'check-new-deps.jsonl')

// Persistent 404 counter — keyed by canonical PURL identity
// (`{type}/{namespace?}/{name}`, version stripped so attackers can't
// shake the counter by appending random version specifiers). Lazily
// built because createTtlCache touches cacache on disk and we don't
// want that work in the hot path when no 404s occur.
let notFoundCache: TtlCache | undefined
function getNotFoundCache(): TtlCache {
  if (!notFoundCache) {
    notFoundCache = createTtlCache({
      prefix: 'check-new-deps-404',
      ttl: NOT_FOUND_CACHE_TTL,
    })
  }
  return notFoundCache
}

// Compute the canonical "{type}/{namespace?}{name}" identity. Version
// is dropped on purpose: an attacker can request the same fake name
// at a hundred bogus versions and we want one warning, not a hundred.
function depIdentity(dep: Dep): string {
  return dep.namespace
    ? `${dep.type}/${dep.namespace}/${dep.name}`
    : `${dep.type}/${dep.name}`
}

// Inverse of depIdentity for purposes of resolving a PURL back to a
// `{type, namespace, name}` triple. We need this when we have to
// surface a 404 warning and the only thing we kept around is the PURL.
function depFromPurl(
  purl: string,
): { type: string; namespace?: string; name: string } | undefined {
  // PURL shape: pkg:type/[namespace/]name[@version]
  if (!purl.startsWith('pkg:')) return undefined
  const noScheme = purl.slice(4)
  const atIdx = noScheme.indexOf('@')
  const versionless = atIdx === -1 ? noScheme : noScheme.slice(0, atIdx)
  const slashIdx = versionless.indexOf('/')
  if (slashIdx === -1) return undefined
  const type = versionless.slice(0, slashIdx)
  const rest = versionless.slice(slashIdx + 1)
  const lastSlash = rest.lastIndexOf('/')
  if (lastSlash === -1) {
    return { type, name: rest }
  }
  return {
    type,
    namespace: rest.slice(0, lastSlash),
    name: rest.slice(lastSlash + 1),
  }
}

// Pull the session id from Claude Code's transcript_path. The basename
// is a UUID like "abc1234.jsonl"; we strip the extension so audit
// consumers can join across hook invocations on a clean session id.
function deriveSessionId(hook: HookInput): string | undefined {
  if (hook.session_id) return hook.session_id
  if (!hook.transcript_path) return undefined
  const base = path.basename(hook.transcript_path)
  const dotIdx = base.lastIndexOf('.')
  return dotIdx === -1 ? base : base.slice(0, dotIdx)
}

// One audit record per dep, written before we surface 404 warnings so
// the log is the source of truth even when the cache write below fails.
function buildAuditRecords(
  hook: HookInput,
  deps: Dep[],
  outcome: BatchOutcome,
): AuditRecord[] {
  const session = deriveSessionId(hook)
  const repo = path.basename(process.cwd())
  const ts = Date.now()
  const blockedByPurl = new Map<string, CheckResult>()
  for (const b of outcome.blocked) blockedByPurl.set(b.purl, b)

  const records: AuditRecord[] = []
  for (const dep of deps) {
    const purl = stringify(dep as unknown as PackageURL)
    const blockedHit = blockedByPurl.get(purl)
    let verdict: Verdict
    let reason: string | undefined
    if (blockedHit) {
      verdict = 'block'
      reason = blockedHit.reason
    } else if (outcome.notFound.has(purl)) {
      verdict = 'notfound'
    } else if (outcome.ok.has(purl)) {
      verdict = 'allow'
    } else {
      // API failed, dep wasn't in the response at all — record as
      // 'unknown' rather than fabricating an allow.
      verdict = 'unknown'
    }
    records.push({
      ts,
      repo,
      type: dep.type,
      name: dep.name,
      namespace: dep.namespace,
      version: dep.version,
      verdict,
      reason,
      session,
    })
  }
  return records
}

// Append every record as one JSONL line. On POSIX `fs.appendFile` is
// atomic for writes < PIPE_BUF (4 KiB) — our records are well under
// that. The whole function is wrapped to swallow disk-full / EACCES.
async function appendAuditRecords(records: AuditRecord[]): Promise<void> {
  if (!records.length) return
  try {
    await fsp.mkdir(AUDIT_LOG_DIR, { recursive: true })
    // Join into one write so the OS only sees one append syscall per
    // hook invocation. (Multiple appendFile calls would each be
    // atomic individually but they can interleave with other agents.)
    const body = records.map(r => JSON.stringify(r)).join('\n') + '\n'
    await fsp.appendFile(AUDIT_LOG_FILE, body, { encoding: 'utf8' })
  } catch (e) {
    // Audit is best-effort. Don't ever break the verdict over a log
    // write failure.
    process.stderr.write(
      `[check-new-deps] audit log write failed: ${errorMessage(e)}\n`,
    )
  }
}

// Bump the persistent 404 counter for every PURL that came back as
// "not found". Surfaces a warning when a single fake package has been
// requested NOT_FOUND_THRESHOLD or more times. Returns the list of
// PURLs that crossed the threshold this call — the caller writes
// the warning to stderr.
async function bumpNotFoundCounters(notFound: Set<string>): Promise<string[]> {
  if (!notFound.size) return []
  const crossed: string[] = []
  let cache: TtlCache
  try {
    cache = getNotFoundCache()
  } catch (e) {
    process.stderr.write(
      `[check-new-deps] 404-cache init failed: ${errorMessage(e)}\n`,
    )
    return []
  }
  for (const purl of notFound) {
    const dep = depFromPurl(purl)
    if (!dep) continue
    const key = depIdentity({
      type: dep.type,
      name: dep.name,
      namespace: dep.namespace,
    })
    try {
      const prev = await cache.get<NotFoundEntry>(key)
      const now = Date.now()
      const next: NotFoundEntry = prev
        ? {
            count: prev.count + 1,
            firstSeenAt: prev.firstSeenAt,
            lastSeenAt: now,
          }
        : { count: 1, firstSeenAt: now, lastSeenAt: now }
      await cache.set(key, next)
      // First-time-over-threshold check: we want one warning per
      // crossing, not one per request after.
      const wasUnderThreshold =
        prev === undefined || prev.count < NOT_FOUND_THRESHOLD
      if (next.count >= NOT_FOUND_THRESHOLD && wasUnderThreshold) {
        crossed.push(purl)
      }
    } catch (e) {
      // Per-key failure shouldn't kill the rest of the batch.
      process.stderr.write(
        `[check-new-deps] 404-cache write failed for ${key}: ${errorMessage(e)}\n`,
      )
    }
  }
  return crossed
}

// Short, curated "did you mean" hint for common ecosystems where AI
// agents tend to hallucinate names. Levenshtein distance against a
// small allowlist — no external dep, no network. The list is
// deliberately narrow: better to give one strong suggestion or none
// than a noisy fuzzy match. Add new entries when a repeat 404 lands.
const KNOWN_GOOD_NAMES: Record<string, string[]> = {
  __proto__: null as unknown as string[],
  npm: [
    'react',
    'react-dom',
    'next',
    'vite',
    'webpack',
    'rollup',
    'esbuild',
    'typescript',
    'lodash',
    'express',
    'fastify',
    'koa',
    'axios',
    'eslint',
    'prettier',
    'vitest',
    'jest',
    'mocha',
    'chai',
    'sinon',
    'zod',
    'yup',
    'commander',
    'yargs',
    'chalk',
    'debug',
    'glob',
  ],
  pypi: [
    'requests',
    'urllib3',
    'numpy',
    'pandas',
    'scipy',
    'matplotlib',
    'flask',
    'django',
    'fastapi',
    'pydantic',
    'sqlalchemy',
    'celery',
    'pytest',
    'tox',
    'black',
    'ruff',
    'mypy',
    'click',
    'rich',
  ],
  cargo: [
    'serde',
    'serde_json',
    'tokio',
    'reqwest',
    'clap',
    'anyhow',
    'thiserror',
    'tracing',
    'rayon',
    'regex',
  ],
  gem: ['rails', 'rspec', 'sinatra', 'puma', 'rake', 'devise', 'sidekiq'],
}

// Suggest the nearest known-good name for `bad` within `ecosystem`,
// or undefined if nothing is close enough. Distance <= 2 is the
// heuristic — that catches "expres" → "express" and "loadash" →
// "lodash" without firing on "totally-fake".
function suggestSimilarName(
  ecosystem: string,
  bad: string,
): string | undefined {
  const candidates = KNOWN_GOOD_NAMES[ecosystem]
  if (!candidates) return undefined
  const target = bad.toLowerCase()
  let best: { name: string; dist: number } | undefined
  for (const c of candidates) {
    const d = levenshtein(target, c.toLowerCase())
    if (d <= 2 && (!best || d < best.dist)) {
      best = { name: c, dist: d }
    }
  }
  return best?.name
}

// Iterative Levenshtein with a single rolling row. We bail early
// once the running min in the row exceeds 2, since that's our cap.
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const aLen = a.length
  const bLen = b.length
  // Eager length-difference prune: if |a|-|b| > 2 the answer is > 2.
  if (Math.abs(aLen - bLen) > 2) return Math.abs(aLen - bLen)
  let prev = new Array<number>(bLen + 1)
  let curr = new Array<number>(bLen + 1)
  for (let j = 0; j <= bLen; j++) prev[j] = j
  for (let i = 1; i <= aLen; i++) {
    curr[0] = i
    let rowMin = curr[0]!
    const ai = a.charCodeAt(i - 1)
    for (let j = 1; j <= bLen; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1
      const del = prev[j]! + 1
      const ins = curr[j - 1]! + 1
      const sub = prev[j - 1]! + cost
      const v = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub
      curr[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > 2) return rowMin
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[bLen]!
}

// End-of-hook accounting: write the audit log, bump the persistent
// 404 cache, and surface a slopsquatting warning when any PURL has
// crossed the threshold on this invocation.
async function recordCheckOutcome(
  hook: HookInput,
  deps: Dep[],
  outcome: BatchOutcome,
): Promise<void> {
  try {
    const records = buildAuditRecords(hook, deps, outcome)
    await appendAuditRecords(records)
  } catch (e) {
    // Build / append both wrapped; the outer catch is defense in
    // depth against a bug in buildAuditRecords itself.
    process.stderr.write(
      `[check-new-deps] audit record build failed: ${errorMessage(e)}\n`,
    )
  }
  try {
    const crossed = await bumpNotFoundCounters(outcome.notFound)
    for (const purl of crossed) {
      const dep = depFromPurl(purl)
      if (!dep) continue
      const suggestion = suggestSimilarName(dep.type, dep.name)
      const hint = suggestion ? ` (did you mean "${suggestion}"?)` : ''
      process.stderr.write(
        `[check-new-deps] warning: package "${dep.name}" ` +
          `(${dep.type}) has been requested ${NOT_FOUND_THRESHOLD}+ ` +
          `times and does not exist on the Socket.dev registry — ` +
          `possible AI-hallucinated name${hint}.\n`,
      )
    }
  } catch (e) {
    process.stderr.write(
      `[check-new-deps] 404 accounting failed: ${errorMessage(e)}\n`,
    )
  }
}

export {
  AUDIT_LOG_FILE,
  appendAuditRecords,
  buildAuditRecords,
  bumpNotFoundCounters,
  depFromPurl,
  depIdentity,
  deriveSessionId,
  getNotFoundCache,
  levenshtein,
  NOT_FOUND_THRESHOLD,
  recordCheckOutcome,
  suggestSimilarName,
}
