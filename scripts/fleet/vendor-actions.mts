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

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { SOAK_DAYS } from './constants/soak.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { writeThroughMirrorLock } from './_shared/mirror-lock.mts'
import {
  portedUpstreams,
  upstreamSubmoduleName,
} from './_shared/action-port-map.mts'
import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

// The `<owner>/<repo>` actions the fleet `uses:` across its workflows (kept
// sorted). Add a slug here to vendor a directly-consumed action; ported
// upstreams come from the port map and never need a second entry.
//
// 🚨 This list must stay COMPLETE. Anything the fleet `uses:` that is missing
// here falls outside the vendored union, and `pruneOrphanUpstreams` reads that
// as a retired action and DELETES its pin. `actions/setup-go` was exactly that
// case — consumed by template/presets/.github/workflows/go-publish.yml and
// pinned in .gitmodules, but absent here until the prune surfaced it. When
// adding a `uses:` to a workflow, add its slug here too; the allowlist in
// auditing-gha/canonical-patterns.mts is the cross-check for what is consumed.
const USES_ACTIONS: readonly string[] = [
  'actions/cache',
  'actions/checkout',
  'actions/download-artifact',
  'actions/github-script',
  'actions/setup-go',
  'actions/setup-node',
  'actions/upload-artifact',
]

// Everything to vendor: the `uses:` surface plus every ported upstream the
// composite port map declares, deduped + sorted.
export const VENDORED_ACTIONS: readonly string[] = [
  ...new Set([...USES_ACTIONS, ...portedUpstreams()]),
].toSorted()

// `upstream/*` submodule names this script does NOT own, and must never prune.
// Everything else under `upstream/` is an action pin it generates, so anything
// outside the vendored union is a retired action whose block should go.
// Empty today: every block in the fleet's `.gitmodules` is an action pin. The
// anticipated first entries are the copyleft tests-only slices from
// `_shared/copyleft-upstreams.mts`, which a different provisioning path writes
// and whose slugs will never appear in the union.
export const UNMANAGED_UPSTREAMS: readonly string[] = []

const GITMODULES = path.join(REPO_ROOT, '.gitmodules')

export interface ActionPin {
  // The `# no-release-tag: <why>` reason, set only for a branch-pinned
  // upstream. Absent means the pin is a real release tag.
  noReleaseTag?: string | undefined
  slug: string
  sha: string
  // The release tag, or the BRANCH name for a no-release-tag upstream.
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

// Upstreams that publish no usable release tag, mapped to WHY. These are
// pinned to a timestamped default-branch SHA instead, and the reason is
// emitted as the block's `# no-release-tag:` annotation.
export const NO_RELEASE_TAG_UPSTREAMS: Readonly<Record<string, string>> = {
  'dtolnay/rust-toolchain':
    'ships from branch refs; its one tag (v1) moves, so pinning it by hash would record a commit the tag stops reaching',
}

/**
 * Pin a no-release-tag upstream to its default branch's current head.
 *
 * Only ever called when the block is ABSENT. A branch head moves, so
 * re-resolving it on every run would advance the pin underneath the port and
 * red the lock-step check continuously; an existing branch pin stands until a
 * human re-reviews the port and bumps `portedSha`/`portedOn` with it — the
 * same "current pin stands" rule the unsoaked-release path follows. Network
 * via ghApi.
 */
export function resolveBranchPin(slug: string): ActionPin | undefined {
  const branch = ghApi(`repos/${slug}`, '.default_branch')
  if (!branch) {
    return undefined
  }
  const sha = ghApi(`repos/${slug}/commits/${branch}`, '.sha')
  if (!sha) {
    return undefined
  }
  return {
    noReleaseTag: NO_RELEASE_TAG_UPSTREAMS[slug],
    slug,
    sha,
    tag: branch,
  }
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
    // A branch pin declares WHY it has no tag; the release-tagged check reads
    // this annotation as the escape from its tag rule.
    ...(pin.noReleaseTag ? [`# no-release-tag: ${pin.noReleaseTag}`] : []),
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
 * Drop the `upstream/*` blocks whose action left the vendored union — a
 * composite that stopped declaring a port, or an action the last workflow
 * stopped using. Without this the retired pin lingers and reds
 * `upstream-submodules-are-release-tagged` against a reference nothing wants.
 *
 * `keepSlugs` is the WANTED universe (`VENDORED_ACTIONS`), never the resolved
 * pins: an action whose latest release has not soaked yet resolves to no pin,
 * and pruning on that would delete a live reference mid-soak.
 *
 * Blocks named in `UNMANAGED_UPSTREAMS`, and every block outside `upstream/`,
 * are left alone. Returns the new text plus the names dropped so the caller
 * reports them rather than deleting silently. Pure.
 */
export function pruneOrphanUpstreams(
  gitmodules: string,
  keepSlugs: readonly string[],
): { pruned: string[]; text: string } {
  const keep = new Set(keepSlugs.map(slug => upstreamSubmoduleName(slug)))
  const pruned: string[] = []
  const lines = gitmodules.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\[submodule "(upstream\/[^"]+)"\]$/.exec(lines[i]!.trim())
    if (!match) {
      continue
    }
    const name = match[1]!
    if (keep.has(name) || UNMANAGED_UPSTREAMS.includes(name)) {
      continue
    }
    // Same range walk as upsertAll: back over the `# <name>-<tag>` header
    // comment, forward to the next comment/submodule, minus trailing blanks.
    let start = i
    if (start > 0 && lines[start - 1]!.startsWith('#')) {
      start -= 1
    }
    let end = lines.length
    for (let j = i + 1, { length } = lines; j < length; j += 1) {
      const line = lines[j]!
      if (line.startsWith('[submodule ') || line.startsWith('#')) {
        end = j
        break
      }
    }
    while (end > i + 1 && lines[end - 1]!.trim() === '') {
      end -= 1
    }
    lines.splice(start, end - start)
    pruned.push(name)
    // The splice pulled later lines back over the cursor; re-scan from here.
    i = start - 1
  }
  return {
    pruned,
    text: `${lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\n+$/, '')}\n`,
  }
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
    if (slug in NO_RELEASE_TAG_UPSTREAMS) {
      // No usable release tag, so the pin is a branch SHA. Take one only when
      // the block is absent — a branch head moves, and re-resolving it here
      // would advance the pin underneath the port on every run.
      if (currentPin(gitmodules, slug)) {
        logger.log(`  ${slug} → branch pin stands (no release tag)`)
        continue
      }
      const branchPin = resolveBranchPin(slug)
      if (!branchPin) {
        logger.warn(`  ${slug}: could not resolve a default-branch head.`)
        continue
      }
      pins.push(branchPin)
      logger.log(
        `  ${branchPin.slug} → ${branchPin.tag} @ ${branchPin.sha.slice(0, 9)} (no release tag)`,
      )
      continue
    }
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
  const { pruned, text } = pruneOrphanUpstreams(gitmodules, VENDORED_ACTIONS)
  for (let i = 0, { length } = pruned; i < length; i += 1) {
    logger.log(`  ${pruned[i]!} → pruned, no longer vendored`)
  }
  writeThroughMirrorLock(GITMODULES, upsertAll(text, pins))
  stampHashes()
  logger.success(
    `[vendor-actions] vendored ${pins.length} action(s)` +
      `${pruned.length ? `, pruned ${pruned.length}` : ''}; hashes stamped.`,
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
