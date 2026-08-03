/*
 * @file Read the fleet's security posture out of `gh` payloads and the local
 *   checkout. Extracted from `security-posture-law.mts` up front, on the
 *   precedent of `spawn-env-scan.mts`: the law must stay PURE — no network, no
 *   spawn — so it can be imported by a hook, a prompt, or a test without
 *   reaching anywhere, and so it stays readable AS a law. This module answers
 *   "what does GitHub say"; the law answers "is that allowed".
 *
 *   Every parser here takes a {@link GhAnswer} — the exit status plus both
 *   streams — because for two of these endpoints THE HTTP STATUS IS THE WHOLE
 *   ANSWER and there is no body to read:
 *
 *   - `vulnerability-alerts` returns 204 when on and 404 when off. Reading only
 *     stdout would see an empty string both ways.
 *   - `code-scanning/default-setup` returns 403 `Code Security must be enabled`
 *     on private and internal repos. That is the EXPECTED shape for the nine
 *     paid-GHAS repos, and it arrives as a `gh` FAILURE, so a parser that only
 *     ran on success would classify all nine as unreadable.
 *
 *   Every parser returns `undefined` for an answer it cannot classify, which
 *   the law turns into no finding at all. That is deliberate and it is the
 *   expensive half: distinguishing "GitHub said off" from "we could not ask"
 *   is what keeps a network blip from reading as a fleet-wide security
 *   collapse, and it is why a non-zero exit with no recognizable HTTP status
 *   is UNREADABLE here rather than "disabled".
 *
 *   Known limits of the language read, since it decides what gets scanned:
 *
 *   - `git ls-files` sees the CHECKED-OUT branch, which may not be the default
 *     branch GitHub scans.
 *   - The `gh api …/languages` fallback (used where no local clone exists —
 *     sauce) is Linguist over the whole default branch and CANNOT exclude a
 *     `fixtures/` path, so it is strictly coarser than the local scan.
 *   - Extension matching only. A shebang-only script, a language embedded in a
 *     template, and a generated file are all invisible or over-counted, in that
 *     order.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  ALWAYS_EXPECTED_LANGUAGES,
  CANONICAL_JS_IDENTIFIER,
  CODEQL_LANGUAGE_GLOBS,
  EXCLUDED_PATH_SEGMENT,
} from './security-posture-law.mts'

import type {
  CodeScanningProbe,
  DependabotYmlProbe,
  RepoVisibility,
  SecretScanningProbe,
} from './security-posture-law.mts'

/**
 * One `gh` invocation's result: the harness exit code plus both streams. Never
 * a piped string — a `gh … | grep` reports grep's status, and for these
 * endpoints the status IS the answer.
 */
export interface GhAnswer {
  readonly ok: boolean
  readonly stderr: string
  readonly stdout: string
}

/**
 * What `repos/{owner}/{repo}` says about visibility and secret scanning.
 * `secretScanning` is undefined on private and internal repos, where
 * `security_and_analysis` comes back `null` — an unreadable field, not a
 * disabled one.
 */
export interface RepoProbe {
  readonly secretScanning: SecretScanningProbe | undefined
  readonly visibility: RepoVisibility | undefined
}

/**
 * Linguist language name to CodeQL identifier. Only the languages CodeQL can
 * analyse appear; a Linguist entry with no mapping (Shell, HTML, Dockerfile)
 * is dropped rather than guessed at.
 */
export const LINGUIST_TO_CODEQL: Readonly<Record<string, string>> =
  Object.freeze({
    __proto__: null,
    'C#': 'csharp',
    'C++': 'c-cpp',
    C: 'c-cpp',
    Go: 'go',
    Java: 'java-kotlin',
    JavaScript: CANONICAL_JS_IDENTIFIER,
    Kotlin: 'java-kotlin',
    Python: 'python',
    Ruby: 'ruby',
    Rust: 'rust',
    Swift: 'swift',
    TypeScript: CANONICAL_JS_IDENTIFIER,
  }) as unknown as Readonly<Record<string, string>>

// File extension to CodeQL identifier, derived ONCE from the law's globs so
// the two can never disagree. A glob that is not a bare `*.ext` is skipped —
// the law states the rule is extension-only.
const EXTENSION_TO_LANGUAGE = new Map<string, string>()
const CODEQL_LANGUAGE_NAMES = Object.keys(CODEQL_LANGUAGE_GLOBS)
for (let i = 0, { length } = CODEQL_LANGUAGE_NAMES; i < length; i += 1) {
  const language = CODEQL_LANGUAGE_NAMES[i]!
  const globs = CODEQL_LANGUAGE_GLOBS[language]!
  for (let j = 0, globCount = globs.length; j < globCount; j += 1) {
    const glob = globs[j]!
    if (glob.startsWith('*.') && !glob.slice(2).includes('*')) {
      EXTENSION_TO_LANGUAGE.set(glob.slice(1), language)
    }
  }
}

// The HTTP status `gh` reports on a failed call, e.g. `… (HTTP 403)`. Also
// matched against the JSON error body, which carries `"status":"403"`.
const HTTP_STATUS_RE = /\(HTTP (\d{3})\)/
const BODY_STATUS_RE = /"status"\s*:\s*"(\d{3})"/

// The status of a failed `gh` call, or undefined when the failure carries no
// HTTP status at all — a DNS failure, a killed process, no network. That
// distinction is the whole reason this helper exists: "GitHub said no" and
// "we never reached GitHub" must not collapse into one verdict.
function failureStatus(answer: GhAnswer): number | undefined {
  const fromStderr = HTTP_STATUS_RE.exec(answer.stderr)
  if (fromStderr) {
    return Number(fromStderr[1])
  }
  const fromBody = BODY_STATUS_RE.exec(answer.stdout)
  return fromBody ? Number(fromBody[1]) : undefined
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const out: string[] = []
  for (let i = 0, { length } = value; i < length; i += 1) {
    const entry = value[i]
    if (typeof entry === 'string') {
      out.push(entry)
    }
  }
  return out
}

/**
 * Parse `code-scanning/default-setup`. Three readable shapes: a `configured` /
 * `not-configured` body on success, and the 403 `Code Security must be
 * enabled` FAILURE that private and internal repos answer, which becomes
 * `state: 'ghas-required'`. Anything else is undefined. Pure.
 */
export function parseDefaultSetup(
  answer: GhAnswer,
): CodeScanningProbe | undefined {
  if (!answer.ok) {
    return failureStatus(answer) === 403
      ? { state: 'ghas-required' }
      : undefined
  }
  const data = parseJson(answer.stdout) as
    | {
        languages?: unknown | undefined
        query_suite?: unknown | undefined
        state?: unknown | undefined
      }
    | undefined
  const state = data?.state
  if (state !== 'configured' && state !== 'not-configured') {
    return undefined
  }
  return {
    languages: stringList(data?.languages),
    querySuite:
      typeof data?.query_suite === 'string' ? data.query_suite : undefined,
    state,
  }
}

/**
 * Parse `vulnerability-alerts`, where the status IS the answer: 204 (a clean
 * exit) means enabled, a 404 failure means disabled. A failure carrying no
 * HTTP status — no network, no `gh` — is undefined, because a transport
 * failure must never read as "this repo's alerts are off". Pure.
 */
export function parseVulnerabilityAlerts(
  answer: GhAnswer,
): boolean | undefined {
  if (answer.ok) {
    return true
  }
  return failureStatus(answer) === 404 ? false : undefined
}

/**
 * Parse `automated-security-fixes`, whose body is `{enabled, paused}`.
 *
 * `paused` is read and deliberately does NOT soften the verdict: GitHub pauses
 * Dependabot on a repo after a long idle stretch and resumes it on the next
 * push, so an enabled-but-paused repo still opens auto-PRs the moment someone
 * commits. Only `enabled: false` is off. Pure.
 */
export function parseAutomatedSecurityFixes(
  answer: GhAnswer,
): boolean | undefined {
  if (!answer.ok) {
    return undefined
  }
  const data = parseJson(answer.stdout) as
    | { enabled?: unknown | undefined; paused?: unknown | undefined }
    | undefined
  return typeof data?.enabled === 'boolean' ? data.enabled : undefined
}

/**
 * Parse `repos/{owner}/{repo}` for visibility and the two secret-scanning
 * toggles. `security_and_analysis: null` — what every private and internal
 * repo answers — leaves `secretScanning` undefined, which the law reads as
 * unreadable rather than disabled. Pure.
 */
export function parseRepoSecurity(answer: GhAnswer): RepoProbe | undefined {
  if (!answer.ok) {
    return undefined
  }
  const data = parseJson(answer.stdout) as
    | {
        security_and_analysis?: unknown | undefined
        visibility?: unknown | undefined
      }
    | undefined
  if (!data || typeof data !== 'object') {
    return undefined
  }
  const raw = data.visibility
  const visibility =
    raw === 'internal' || raw === 'private' || raw === 'public'
      ? (raw as RepoVisibility)
      : undefined
  const analysis = data.security_and_analysis as
    | Record<string, { status?: unknown | undefined } | undefined>
    | null
    | undefined
  const scanning = analysis?.['secret_scanning']?.status
  const protection = analysis?.['secret_scanning_push_protection']?.status
  const secretScanning =
    typeof scanning === 'string' && typeof protection === 'string'
      ? {
          pushProtection: protection === 'enabled',
          secretScanning: scanning === 'enabled',
        }
      : undefined
  return { secretScanning, visibility }
}

/**
 * Parse `contents/.github/dependabot.yml` into its bytes. A 404 failure is the
 * readable `absent` answer — a real finding, since GitHub will not fully
 * disable Dependabot without the file. Any other failure, or a payload that is
 * not base64 content, is undefined. Pure.
 */
export function parseDependabotYml(
  answer: GhAnswer,
): DependabotYmlProbe | undefined {
  if (!answer.ok) {
    return failureStatus(answer) === 404 ? { kind: 'absent' } : undefined
  }
  const data = parseJson(answer.stdout) as
    | { content?: unknown | undefined; encoding?: unknown | undefined }
    | undefined
  if (data?.encoding !== 'base64' || typeof data.content !== 'string') {
    return undefined
  }
  try {
    return {
      kind: 'present',
      text: Buffer.from(data.content, 'base64').toString('utf8'),
    }
  } catch {
    return undefined
  }
}

/**
 * Map a `repos/{owner}/{repo}/languages` payload (Linguist byte counts) to
 * CodeQL identifiers, with {@link ALWAYS_EXPECTED_LANGUAGES} folded in. Sorted
 * and deduped. Coarser than the local scan — see the file header. Pure.
 */
export function parseLinguistLanguages(answer: GhAnswer): string[] | undefined {
  if (!answer.ok) {
    return undefined
  }
  const data = parseJson(answer.stdout)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return undefined
  }
  const out = new Set<string>(ALWAYS_EXPECTED_LANGUAGES)
  const names = Object.keys(data)
  for (let i = 0, { length } = names; i < length; i += 1) {
    const mapped = LINGUIST_TO_CODEQL[names[i]!]
    if (mapped) {
      out.add(mapped)
    }
  }
  return [...out].toSorted()
}

/**
 * The CodeQL languages a file list mechanically proves are present, with
 * {@link ALWAYS_EXPECTED_LANGUAGES} folded in. Any path with a
 * `fixtures` segment is skipped whole — fixture code is deliberately weird and
 * one stray `.rb` fixture would otherwise pull a whole extractor into the
 * setup. Sorted and deduped. Pure.
 */
export function presentCodeqlLanguages(files: readonly string[]): string[] {
  const out = new Set<string>(ALWAYS_EXPECTED_LANGUAGES)
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    if (!file) {
      continue
    }
    if (normalizePath(file).split('/').includes(EXCLUDED_PATH_SEGMENT)) {
      continue
    }
    const dot = file.lastIndexOf('.')
    if (dot === -1) {
      continue
    }
    const language = EXTENSION_TO_LANGUAGE.get(file.slice(dot).toLowerCase())
    if (language) {
      out.add(language)
    }
  }
  return [...out].toSorted()
}

/**
 * The CodeQL languages present in a local checkout, or undefined when there is
 * no readable git tree there (no clone, not a repo, `git` unavailable) — the
 * caller then falls back to the Linguist read. Spawns `git ls-files`.
 */
export function scanPresentLanguages(repoDir: string): string[] | undefined {
  if (!existsSync(path.join(repoDir, '.git'))) {
    return undefined
  }
  // oxlint-disable-next-line socket/prefer-async-spawn -- the caller is a sync CLI sweep; the language read must resolve inline.
  const result = spawnSync('git', ['-C', repoDir, 'ls-files'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    return undefined
  }
  return presentCodeqlLanguages(String(result.stdout ?? '').split('\n'))
}
