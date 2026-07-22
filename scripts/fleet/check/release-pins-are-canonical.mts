#!/usr/bin/env node
/*
 * @file Assertion: every PERSISTED release pin stores ONLY exact canonical
 *   values — never a fuzzy/aliased token. Aliases (`latest`, `main`, `head`,
 *   `stable`, `newest`, …) are a USER-INPUT convenience: they get canonicalized
 *   at the input boundary and must never reach a committed pin or manifest.
 *
 *   This is the BELT twin of the WRITE-TIME validators that already reject a
 *   fuzzy/ranged/aliased pin as it is written:
 *     - `bootstrap/src/lockstep.mts` (`validateRef` / `validateCascadeSha`) — the
 *       dep-0 fetcher's gate, and
 *     - `scripts/repo/sync-scaffolding/socket-wheelhouse-config.mts`
 *       (`validateBundleBlock`) — the cascade stamper's gate.
 *   Those run when a pin is WRITTEN; this asserts the invariant STILL holds over
 *   the actual committed tree — catching a pin hand-edited past the write gate,
 *   or a member whose config predates the gate. It does not relax or duplicate
 *   the write-time shape check; it re-asserts it (plus `stable`/`newest`, the two
 *   alias tokens the discipline names) over what is committed.
 *
 *   What it asserts, per the report `cross-agent-config-aliasing-notes.md`:
 *     1. `bundle.ref` is an EXACT `fleet-<hex>` tag — no `latest`/`main`/`head`/
 *        `stable`/`newest`/range/alias.
 *     2. `bundle.cascadeSha` (and a manifest `templateSha`) is a bare 40-hex SHA.
 *     3. No pin stores BOTH an alias and its canonical form — any non-canonical
 *        field beside `ref` + `cascadeSha` is an alias that leaked into storage.
 *
 *   Surfaces (both belt-checked over the COMMITTED tree):
 *     - the effective `.config/…/socket-wheelhouse.json` `bundle` block (the
 *       member-owned lock-step pin), and
 *     - any git-tracked `release-bundle-manifest.json` (the release artifact;
 *       normally regenerated + SHA-verified, never committed — so this is
 *       defense-in-depth, vacuous where none is tracked).
 *
 *   Vacuous pass where nothing is pinned (the wheelhouse producer, a non-thin
 *   member) — never false-green. Exit codes: 0 — every persisted pin is
 *   canonical (or none exists); 1 — a persisted pin carries a fuzzy/aliased or
 *   non-canonical value.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT, findSocketWheelhouseConfig } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// An EXACT `fleet-<hex>` release tag — the only legal `bundle.ref` value. No
// semver, no range, no alias; the hex segment is the bundle stamp (7+ hex).
const CANONICAL_REF_RE = /^fleet-[0-9a-f]{7,}$/
// A bare full-length git SHA — exactly 40 lowercase hex chars. No `v` prefix, no
// range, no alias. The legal `bundle.cascadeSha` + manifest `templateSha` value.
const CANONICAL_SHA_RE = /^[0-9a-f]{40}$/
// Fuzzy / aliased / ranged tokens a persisted pin must NEVER carry. A superset
// of the write-time set: adds `newest` + `stable`, the two the discipline names.
// Named in the finding so the operator sees which alias leaked.
const FUZZY_ALIAS_RE =
  /[\^~*]|\b(?:canary|head|latest|lts|main|master|newest|next|stable)\b/i
// Pin fields whose value must be a bare canonical git SHA.
const SHA_FIELDS: ReadonlySet<string> = new Set(['cascadeSha', 'templateSha'])
// A sibling KEY name that advertises an alias / user-input variant of a
// canonical pin (`refAlias`, `refInput`, `channel`, `refSelector`) — the shape
// of "store both an alias and the canonical form".
const ALIAS_KEY_RE = /alias|channel|input|selector/i

export interface PinFinding {
  readonly field: string
  readonly reason: string
  readonly value: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Classify a persisted release pin into canonicality findings. Pure — no IO —
 * so the invariant unit-tests without a filesystem. Pass the whole `bundle`
 * block (its only legal keys are `ref` + `cascadeSha`, so any other key is a
 * leaked alias) or a curated manifest pin record (see `manifestPinFields`). An
 * absent (`undefined`/`null`) pin is vacuously canonical — the producer /
 * non-thin case.
 */
export function classifyReleasePin(label: string, pin: unknown): PinFinding[] {
  if (pin === undefined || pin === null) {
    return []
  }
  if (!isPlainObject(pin)) {
    return [
      {
        field: label,
        reason:
          'a release pin must be a JSON object of exact canonical values (ref + cascadeSha)',
        value: String(pin),
      },
    ]
  }
  const findings: PinFinding[] = []
  const keys = Object.keys(pin)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    const value = pin[key]
    const field = `${label}.${key}`
    if (key === 'ref') {
      if (typeof value === 'string') {
        if (FUZZY_ALIAS_RE.test(value)) {
          findings.push({
            field,
            reason:
              'persisted ref carries a fuzzy alias token (latest/main/head/stable/newest/next/…); a release pin stores only an exact fleet-<hex> tag — canonicalize the alias at input time, never persist it',
            value,
          })
        } else if (!CANONICAL_REF_RE.test(value)) {
          findings.push({
            field,
            reason: 'persisted ref is not an exact fleet-<hex> release tag',
            value,
          })
        }
      }
      continue
    }
    if (SHA_FIELDS.has(key)) {
      if (typeof value === 'string' && !CANONICAL_SHA_RE.test(value)) {
        findings.push({
          field,
          reason:
            'persisted SHA is not a bare 40-hex git SHA (no v-prefix, range, or alias)',
          value,
        })
      }
      continue
    }
    // Any other key in a pin object is non-canonical: an alias, a user-input
    // convenience, or a second form of a field already stored canonically.
    // Aliases resolve at the input boundary and must never persist.
    findings.push({
      field,
      reason: ALIAS_KEY_RE.test(key)
        ? 'release pin carries an alias-form field beside the canonical value; persist only ref + cascadeSha'
        : 'release pin carries a non-canonical field; persist only the exact ref + cascadeSha',
      value: typeof value === 'string' ? value : JSON.stringify(value),
    })
  }
  return findings.toSorted(
    (a, b) =>
      a.field.localeCompare(b.field) || a.reason.localeCompare(b.reason),
  )
}

/**
 * Extract only the PIN-bearing fields of a release manifest: `templateSha` (the
 * canonical lock-step SHA), a `ref`, any SHA field, and any alias-form sibling
 * key. Pure. Drops free-text fields ($schema, version, generatedFrom, files, …)
 * so the classifier never false-positives on, e.g., a `$schema` URL that
 * contains the path segment `main`.
 */
export function manifestPinFields(manifest: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { __proto__: null } as unknown as Record<
    string,
    unknown
  >
  if (!isPlainObject(manifest)) {
    return out
  }
  const keys = Object.keys(manifest)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    if (key === 'ref' || SHA_FIELDS.has(key) || ALIAS_KEY_RE.test(key)) {
      out[key] = manifest[key]
    }
  }
  return out
}

function readJson(absPath: string): unknown {
  try {
    return JSON.parse(readFileSync(absPath, 'utf8'))
  } catch {
    // A malformed / unreadable config is another gate's concern — this belt
    // asserts pin canonicality, so an unparseable file is skipped, not claimed.
    return undefined
  }
}

// Git-tracked `release-bundle-manifest.json` paths (repo-relative), or `[]` when
// git is unavailable / no manifest is tracked. Fail-open: a manifest is normally
// a regenerated, SHA-verified build artifact that is never committed, so an empty
// result is the common case, not a failure.
async function trackedManifestPaths(): Promise<string[]> {
  try {
    const r = (await spawn(
      'git',
      ['ls-files', '*release-bundle-manifest.json'],
      {
        cwd: REPO_ROOT,
        stdio: 'pipe',
        stdioString: true,
      },
    )) as { stdout?: string }
    return String(r?.stdout ?? '')
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

export async function main(): Promise<void> {
  const findings: PinFinding[] = []

  // The effective member-owned lock-step pin (the `bundle` block). The producer
  // and non-thin members carry no `bundle` — a vacuous pass.
  const location = findSocketWheelhouseConfig(REPO_ROOT)
  if (location) {
    const parsed = readJson(location.path)
    if (isPlainObject(parsed)) {
      findings.push(
        ...classifyReleasePin(`${location.path} bundle`, parsed['bundle']),
      )
    }
  }

  // Any git-tracked release manifest (defense-in-depth; normally none).
  for (const rel of await trackedManifestPaths()) {
    const parsed = readJson(path.join(REPO_ROOT, rel))
    findings.push(...classifyReleasePin(rel, manifestPinFields(parsed)))
  }

  if (findings.length === 0) {
    logger.success(
      'release-pins-are-canonical: every persisted release pin is exact + alias-free.',
    )
    return
  }
  logger.error(
    `release-pins-are-canonical: ${findings.length} non-canonical persisted pin value(s):`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]!
    logger.error(`  ${finding.field} = ${JSON.stringify(finding.value)}`)
    logger.error(`    ${finding.reason}`)
  }
  logger.error(
    '  What:  a release pin persisted a fuzzy/aliased or non-canonical value.\n' +
      '  Where: the above field(s) in a committed socket-wheelhouse config / release manifest.\n' +
      '  Wanted: bundle.ref = an exact fleet-<hex> tag; bundle.cascadeSha / templateSha = a bare 40-hex SHA; no alias stored beside the canonical value.\n' +
      '  Fix:   resolve the alias at input time and re-stamp the pin — `node scripts/repo/sync-scaffolding/cli.mts --target . --fix` — so only exact canonical values persist.',
  )
  process.exitCode = 1
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(`release-pins-are-canonical failed: ${errorMessage(e)}`)
    process.exitCode = 1
  })
}
/* c8 ignore stop */
