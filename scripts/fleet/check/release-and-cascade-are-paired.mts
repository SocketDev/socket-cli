#!/usr/bin/env node
/**
 * @file `check --all` gate: the lock-step release-cascade pin is PAIRED — a
 *   cascade SHA a member pins (`bundle.cascadeSha`) has a matching gh release
 *   whose `templateSha` equals it, AND the release at `bundle.ref` exists. The
 *   read-side twin of the dep-0 fetcher's fetch-path verify: the fetcher fails
 *   loud at install time; this fails loud at CI time so a broken pin can't sit
 *   green. Reads the local `.config/socket-wheelhouse.json` `bundle` block. A
 *   repo with no pin (the wheelhouse-as-producer, a non-thin member) passes
 *   vacuously. When a pin exists, resolves the release at `bundle.ref` via gh
 *   and asserts `templateSha === bundle.cascadeSha`. NETWORK-GATED like the
 *   other registry checks: when gh is unavailable (no binary / not
 *   authenticated / offline), it SKIPS with a clear note rather than
 *   false-failing — the fetch-path verify still hard-fails at install time, so
 *   the invariant is never unguarded. Usage: node
 *   scripts/fleet/check/release-and-cascade-are-paired.mts [--quiet]
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- sync check; needs typed string stdout from gh, no async flow.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const CONFIG_PATH = path.join(REPO_ROOT, '.config', 'socket-wheelhouse.json')
const MANIFEST_NAME = 'release-bundle-manifest.json'
const DEFAULT_REPO = 'SocketDev/socket-wheelhouse'
const quiet = process.argv.includes('--quiet')

function note(message: string): void {
  if (!quiet) {
    logger.log(message)
  }
}

/**
 * Whether gh is usable: binary present AND authenticated. The check SKIPS (not
 * fails) when not — the fetch-path verify still guards the invariant at
 * install.
 */
export function ghIsUsable(): boolean {
  const r = spawnSync('gh', ['auth', 'status'], {
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  return r.status === 0
}

/**
 * Resolve a release's `templateSha` via gh. Returns undefined when the release
 * / asset / field is absent.
 */
export function resolveReleaseTemplateSha(
  ref: string,
  repo: string,
): string | undefined {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'release-pair-'))
  try {
    const r = spawnSync(
      'gh',
      [
        'release',
        'download',
        ref,
        '--repo',
        repo,
        '--pattern',
        MANIFEST_NAME,
        '--dir',
        tmp,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    )
    if (r.status !== 0) {
      return undefined
    }
    const manifestPath = path.join(tmp, MANIFEST_NAME)
    if (!existsSync(manifestPath)) {
      return undefined
    }
    const json = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      templateSha?: unknown | undefined
    }
    return typeof json.templateSha === 'string' ? json.templateSha : undefined
  } catch {
    return undefined
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

interface BundlePin {
  readonly ref: string
  readonly cascadeSha: string
}

/**
 * Read the local `bundle` pin. Returns undefined when there's no config / no
 * pin (a vacuous pass).
 */
export function readBundlePin(): BundlePin | undefined {
  if (!existsSync(CONFIG_PATH)) {
    return undefined
  }
  try {
    const json = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as {
      bundle?:
        | { ref?: unknown | undefined; cascadeSha?: unknown | undefined }
        | undefined
    }
    const ref = json.bundle?.ref
    const cascadeSha = json.bundle?.cascadeSha
    if (typeof ref !== 'string' || typeof cascadeSha !== 'string') {
      return undefined
    }
    return { cascadeSha, ref }
  } catch {
    return undefined
  }
}

function main(): void {
  const pin = readBundlePin()
  if (pin === undefined) {
    note('release-and-cascade-are-paired: no bundle pin — vacuous pass.')
    process.exitCode = 0
    return
  }
  if (!ghIsUsable()) {
    note(
      'release-and-cascade-are-paired: gh unavailable (no binary / not authenticated) — SKIPPING. ' +
        'The dep-0 fetch-path lock-step verify still guards the invariant at install time.',
    )
    process.exitCode = 0
    return
  }
  const templateSha = resolveReleaseTemplateSha(pin.ref, DEFAULT_REPO)
  if (templateSha === undefined) {
    logger.error(
      `release-and-cascade-are-paired: no release / manifest found at bundle.ref ${pin.ref}.\n` +
        `  Where: .config/socket-wheelhouse.json (bundle.ref).\n` +
        `  Wanted: a gh release at ${pin.ref} carrying ${MANIFEST_NAME} with templateSha ${pin.cascadeSha}.\n` +
        `  Saw:   no resolvable release at that ref.\n` +
        `  Fix:   cut the release for templateSha ${pin.cascadeSha}, or re-pin bundle.ref.`,
    )
    process.exitCode = 1
    return
  }
  if (templateSha !== pin.cascadeSha) {
    logger.error(
      `release-and-cascade-are-paired: pin is NOT paired.\n` +
        `  Where: .config/socket-wheelhouse.json (bundle).\n` +
        `  Wanted: templateSha of the release at bundle.ref === bundle.cascadeSha.\n` +
        `  Saw:   ref=${pin.ref} (release templateSha ${templateSha}), cascadeSha=${pin.cascadeSha}.\n` +
        `  Fix:   re-cascade to the pin, or re-pin bundle.ref to the release whose templateSha is ${pin.cascadeSha}.`,
    )
    process.exitCode = 1
    return
  }
  note(
    `release-and-cascade-are-paired: paired — ${pin.ref} (templateSha ${templateSha}) === cascadeSha.`,
  )
  process.exitCode = 0
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
