#!/usr/bin/env node
// Claude Code Stop hook — provenance-publish-nudge.
//
// After a release commit (HEAD matches `chore: bump version to vX.Y.Z`
// or HEAD has a `vX.Y.Z`-shaped annotated tag), query the npm registry
// for that version's trust metadata and warn if it's missing either:
//   - dist.attestations (--provenance was used)
//   - _npmUser.trustedPublisher (OIDC trusted publisher)
//
// Why a Stop hook (not a PreToolUse gate): the version's been
// published by the time we can verify. This is post-hoc; the gate
// already failed if it failed. We catch the failure mode where the
// publish workflow ran "successfully" but somehow without OIDC (e.g.
// the workflow regressed, fell back to a classic token without
// updating the trusted-publisher block on npmjs.com).
//
// Behavior on Stop:
//   1. Drain stdin (Stop payload; we don't use it).
//   3. Read package.json → name + version.
//   4. Check HEAD for release-shape markers. Skip if none.
//   5. Throttle via .claude/state/provenance-nudge.last so each
//      release is checked at most once per name@version per session.
//   6. Fetch the registry packument. If version not yet published,
//      skip silently (release is in-flight, retry next Stop).
//   7. If version exists AND has both signals → silent.
//   8. If version exists AND missing one or both → emit a warning to
//      stderr (visible in transcript, not blocking).
//
// Configuration env vars (all optional):
//
// The hook NEVER fails the turn. Stop hooks shouldn't gate; they
// nudge. The warning surfaces so the operator decides what to do.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

const RELEASE_MESSAGE_RE =
  /^chore(?:\([^)]*\))?:\s+(?:bump version to |release )v?(?<version>\d+\.\d+\.\d+)/i
const RELEASE_TAG_RE = /^v?(?<version>\d+\.\d+\.\d+)$/
const STATE_PATH = '.claude/state/provenance-nudge.last'

interface RegistryVersionInfo {
  trustedPublisher?:
    | { id: string; oidcConfigId?: string | undefined }
    | undefined
  attestations?:
    | { url: string; provenance: { predicateType: string } }
    | undefined
}

/**
 * Check whether HEAD looks like a release commit. Two signals: 1. HEAD's commit
 * message matches the release-shape regex. 2. HEAD has an annotated tag
 * matching vX.Y.Z and the version matches the package.json version (catches the
 * case where the tag was created separately from the bump commit).
 */
function isReleaseHead(repoRoot: string, pkgVersion: string): boolean {
  // Signal 1: commit message.
  const msg = spawnSync('git', ['log', '-1', '--format=%B'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (msg.status === 0) {
    /* c8 ignore start - lib spawnSync with encoding:'utf8' always returns stdout as string; the ?? and ?. are type-narrowing guards */
    const subject = (msg.stdout as string | undefined)?.split('\n')[0] ?? ''
    /* c8 ignore stop */
    const m = RELEASE_MESSAGE_RE.exec(subject)
    if (m && m.groups!.version === pkgVersion) {
      return true
    }
  }
  // Signal 2: HEAD tag.
  const tag = spawnSync('git', ['tag', '--points-at', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (tag.status !== 0) {
    return false
  }
  /* c8 ignore start - lib spawnSync with encoding:'utf8' always returns stdout as string; the ?? is a type-narrowing guard */
  const tags = ((tag.stdout as string | undefined) ?? '')
    /* c8 ignore stop */
    .split('\n')
    .filter(Boolean)
  for (const t of tags) {
    const m = RELEASE_TAG_RE.exec(t)
    if (m && m.groups!.version === pkgVersion) {
      return true
    }
  }
  return false
}

function alreadyCheckedThisSession(
  repoRoot: string,
  stateKey: string,
): boolean {
  const statePath = path.join(repoRoot, STATE_PATH)
  if (!existsSync(statePath)) {
    return false
  }
  try {
    const last = readFileSync(statePath, 'utf8').trim()
    return last === stateKey
  } catch {
    return false
  }
}

function recordChecked(repoRoot: string, stateKey: string): void {
  const statePath = path.join(repoRoot, STATE_PATH)
  try {
    mkdirSync(path.dirname(statePath), { recursive: true })
    writeFileSync(statePath, stateKey, 'utf8')
  } catch {
    // Best-effort; if we can't write state we'll re-check next Stop.
  }
}

/**
 * Fetch a single version's trust info. Returns undefined when the version isn't
 * on the registry yet (the publish hasn't propagated or didn't happen).
 */
async function fetchVersionInfo(
  name: string,
  version: string,
): Promise<RegistryVersionInfo | undefined> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}/${encodeURIComponent(version)}`
  try {
    // socket-lint: allow global-fetch -- provenance check probes the npm registry; runs as a standalone hook without the lib http-request helper wired up.
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
    })
    if (response.status === 404) {
      return undefined
    }
    if (!response.ok) {
      return undefined
    }
    const json = (await response.json()) as {
      dist?:
        | {
            attestations?:
              | { url: string; provenance: { predicateType: string } }
              | undefined
          }
        | undefined
      _npmUser?:
        | {
            trustedPublisher?:
              | { id: string; oidcConfigId?: string | undefined }
              | undefined
          }
        | undefined
    }
    return {
      ...(json._npmUser?.trustedPublisher
        ? { trustedPublisher: json._npmUser.trustedPublisher }
        : {}),
      ...(json.dist?.attestations
        ? { attestations: json.dist.attestations }
        : {}),
    }
  } catch {
    return undefined
  }
}

export const check = async (_payload: ToolCallPayload) => {
  const repoRoot = process.cwd()
  const pkgPath = path.join(repoRoot, 'package.json')
  if (!existsSync(pkgPath)) {
    return undefined
  }

  let pkg: { name?: string | undefined; version?: string | undefined }
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as typeof pkg
  } catch {
    return undefined
  }
  if (!pkg.name || !pkg.version) {
    return undefined
  }

  if (!isReleaseHead(repoRoot, pkg.version)) {
    return undefined
  }

  const stateKey = `${pkg.name}@${pkg.version}`
  if (alreadyCheckedThisSession(repoRoot, stateKey)) {
    return undefined
  }

  const info = await fetchVersionInfo(pkg.name, pkg.version)
  if (info === undefined) {
    // Version not on registry yet — release in flight or never
    // published. Don't warn; the next Stop will re-check.
    return undefined
  }

  // Mark this version as checked even on the happy path so we don't
  // spam-fetch the registry on every Stop event.
  recordChecked(repoRoot, stateKey)

  const missing: string[] = []
  if (!info.attestations) {
    missing.push('provenance attestation (`--provenance` flag)')
  }
  if (!info.trustedPublisher) {
    missing.push('trusted-publisher OIDC (`_npmUser.trustedPublisher`)')
  }
  if (missing.length === 0) {
    return undefined
  }

  return notify(
    [
      `[provenance-publish-nudge] ${stateKey} is published but missing:`,
      ...missing.map(m => `  - ${m}`),
      `  Verify with: node scripts/fleet/check/provenance-is-attested.mts ${pkg.name} --version ${pkg.version}`,
      `  This typically means the publish workflow regressed (e.g. fell back from staged-publish + OIDC to a classic-token publish).`,
      '',
    ].join('\n'),
  )
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})

/* c8 ignore start - runGuard catches internally; this .catch handler is an unreachable safety net */
void runHook(hook, import.meta.url).catch(e => {
  process.stderr.write(
    `[provenance-publish-nudge] hook error (continuing): ${errorMessage(e)}\n`,
  )
})
/* c8 ignore stop */
