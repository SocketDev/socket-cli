/**
 * @file Soak-aware Go-module update runner for the fleet. Ports + improves the
 *   gate logic from fchimpan/gomod-age: gomod-age only FLAGS deps younger than
 *   a minimum age; this runner also RESOLVES the newest soak-cleared version so
 *   `--fix` can plan a `go get module@<version>` that is guaranteed past the
 *   trust soak. The soak window is never a version younger than `soakDays` — a
 *   caller-supplied trust gate, never hardcoded (the orchestrator passes the
 *   fleet soak). Queries follow Go's GOPROXY protocol (comma = fall through on
 *   404/410, pipe = fall through on any error, `direct`/`off` handled). `main`
 *   is a DRY planner: it prints the `go get` commands but never invokes the go
 *   toolchain — the actual apply is a separate step behind a real toolchain +
 *   network. All network goes through socket-lib's `httpRequest` (the fleet
 *   "never bare `fetch()`" rule); every top-level function + type is exported
 *   so the unit tests can drive each piece with nock and no real network.
 */

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { httpRequest } from '@socketsecurity/lib-stable/http-request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { rcompare, valid } from 'semver'

import { findOwnFiles, requireSoakDays } from './_shared.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const DAY_MS = 86_400_000

const DEFAULT_GOPROXY = 'https://proxy.golang.org,direct'

/**
 * A single entry in the parsed GOPROXY chain. `url` is empty for a `direct`
 * entry. `fallbackAll` is true when the entry was separated from the previous
 * one by `|` (fall through on ANY error) rather than `,` (fall through only on
 * 404/410).
 */
export interface ProxyEntry {
  fallbackAll: boolean
  isDirect: boolean
  url: string
}

/**
 * A parsed `require` directive: the module path and its version.
 */
export interface GoModule {
  module: string
  version: string
}

/**
 * A soak violation: a dependency published more recently than `soakMs` ago.
 */
export interface Violation {
  ageMs: number
  module: string
  publishTime: Date
  remainingMs: number
  soakMs: number
  version: string
}

/**
 * Error carrying the HTTP status of a failed proxy query so the GOPROXY chain
 * can decide whether to fall through (404/410) or stop (other statuses).
 */
export class ProxyStatusError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'ProxyStatusError'
    this.statusCode = statusCode
  }
}

/**
 * Go module-path / version escaping for proxy URLs: every uppercase letter `X`
 * becomes `!x` (a bang followed by the lowercase letter), so a case-insensitive
 * filesystem can't collide two module paths. Non-letters pass through.
 */
export function escapeModulePath(p: string): string {
  let out = ''
  for (const ch of p) {
    const lower = ch.toLowerCase()
    if (ch !== lower && ch === ch.toUpperCase()) {
      out += `!${lower}`
    } else {
      out += ch
    }
  }
  return out
}

/**
 * Parse a GOPROXY value into an ordered chain of entries. Defaults to
 * `https://proxy.golang.org,direct` when unset/empty. `,` marks a
 * 404/410-only fall-through, `|` marks an any-error fall-through, `direct`
 * becomes an `isDirect` entry (no `.info` fetch is possible), and `off` stops
 * the chain. Trailing slashes on a proxy URL are trimmed.
 */
export function parseGoProxyChain(goproxy: string | undefined): ProxyEntry[] {
  const raw =
    goproxy === undefined || goproxy === '' ? DEFAULT_GOPROXY : goproxy
  const entries: ProxyEntry[] = []
  let remaining = raw
  while (remaining !== '') {
    const commaIdx = remaining.indexOf(',')
    const pipeIdx = remaining.indexOf('|')
    let token: string
    let fallbackAll = false
    if (commaIdx < 0 && pipeIdx < 0) {
      token = remaining
      remaining = ''
    } else if (pipeIdx >= 0 && (commaIdx < 0 || pipeIdx < commaIdx)) {
      token = remaining.slice(0, pipeIdx)
      remaining = remaining.slice(pipeIdx + 1)
      fallbackAll = true
    } else {
      token = remaining.slice(0, commaIdx)
      remaining = remaining.slice(commaIdx + 1)
    }
    token = token.trim()
    if (token === '') {
      continue
    }
    if (token === 'off') {
      break
    }
    if (token === 'direct') {
      entries.push({ fallbackAll, isDirect: true, url: '' })
      continue
    }
    entries.push({
      fallbackAll,
      isDirect: false,
      url: token.replace(/\/+$/, ''),
    })
  }
  return entries
}

/**
 * Whether an error is a 404/410 proxy miss (a `,`-fall-through trigger).
 */
export function isNotFound(error: unknown): boolean {
  return (
    error instanceof ProxyStatusError &&
    (error.statusCode === 404 || error.statusCode === 410)
  )
}

/**
 * GET `<proxyBase>/<esc-module>/@v/<esc-version>.info` from a single proxy and
 * return the publish `Time` as a `Date`. Throws `ProxyStatusError` on a non-2xx
 * status (so the chain can decide fall-through) and a plain `Error` on a
 * missing/invalid `Time`.
 */
export async function fetchVersionTime(
  proxyBase: string,
  modulePath: string,
  version: string,
): Promise<Date> {
  const base = proxyBase.replace(/\/+$/, '')
  const url = `${base}/${escapeModulePath(modulePath)}/@v/${escapeModulePath(version)}.info`
  const res = await httpRequest(url, { timeout: 30_000 })
  if (!res.ok) {
    throw new ProxyStatusError(
      res.status,
      `proxy ${base} returned ${res.status} for ${modulePath}@${version}`,
    )
  }
  const info = res.json<{ Time?: string; Version?: string }>()
  if (!info || typeof info.Time !== 'string' || info.Time === '') {
    throw new Error(
      `proxy ${base} returned no publish time for ${modulePath}@${version}`,
    )
  }
  const time = new Date(info.Time)
  if (Number.isNaN(time.getTime())) {
    throw new Error(
      `proxy ${base} returned an unparseable time "${info.Time}" for ${modulePath}@${version}`,
    )
  }
  return time
}

/**
 * Resolve a version's publish time by walking a GOPROXY chain. `,` entries fall
 * through only on 404/410, `|` entries fall through on any error, `direct`
 * entries are skipped (a `.info` cannot be fetched over VCS). `fetchOne` is
 * injectable for tests; it defaults to `fetchVersionTime`.
 */
export async function fetchVersionTimeWithFallback(
  entries: ProxyEntry[],
  modulePath: string,
  version: string,
  fetchOne: (
    proxyBase: string,
    modulePath: string,
    version: string,
  ) => Promise<Date> = fetchVersionTime,
): Promise<Date> {
  let lastErr: unknown
  for (const entry of entries) {
    if (entry.isDirect) {
      lastErr = new Error(
        `module ${modulePath}@${version} requires direct VCS access (no proxy)`,
      )
      continue
    }
    try {
      return await fetchOne(entry.url, modulePath, version)
    } catch (e) {
      lastErr = e
      if (entry.fallbackAll || isNotFound(e)) {
        continue
      }
      throw e
    }
  }
  throw (
    (lastErr as Error | undefined) ??
    new Error(`no proxy configured for ${modulePath}@${version}`)
  )
}

/**
 * GET `<proxyBase>/<esc-module>/@v/list` and return the newline-separated
 * version list (blank lines dropped).
 */
export async function listVersions(
  proxyBase: string,
  modulePath: string,
): Promise<string[]> {
  const base = proxyBase.replace(/\/+$/, '')
  const url = `${base}/${escapeModulePath(modulePath)}/@v/list`
  const res = await httpRequest(url, { timeout: 30_000 })
  if (!res.ok) {
    throw new ProxyStatusError(
      res.status,
      `proxy ${base} returned ${res.status} listing ${modulePath}`,
    )
  }
  return res
    .text()
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
}

/**
 * Pick the highest semver version whose publish time is at least `soakDays`
 * old relative to `now`. Versions missing a time or without valid semver are
 * ignored. Returns `undefined` when nothing has cleared the soak.
 */
export function newestSoakClearedVersion(
  versions: string[],
  timesByVersion: ReadonlyMap<string, Date>,
  soakDays: number,
  now: Date,
): string | undefined {
  const soakMs = soakDays * DAY_MS
  const nowMs = now.getTime()
  const cleared = versions.filter(version => {
    if (!valid(version, { loose: true })) {
      return false
    }
    const time = timesByVersion.get(version)
    if (!time) {
      return false
    }
    return nowMs - time.getTime() >= soakMs
  })
  if (cleared.length === 0) {
    return undefined
  }
  return [...cleared].sort((a, b) => rcompare(a, b, { loose: true }))[0]
}

/**
 * The gate (gomod-age parity): flag every module whose resolved publish time is
 * younger than `soakDays`. `fetchTime` resolves a module@version's publish
 * `Date` and is injectable for tests. A module whose time can't be resolved is
 * skipped (fail-open — the gate never blocks on an unreachable proxy).
 */
export async function checkModuleAges(
  modules: GoModule[],
  soakDays: number,
  now: Date,
  fetchTime: (module: string, version: string) => Promise<Date>,
): Promise<Violation[]> {
  const soakMs = soakDays * DAY_MS
  const nowMs = now.getTime()
  const violations: Violation[] = []
  const settled = await Promise.allSettled(
    modules.map(m => fetchTime(m.module, m.version)),
  )
  for (let i = 0; i < modules.length; i += 1) {
    const m = modules[i]!
    const result = settled[i]!
    if (result.status !== 'fulfilled') {
      continue
    }
    const publishTime = result.value
    const ageMs = nowMs - publishTime.getTime()
    if (ageMs < soakMs) {
      violations.push({
        ageMs,
        module: m.module,
        publishTime,
        remainingMs: soakMs - ageMs,
        soakMs,
        version: m.version,
      })
    }
  }
  return violations
}

/**
 * Parse `require` directives from a go.mod source. Handles both the single-line
 * `require path version` form and the block
 * `require (\n\tpath version // indirect\n)` form; trailing `// …` comments are
 * dropped.
 */
export function parseGoMod(text: string): GoModule[] {
  const modules: GoModule[] = []
  const lines = text.split('\n')
  let inBlock = false
  for (const rawLine of lines) {
    const withoutComment = rawLine.split('//')[0] ?? ''
    const line = withoutComment.trim()
    if (line === '') {
      continue
    }
    if (inBlock) {
      if (line === ')') {
        inBlock = false
        continue
      }
      const parts = line.split(/\s+/)
      if (parts.length >= 2) {
        modules.push({ module: parts[0]!, version: parts[1]! })
      }
      continue
    }
    if (/^require\s*\($/.test(line)) {
      inBlock = true
      continue
    }
    if (line.startsWith('require ')) {
      const parts = line.slice('require '.length).trim().split(/\s+/)
      if (parts.length >= 2) {
        modules.push({ module: parts[0]!, version: parts[1]! })
      }
    }
  }
  return modules
}

/**
 * Find every OWN go.mod under `cwd`, excluding vendored / build / generated
 * trees (see `findOwnFiles`).
 */
export function findGoModFiles(cwd: string): string[] {
  return findOwnFiles(cwd, name => name === 'go.mod')
}

/**
 * Format a millisecond duration as an integer number of days for planner
 * output.
 */
export function formatDays(ms: number): string {
  return `${Math.ceil(ms / DAY_MS)}d`
}

/**
 * Thin dry-run planner. `--check` gates every own go.mod (prints violations and
 * exits non-zero on any). `--fix` (or default) plans a `go get module@<newest
 * soak-cleared version>` per module but NEVER runs the go toolchain — the apply
 * is a separate step. `soakDays` comes from `--soak-days <n>` (the orchestrator
 * passes the fleet soak); it is never hardcoded to a policy value.
 */
export async function main(argv: string[]): Promise<number> {
  const logger = getDefaultLogger()
  const checkMode = argv.includes('--check')
  let soakDays: number
  try {
    soakDays = requireSoakDays(argv, 'update/go')
  } catch (e) {
    logger.error(e instanceof Error ? e.message : String(e))
    return 2
  }
  const cwd = process.cwd()
  const goModFiles = findGoModFiles(cwd)
  if (goModFiles.length === 0) {
    logger.info('update/go: no own go.mod found — nothing to do.')
    return 0
  }
  const now = new Date()
  const entries = parseGoProxyChain(process.env['GOPROXY'])
  const fetchTime = (module: string, version: string): Promise<Date> =>
    fetchVersionTimeWithFallback(entries, module, version)
  let hadViolation = false
  for (const goModFile of goModFiles) {
    if (!existsSync(goModFile)) {
      continue
    }
    const modules = parseGoMod(readFileSync(goModFile, 'utf8'))
    if (modules.length === 0) {
      continue
    }
    if (checkMode) {
      const violations = await checkModuleAges(
        modules,
        soakDays,
        now,
        fetchTime,
      )
      if (violations.length > 0) {
        hadViolation = true
        logger.error(
          `update/go: ${goModFile} — ${violations.length} under soak:`,
        )
        for (const v of violations) {
          logger.error(
            `  ${v.module}@${v.version} — ${formatDays(v.remainingMs)} left of ${soakDays}d soak`,
          )
        }
      }
      continue
    }
    logger.info(`update/go: ${goModFile} — planning soak-cleared updates:`)
    for (const m of modules) {
      try {
        const versions = await listVersions(entries[0]?.url ?? '', m.module)
        const timesByVersion = new Map<string, Date>()
        const times = await Promise.allSettled(
          versions.map(v => fetchTime(m.module, v)),
        )
        for (let i = 0; i < versions.length; i += 1) {
          const t = times[i]!
          if (t.status === 'fulfilled') {
            timesByVersion.set(versions[i]!, t.value)
          }
        }
        const newest = newestSoakClearedVersion(
          versions,
          timesByVersion,
          soakDays,
          now,
        )
        if (newest && newest !== m.version) {
          logger.info(`  go get ${m.module}@${newest}`)
        }
      } catch {
        // Fail-open per module: an unreachable proxy skips that plan line.
      }
    }
  }
  return hadViolation ? 1 : 0
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(
    code => {
      process.exitCode = code
    },
    (e: unknown) => {
      getDefaultLogger().error(e instanceof Error ? e.message : String(e))
      process.exitCode = 1
    },
  )
}
