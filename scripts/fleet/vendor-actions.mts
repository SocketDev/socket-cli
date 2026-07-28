#!/usr/bin/env node
/**
 * @file Pin the third-party GitHub Actions the fleet ports from as `upstream/`
 *   submodule REFERENCES, at each action's LATEST SOAKED release — generalizing
 *   the hand-made `upstream/actions-checkout` entry. These are reference-only:
 *   the fleet lock-step ports ONLY what it needs into its own controlled
 *   `.github/actions/fleet/*` composites and never `uses:` `upstream/*`
 *   directly — the refs are the porting source + drift-watch signal. The
 *   vendored set is the union of the `actions/*` the fleet `uses:` across its
 *   workflows and every upstream the composite port map declares
 *   (`_shared/action-port-map.mts`), so declaring a port IS what provisions its
 *   pin. For every action it resolves the latest release tag — adopted only
 *   once it has soaked for `SOAK_DAYS` — and that tag's commit SHA, upserts a
 *   `[submodule "upstream/<owner>-<repo>"]` block in `.gitmodules` (`shallow`,
 *   single-`branch`, `ignore = dirty`), then runs `gen/gitmodules-hash.mts
 *   --write` to stamp the `# <owner>-<repo>-<version> sha256:<64hex>` archive
 *   content-hash comment that `uses-sha-verify-guard` requires. The `160000`
 *   gitlink is never tracked (`upstream/` is gitignored) — the `ref` +
 *   `sha256:` ARE the pin. Third-party action pins are cascade-owned: this
 *   script IS the generator, so nobody hand-edits the blocks. Re-pinning a
 *   PORTED upstream reds `action-ports-are-lock-stepped` until the composite's
 *   `portedAt` advances with a re-port review — that is the lock-step. Usage:
 *   vendor-actions.mts upsert .gitmodules to the latest soaked pins + stamp
 *   hashes
 *   vendor-actions.mts --check exit 1 if any vendored action is behind its
 *   latest soaked release.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { SOAK_DAYS } from './constants/soak.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import {
  portedUpstreams,
  upstreamSubmoduleName,
} from './_shared/action-port-map.mts'
import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

// The `<owner>/<repo>` actions the fleet `uses:` across its workflows (kept
// sorted). Add a slug here to vendor a directly-consumed action; ported
// upstreams come from the port map and never need a second entry.
const USES_ACTIONS: readonly string[] = [
  'actions/cache',
  'actions/checkout',
  'actions/download-artifact',
  'actions/github-script',
  'actions/setup-node',
  'actions/upload-artifact',
]

// Everything to vendor: the `uses:` surface plus every ported upstream the
// composite port map declares, deduped + sorted.
export const VENDORED_ACTIONS: readonly string[] = [
  ...new Set([...USES_ACTIONS, ...portedUpstreams()]),
].toSorted()

const GITMODULES = path.join(REPO_ROOT, '.gitmodules')

export interface ActionPin {
  slug: string
  sha: string
  tag: string
}

/**
 * Run `gh api <endpoint> --jq <jq>` and return trimmed stdout, or throw a
 * What/Where/Saw/Fix error (fail loud — this is a generator).
 */
export function ghApi(endpoint: string, jq: string): string {
  const result = spawnSync('gh', ['api', endpoint, '--jq', jq], {
    stdio: 'pipe',
  })
  if (result.status !== 0) {
    const stderr =
      typeof result.stderr === 'string'
        ? result.stderr
        : String(result.stderr ?? '')
    throw new Error(
      `gh api ${endpoint} failed.\n` +
        `  Where: vendor-actions resolving a release.\n` +
        `  Saw: exit ${String(result.status ?? '?')} — ${stderr.trim()}\n` +
        `  Fix: check \`gh auth status\` and network access to api.github.com.`,
    )
  }
  const stdout =
    typeof result.stdout === 'string'
      ? result.stdout
      : String(result.stdout ?? '')
  return stdout.trim()
}

/**
 * True when a release published at `publishedAt` has SOAKED — is at least
 * `soakDays` old at `nowMs` — the same doctrine `min-release-age` applies to
 * npm deps. An unparseable/empty timestamp never soaks, so a malformed API
 * row can't fast-track adoption. Pure.
 */
export function isSoaked(
  publishedAt: string,
  nowMs: number,
  soakDays: number = SOAK_DAYS,
): boolean {
  const published = Date.parse(publishedAt)
  if (Number.isNaN(published)) {
    return false
  }
  return published <= nowMs - soakDays * 24 * 60 * 60 * 1000
}

/**
 * The latest release tag for `<owner>/<repo>` — GitHub's own latest semantics,
 * newest stable release — and that tag's COMMIT sha (dereferencing an
 * annotated-tag object to its commit), or undefined when that release has not
 * soaked yet: the current pin then stands until the release clears the soak
 * window, never a downgrade to an older line. Pure w.r.t. inputs; network via
 * ghApi.
 */
export function resolveLatest(slug: string): ActionPin | undefined {
  const raw = ghApi(
    `repos/${slug}/releases/latest`,
    '[.tag_name, .published_at] | @tsv',
  )
  const [tag = '', publishedAt = ''] = raw.split('\t')
  if (!tag || !isSoaked(publishedAt, Date.now())) {
    return undefined
  }
  const refType = ghApi(`repos/${slug}/git/ref/tags/${tag}`, '.object.type')
  const refSha = ghApi(`repos/${slug}/git/ref/tags/${tag}`, '.object.sha')
  const sha =
    refType === 'tag'
      ? ghApi(`repos/${slug}/git/tags/${refSha}`, '.object.sha')
      : refSha
  return { slug, sha, tag }
}

/**
 * The `[submodule …]` block body (no leading content-hash comment — that is
 * `gen/gitmodules-hash --write`'s job) for a vendored action. Tab-indented to
 * match git's `.gitmodules` convention. Pure.
 */
export function blockFor(pin: ActionPin): string {
  const sub = upstreamSubmoduleName(pin.slug)
  const label = sub.slice('upstream/'.length)
  return [
    // The `# <owner>-<repo>-<version>` header gen/gitmodules-hash --write
    // attaches the sha256 to, gitmodules-comment-guard shape. Version tracks
    // the branch.
    `# ${label}-${pin.tag}`,
    `[submodule "${sub}"]`,
    '\tignore = dirty',
    `\tref = ${pin.sha}`,
    `\tpath = ${sub}`,
    `\turl = https://github.com/${pin.slug}.git`,
    `\tbranch = ${pin.tag}`,
    '\tshallow = true',
  ].join('\n')
}

/**
 * The current `ref`/`branch` recorded in `.gitmodules` for a vendored action,
 * or undefined when the action is not vendored yet. Pure.
 */
export function currentPin(
  gitmodules: string,
  slug: string,
): { ref: string; branch: string } | undefined {
  const sub = upstreamSubmoduleName(slug)
  const lines = gitmodules.split('\n')
  const start = lines.findIndex(l => l.trim() === `[submodule "${sub}"]`)
  if (start === -1) {
    return undefined
  }
  let ref = ''
  let branch = ''
  for (let i = start + 1, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.startsWith('[submodule ')) {
      break
    }
    const refMatch = line.match(/^\s*ref\s*=\s*(\S+)/)
    if (refMatch) {
      ref = refMatch[1]!
    }
    const branchMatch = line.match(/^\s*branch\s*=\s*(\S+)/)
    if (branchMatch) {
      branch = branchMatch[1]!
    }
  }
  return { branch, ref }
}

/**
 * True when this repo carries at least one vendored reference block — the
 * enrollment signal the weekly cadence keys on. Members carry no upstream
 * action pins — the record is template-source-owned — so their weekly runs
 * never fabricate vendoring work.
 */
export function vendoringEnrolled(): boolean {
  if (!existsSync(GITMODULES)) {
    return false
  }
  const gitmodules = readFileSync(GITMODULES, 'utf8')
  return VENDORED_ACTIONS.some(slug => currentPin(gitmodules, slug))
}

/**
 * Upsert every action's block into the `.gitmodules` text (update
 * `ref`/`branch` in place when present, append a fresh block when absent),
 * returning the new text. Non-action blocks are left untouched. Pure.
 */
export function upsertAll(
  gitmodules: string,
  pins: readonly ActionPin[],
): string {
  let text = gitmodules
  for (const pin of pins) {
    const sub = upstreamSubmoduleName(pin.slug)
    const lines = text.split('\n')
    const header = lines.findIndex(l => l.trim() === `[submodule "${sub}"]`)
    if (header === -1) {
      text = `${text.replace(/\n+$/, '')}\n\n${blockFor(pin)}\n`
      continue
    }
    // Extend the replaced range back over an existing `# <name>…` header comment
    // and forward to the next comment/submodule, minus trailing blank lines.
    let start = header
    if (start > 0 && lines[start - 1]!.startsWith('#')) {
      start -= 1
    }
    let end = lines.length
    for (let i = header + 1, { length } = lines; i < length; i += 1) {
      const line = lines[i]!
      if (line.startsWith('[submodule ') || line.startsWith('#')) {
        end = i
        break
      }
    }
    while (end > header + 1 && lines[end - 1]!.trim() === '') {
      end -= 1
    }
    lines.splice(start, end - start, blockFor(pin), '')
    text = lines.join('\n')
  }
  return text.replace(/\n{3,}/g, '\n\n')
}

/**
 * Run `gen/gitmodules-hash.mts --write` to (re)stamp the content-hash comments
 * after refs change. Throws on failure, fail loud.
 */
function stampHashes(): void {
  const script = path.join(
    REPO_ROOT,
    'scripts',
    'fleet',
    'gen/gitmodules-hash.mts',
  )
  const result = spawnSync(process.execPath, [script, '--write', GITMODULES], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(
      `gen/gitmodules-hash --write failed (exit ${String(result.status ?? '?')}).\n` +
        `  Where: stamping .gitmodules content-hashes after vendoring.\n` +
        `  Fix: run \`node scripts/fleet/gen/gitmodules-hash.mts --write\` and inspect.`,
    )
  }
}

export function runCheck(): number {
  if (!existsSync(GITMODULES)) {
    logger.fail('[vendor-actions] .gitmodules is missing.')
    return 1
  }
  const gitmodules = readFileSync(GITMODULES, 'utf8')
  const behind: string[] = []
  for (let i = 0, { length } = VENDORED_ACTIONS; i < length; i += 1) {
    const slug = VENDORED_ACTIONS[i]!
    const latest = resolveLatest(slug)
    if (!latest) {
      // Latest release has not soaked yet — the current pin stands until it
      // clears the soak window; never a drift signal.
      continue
    }
    const current = currentPin(gitmodules, slug)
    if (!current) {
      behind.push(`${slug}: not vendored (latest ${latest.tag})`)
    } else if (current.ref !== latest.sha) {
      behind.push(
        `${slug}: ${current.branch} @ ${current.ref.slice(0, 9)} → ${latest.tag} @ ${latest.sha.slice(0, 9)}`,
      )
    }
  }
  if (behind.length) {
    logger.fail(
      [
        `[vendor-actions] ${behind.length} vendored action(s) behind latest:`,
        ...behind.map(b => `  ${b}`),
        '  Fix: run `node scripts/fleet/vendor-actions.mts` to re-pin, then',
        '  re-review each ported composite against the upstream diff and bump',
        '  its portedAt in scripts/fleet/_shared/action-port-map.mts.',
      ].join('\n'),
    )
    return 1
  }
  logger.success(
    '[vendor-actions] all vendored actions pin their latest soaked release.',
  )
  return 0
}

export function runWrite(): number {
  const gitmodules = existsSync(GITMODULES)
    ? readFileSync(GITMODULES, 'utf8')
    : ''
  const pins: ActionPin[] = []
  for (let i = 0, { length } = VENDORED_ACTIONS; i < length; i += 1) {
    const slug = VENDORED_ACTIONS[i]!
    const pin = resolveLatest(slug)
    if (!pin) {
      logger.warn(
        `  ${slug}: latest release has not soaked yet — current pin stands.`,
      )
      continue
    }
    pins.push(pin)
    logger.log(`  ${pin.slug} → ${pin.tag} (${pin.sha.slice(0, 9)})`)
  }
  writeFileSync(GITMODULES, upsertAll(gitmodules, pins))
  stampHashes()
  logger.success(
    `[vendor-actions] vendored ${pins.length} action(s); hashes stamped.`,
  )
  return 0
}

function main(): void {
  try {
    process.exitCode = process.argv.includes('--check')
      ? runCheck()
      : runWrite()
  } catch (e) {
    logger.error(errorMessage(e))
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
