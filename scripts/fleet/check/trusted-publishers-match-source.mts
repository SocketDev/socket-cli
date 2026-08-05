#!/usr/bin/env node
/*
 * @file On-demand gate: every published package's npm trusted-publisher
 *   binding still names the repository that actually publishes it.
 *
 *   npm authorizes an OIDC exchange on repository + workflow filename +
 *   environment, compared as LITERAL strings. A repo rename therefore breaks
 *   publishing silently and in a way that survives inspection: GitHub redirects
 *   the old name, so `gh api repos/<owner>/<old>` answers with the new repo and
 *   every manual spot-check looks correct, while npm keeps refusing the
 *   exchange with a bare 404. The failure surfaces as `Skipped OIDC:
 *   ERR_PNPM_AUTH_TOKEN_EXCHANGE … 404` inside a publish run, far from its
 *   cause, and pnpm then continues with whatever other credential exists.
 *
 *   The expected binding is DERIVED, never assumed: `repository.url` from the
 *   package's own packument is the registry's own record of where it comes
 *   from, so this check cannot inherit the mistake it is looking for. The
 *   sibling bulk writer (publish-infra/npm/trust-sweep.mts) takes the same
 *   value from `expectedRepositoryFor`, so writer and checker cannot drift.
 *
 *   AUTH. `npm trust list` is 2FA-gated. Unauthenticated it answers E401, and
 *   under an agent shell the web-auth URL arrives masked as `auth/cli/***`, so
 *   the read runs through the fleet PTY wrapper (`runNpmWebAuth`) exactly as a
 *   human would. That makes this an ON-DEMAND check, never a CI gate: with no
 *   session it FAILS SOFT and exits 0, because a pipeline that cannot reach a
 *   2FA prompt must not wedge on one. It only speaks up when it genuinely read
 *   the registry and the answer disagreed with the source.
 *
 *   Usage: node scripts/fleet/check/trusted-publishers-match-source.mts
 *   [<pkg>…] [--json]
 *   Exit: 0 clean or unauthenticated; 1 drift found.
 */

import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  loadRosterFromRepo,
  publishesTo,
  resolveRepoName,
} from '../../../.claude/hooks/fleet/_shared/fleet-roster.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { runNpmWebAuth } from '../npm-web-auth.mts'
import { loadSocketWheelhouseConfig, REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// The publish surface every fleet member binds. A member that diverges states
// it in its own wheelhouse settings rather than here.
export const EXPECTED_WORKFLOW_FILE = 'npm-publish.yml'
export const EXPECTED_ENVIRONMENT = 'npm-publish'

export interface TrustBinding {
  environment: string | undefined
  file: string | undefined
  id: string | undefined
  repository: string | undefined
}

export interface BindingDrift {
  actual: string | undefined
  expected: string
  field: 'environment' | 'file' | 'repository'
}

/**
 * The `owner/repo` slug inside a package's `repository.url`. npm stores this
 * verbatim from the publishing package.json, so it is the registry's own
 * record of the source and the right thing to compare a binding against.
 * `undefined` when the field is absent or not a GitHub URL.
 */
export function parseRepositorySlug(
  url: string | undefined,
): string | undefined {
  if (!url) {
    return undefined
  }
  // Accepts the git+https://, https://, and git@ spellings npm normalizes to,
  // trimming an optional `.git` suffix and any trailing #ref / ?query.
  // oxlint-disable-next-line socket/require-regex-comment -- documented above
  const match = /github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[#?].*)?$/.exec(
    url,
  )
  return match ? `${match[1]}/${match[2]}` : undefined
}

// A CSI escape: ESC, '[', numeric/; params, final letter. The ESC byte is part
// of the sequence and must be matched — a pattern that starts at '[' leaves
// every ESC in the stream AND eats bracketed literal text that happens to look
// like params, which is how a `repository:` line goes silently unparsed.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const ANSI_CSI_RE = /\u001B\[[0-9;]*[a-zA-Z]/g

// What the PTY leaves around the payload once escapes are gone: braille
// spinner frames, and the carriage returns it uses to redraw a line in place.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const PTY_NOISE_RE = /[\u2800-\u28FF\r]/g

/**
 * Strip the PTY transport's decoration so a `key: value` parse sees plain text.
 * Exported because the stripping, not the matching, is where this went wrong
 * once and is worth testing directly.
 */
export function stripPtyDecoration(output: string): string {
  return output.replace(ANSI_CSI_RE, '').replace(PTY_NOISE_RE, '')
}

/**
 * Parse the `key: value` block `npm trust list` prints. Tolerant by design:
 * the PTY transport interleaves spinner frames and ANSI escapes, so anything
 * that is not a recognized key is skipped rather than treated as a parse
 * failure.
 */
export function parseTrustList(output: string): TrustBinding {
  const binding: TrustBinding = {
    environment: undefined,
    file: undefined,
    id: undefined,
    repository: undefined,
  }
  const lines = stripPtyDecoration(output).split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    // oxlint-disable-next-line socket/require-regex-comment -- key: value on its own line
    const match = /^\s*(environment|file|id|repository):\s*(\S+)\s*$/.exec(
      lines[i] ?? '',
    )
    if (match) {
      binding[match[1] as keyof TrustBinding] = match[2]
    }
  }
  return binding
}

/**
 * Every field of `binding` that disagrees with the source of truth. Empty when
 * the binding matches. A field npm did not report counts as drift, because an
 * absent repository is exactly the shape that 404s.
 */
export function findBindingDrift(
  binding: TrustBinding,
  expectedRepository: string,
): BindingDrift[] {
  const drift: BindingDrift[] = []
  if (binding.repository !== expectedRepository) {
    drift.push({
      actual: binding.repository,
      expected: expectedRepository,
      field: 'repository',
    })
  }
  if (binding.file !== EXPECTED_WORKFLOW_FILE) {
    drift.push({
      actual: binding.file,
      expected: EXPECTED_WORKFLOW_FILE,
      field: 'file',
    })
  }
  if (binding.environment !== EXPECTED_ENVIRONMENT) {
    drift.push({
      actual: binding.environment,
      expected: EXPECTED_ENVIRONMENT,
      field: 'environment',
    })
  }
  return drift
}

/**
 * True when the output says the read never reached the registry, rather than
 * reaching it and reporting a binding. These are the fail-soft cases: no npm
 * session (E401), or a 2FA prompt nothing could answer (EOTP).
 */
export function isUnauthenticated(output: string): boolean {
  return /\bE401\b|\bEOTP\b|Unauthorized/.test(output)
}

/**
 * The four-ingredient report for one package's drift.
 */
export function formatDrift(
  pkg: string,
  drift: readonly BindingDrift[],
): string {
  const lines = [
    `${pkg}: the trusted-publisher binding does not match the package source.`,
    `  Where: npm's trusted-publisher config for ${pkg}.`,
  ]
  for (let i = 0, { length } = drift; i < length; i += 1) {
    const d = drift[i]!
    lines.push(
      `  Saw vs wanted: ${d.field} is ${d.actual ?? '(unset)'}; wanted ${d.expected}.`,
    )
  }
  lines.push(
    '  Fix: npm cannot edit a binding in place, so revoke and recreate it —',
    `    node scripts/fleet/npm-web-auth.mts trust revoke ${pkg} --id=<id>`,
    `    node scripts/fleet/npm-web-auth.mts trust github ${pkg} --file ${EXPECTED_WORKFLOW_FILE} --repo <owner/repo> --env ${EXPECTED_ENVIRONMENT} --allow-stage-publish`,
    '  A rename is the usual cause: GitHub redirects the old name so the stale',
    '  binding still looks right, while npm compares the claim literally.',
  )
  return lines.join('\n')
}

/**
 * Read a package's binding through the PTY wrapper, returning the raw output
 * so the caller can tell "no session" apart from "read it, and here it is".
 */
export async function readTrustList(pkg: string): Promise<string> {
  const chunks: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  // The wrapper streams npm's own output; capture it without silencing the
  // auth URL, which the operator may need to click.
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    chunks.push(String(chunk))
    return originalWrite(chunk as string)
  }) as typeof process.stdout.write
  try {
    await runNpmWebAuth({
      argv: ['trust', 'list', pkg],
      env: process.env,
      isTty: Boolean(process.stdout.isTTY),
      platform: process.platform,
    })
  } finally {
    process.stdout.write = originalWrite
  }
  // the raw stream so a caller can also scan it for auth failures.
  // Decoration is stripped at parse time by stripPtyDecoration; hand back
  return chunks.join('')
}

/**
 * The repository a package says it comes from, read from its packument. This
 * is the SOURCE OF TRUTH the binding is measured against, and it must not come
 * from the binding itself — comparing the binding to itself is the vacuous
 * check this exists to avoid. Not 2FA-gated, so a plain read serves.
 * `undefined` when the package or the field is absent.
 */
export async function expectedRepositoryFor(
  pkg: string,
): Promise<string | undefined> {
  const { spawn } =
    await import('@socketsecurity/lib-stable/process/spawn/child')
  try {
    const result = await spawn('npm', ['view', pkg, 'repository.url'], {
      // A fleet repo's devEngines pins pnpm and npm refuses to run inside one,
      // so read from a neutral cwd.
      cwd: os.tmpdir(),
      shell: WIN32,
      stdio: 'pipe',
      stdioString: true,
    })
    return parseRepositorySlug(String(result.stdout ?? '').trim())
  } catch {
    return undefined
  }
}

// Where a repo whose root manifest cannot name its published package declares
// the names instead. One member surface, per config-segregation.
export const PUBLISHED_PACKAGES_CONFIG_KEY = 'release.publishedPackages'

/**
 * The npm names this repo declares it publishes, from
 * `release.publishedPackages` in `.config/repo/socket-wheelhouse.json`. This is
 * the answer for a monorepo whose root manifest is `private: true` and whose
 * published artifact is assembled under a name no manifest on disk carries —
 * there the manifest read below can only ever say "nothing". Empty when the
 * config, the block, or the key is absent, or when the value is not a list of
 * non-empty strings: a malformed entry falls through to the manifest rather
 * than sending the check at a package name nobody wrote.
 */
export function publishedNamesFromConfig(repoRoot: string): string[] {
  const loaded = loadSocketWheelhouseConfig(repoRoot)
  const release = loaded?.value['release']
  if (typeof release !== 'object' || release === null) {
    return []
  }
  const names = (release as Record<string, unknown>)['publishedPackages']
  if (!Array.isArray(names)) {
    return []
  }
  return names.filter(
    (name): name is string => typeof name === 'string' && name.length > 0,
  )
}

/**
 * The npm name this repo publishes, read from its own manifest. Needed because
 * the release tier registers this step once for EVERY member with no per-repo
 * argument, so the check has to answer "which package is mine" itself rather
 * than failing on a missing name. A private or nameless manifest publishes
 * nothing and yields undefined.
 */
export function publishedNameFromManifest(
  repoRoot: string,
): string | undefined {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
    ) as { name?: unknown | undefined; private?: unknown | undefined }
    if (manifest.private === true || typeof manifest.name !== 'string') {
      return undefined
    }
    return manifest.name
  } catch {
    return undefined
  }
}

/**
 * True when this repo ships nothing to npm, so there is no trusted-publisher
 * binding for it to have. Read from the roster's `publishes` list, the same
 * source `committed-dist-is-current` gates on. An unreadable roster or an
 * unresolvable repo name answers `false`: the caller then takes the normal
 * path, which fails loudly rather than skipping on a guess.
 */
export function repoHasNoNpmChannel(repoRoot: string): boolean {
  const roster = loadRosterFromRepo(repoRoot)
  if (!roster) {
    return false
  }
  const repoName = resolveRepoName(repoRoot)
  if (!repoName) {
    return false
  }
  return !publishesTo(roster, repoName, 'js')
}

export default async function main(): Promise<void> {
  const packages = process.argv.slice(2).filter(a => !a.startsWith('-'))
  if (!packages.length) {
    // The release tier runs this step for every member. A member with no npm
    // channel — a crate, a Go module, a GitHub Action consumed at a tag — has
    // no packument and no binding, so "no names were passed" is the expected
    // state there rather than a missing argument.
    if (repoHasNoNpmChannel(REPO_ROOT)) {
      logger.log(
        '[trusted-publishers-match-source] SKIPPED — this repo publishes nothing to npm, so it has no trusted-publisher binding.',
      )
      return
    }
    // The repo publishes to npm but the caller named nothing, which is how
    // the release tier always invokes this. Derive the names rather than
    // failing. The declared list wins over the manifest: a monorepo that ships
    // an assembled package states the truth in config, and its root manifest —
    // private, and named for the workspace rather than the artifact — would
    // otherwise answer nothing at all.
    const declared = publishedNamesFromConfig(REPO_ROOT)
    const own = declared.length
      ? undefined
      : publishedNameFromManifest(REPO_ROOT)
    if (declared.length) {
      packages.push(...declared)
    } else if (own) {
      packages.push(own)
    } else {
      logger.fail(
        `no packages: this repo publishes to npm, but its package.json names none. Pass the published name explicitly, e.g. @socketregistry/packageurl-js — or, for a monorepo whose root manifest is private and cannot name it, declare \`${PUBLISHED_PACKAGES_CONFIG_KEY}\` in .config/repo/socket-wheelhouse.json.`,
      )
      process.exitCode = 1
      return
    }
  }
  let drifted = 0
  let skipped = 0
  for (let i = 0, { length } = packages; i < length; i += 1) {
    const pkg = packages[i]!
    // eslint-disable-next-line no-await-in-loop -- npm's trust docs ask for serial, spaced reads
    const expected = await expectedRepositoryFor(pkg)
    if (!expected) {
      logger.warn(
        `${pkg}: skipped — the packument carries no GitHub \`repository.url\`, so there is nothing to measure the binding against.`,
      )
      skipped += 1
      continue
    }
    // eslint-disable-next-line no-await-in-loop -- serial by design, see above
    const output = await readTrustList(pkg)
    if (isUnauthenticated(output)) {
      logger.warn(
        `${pkg}: skipped — no npm session reached the registry. Log in with \`node scripts/fleet/npm-web-auth.mts login\` and re-run.`,
      )
      skipped += 1
      continue
    }
    const binding = parseTrustList(output)
    if (!binding.repository && !binding.file && !binding.environment) {
      logger.warn(`${pkg}: skipped — no binding reported.`)
      skipped += 1
      continue
    }
    const drift = findBindingDrift(binding, expected)
    if (drift.length) {
      logger.fail(formatDrift(pkg, drift))
      drifted += 1
      continue
    }
    logger.success(`${pkg}: binding matches ${expected}.`)
  }
  if (drifted) {
    process.exitCode = 1
    return
  }
  if (skipped) {
    logger.warn(
      `${skipped} package(s) unread — this check fails soft so a pipeline never wedges on a 2FA prompt.`,
    )
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    "checks each published package's npm trusted-publisher binding names the repo that publishes it",
  help: 'Usage: node scripts/fleet/check/trusted-publishers-match-source.mts [<pkg>…]',
}

// Guarded: trust-sweep.mts imports `expectedRepositoryFor` from here, and a
// bare call would run the whole check on import.
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
