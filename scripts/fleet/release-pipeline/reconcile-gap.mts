/*
 * @file Tag-gap detection for the release-reconcile workflow — the healer for
 *   versions that are LIVE on the registry but have no v* tag / GH release.
 *   Owner promotes happen in the npm web UI, where no local pipeline is
 *   running, so the published version sits tagless until someone reconciles;
 *   this module finds those gaps so CI can heal them automatically.
 *
 *   DEPENDENCY-FREE BY DESIGN: the workflow's gap job runs this on a bare
 *   depth-1 checkout with the runner's preinstalled Node — no pnpm install —
 *   so the cron's common no-gap path stays near-free. Top-level imports are
 *   node builtins + dependency-free fleet modules (constants/npm-registry.mts,
 *   _shared/is-main-module.mts, reconcile-gap-subject.mts) ONLY; anything
 *   heavier loads via dynamic import inside the mode that needs it.
 *
 *   NEVER FALSE-GREEN. Every early return is either a GENUINE no-op with its
 *   reason logged, or a loud non-zero exit. A skip the operator cannot tell
 *   apart from a verified-clean run is the failure this healer exists to
 *   prevent: a `status` output (`gap` / `clean` / `skipped` / `degraded`)
 *   names which one happened, and every non-clean outcome writes the job
 *   summary too, so a degraded run never reads as a healthy one.
 *
 *   Modes:
 *   - default: resolve the repo's npm subject through the SAME workspace
 *     layout resolver the publish engine uses (a private workspace root
 *     redirects to its publishable member — decmpfs publishes
 *     `napi/decmpfs`, not the private root), read that package's PUBLIC
 *     packument + the remote v* tag list, compute the gap set (every
 *     published version missing its tag — not just latest — ratcheted to
 *     versions above the newest existing tag), and emit `has-gap` / `gaps` /
 *     `status` GitHub outputs.
 *   - `--flip <version>`: resolve the version's CONTENT COMMIT — the bump
 *     commit where package.json flipped to that version — via the anchor
 *     logic bump.mts exports (findVersionFlipCommit; dynamic import, needs
 *     node_modules). Emits a `flip` output; a missing flip commit fails LOUD:
 *     the reconcile job must never guess a commit to tag.
 *
 *   Usage: node scripts/fleet/release-pipeline/reconcile-gap.mts [--flip X.Y.Z]
 */

import { execFile } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { NPM_REGISTRY_URL } from '../constants/npm-registry.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { resolveGapSubject } from './reconcile-gap-subject.mts'

const execFileP = promisify(execFile)

// Local repo-root walk instead of importing paths.mts: paths.mts is a
// per-repo VARYING file whose body may pull workspace deps, and this CLI
// must stay loadable on a bare checkout. Same nearest-package.json walk.
function resolveRepoRoot(): string {
  let cur = path.dirname(fileURLToPath(import.meta.url))
  const fsRoot = path.parse(cur).root
  while (cur && cur !== fsRoot) {
    if (existsSync(path.join(cur, 'package.json'))) {
      return cur
    }
    cur = path.dirname(cur)
  }
  throw new Error(
    `Could not resolve repo root from ${fileURLToPath(import.meta.url)}.`,
  )
}

const REPO_ROOT = resolveRepoRoot()

/**
 * Heal at most this many gap versions per run, oldest first. Bounds the
 * reconcile matrix; the next cron continues where this run stopped, so a
 * multi-version backlog drains deterministically instead of fanning out.
 */
export const MAX_RECONCILE_PER_RUN = 5

/**
 * Normalize one `git ls-remote --tags` ref, or a bare tag name, to a plain
 * tag name: strips `refs/tags/` and the `^{}` peeled-annotated suffix.
 */
export function normalizeTagRef(ref: string): string {
  return ref.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '')
}

/**
 * Parse `git ls-remote --tags` stdout into normalized tag names, deduplicated
 * — annotated tags list twice, once peeled.
 */
export function parseLsRemoteTags(stdout: string): string[] {
  const names = new Set<string>()
  const lines = stdout.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const tab = line.indexOf('\t')
    if (tab === -1) {
      continue
    }
    const ref = normalizeTagRef(line.slice(tab + 1).trim())
    if (ref) {
      names.add(ref)
    }
  }
  return [...names]
}

/**
 * Loose semver-ascending comparator, dependency-free: numeric dotted main
 * parts, then a release sorts AFTER its own prereleases, then prerelease
 * strings lexicographically. Deterministic ordering is what matters here —
 * the healer drains oldest-first — not full SemVer precedence fidelity.
 */
export function compareVersionsLoose(a: string, b: string): number {
  const [mainA = '', preA] = a.split('-', 2) as [string, string | undefined]
  const [mainB = '', preB] = b.split('-', 2) as [string, string | undefined]
  const partsA = mainA.split('.').map(n => Number.parseInt(n, 10) || 0)
  const partsB = mainB.split('.').map(n => Number.parseInt(n, 10) || 0)
  const len = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < len; i += 1) {
    const d = (partsA[i] ?? 0) - (partsB[i] ?? 0)
    if (d !== 0) {
      return d
    }
  }
  if (preA === undefined && preB === undefined) {
    return 0
  }
  if (preA === undefined) {
    return 1
  }
  if (preB === undefined) {
    return -1
  }
  return preA < preB ? -1 : preA > preB ? 1 : 0
}

/**
 * The tag gaps: every published version whose `v<version>` tag is absent,
 * RATCHETED to versions above the newest existing v* tag and returned
 * semver-ascending so the oldest gap heals first. The ratchet is what keeps
 * the cron quiet on real repos: fleet members carry pre-convention history —
 * packageurl-js has eight published-but-never-tagged versions below v1.x —
 * whose bump commits may not even exist anymore; re-litigating those every 30
 * minutes would red-loop forever. The heal scenario is always FORWARD: an
 * npm-UI promote lands a version above the newest tag. A repo with no v* tag
 * at all has no ratchet anchor, so every published version is a gap — the
 * first-publish-promoted-in-the-UI case. Pure — the workflow's entire
 * go/no-go decision, unit-tested without network or git.
 */
export function computeTagGaps(config: {
  publishedVersions: readonly string[]
  tagNames: readonly string[]
}): string[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const tags = new Set(cfg.tagNames.map(t => normalizeTagRef(t)))
  const taggedVersions = [...tags]
    .filter(t => /^v\d/.test(t))
    .map(t => t.slice(1))
    .toSorted(compareVersionsLoose)
  const newestTagged = taggedVersions.at(-1)
  return cfg.publishedVersions
    .filter(
      v =>
        !tags.has(`v${v}`) &&
        (newestTagged === undefined ||
          compareVersionsLoose(v, newestTagged) > 0),
    )
    .toSorted(compareVersionsLoose)
}

/**
 * Bound a gap list to the per-run cap: `selected` heals now, oldest first,
 * `deferredCount` says how many wait for the next cron. Pure.
 */
export function capGaps(
  gaps: readonly string[],
  max: number = MAX_RECONCILE_PER_RUN,
): { deferredCount: number; selected: string[] } {
  return {
    deferredCount: Math.max(0, gaps.length - max),
    selected: gaps.slice(0, max),
  }
}

/**
 * One packument read's outcome. The three cases mean genuinely different
 * things to the cron and must never collapse into a single "unreadable":
 *
 * - `live` — the versions that are public right now.
 * - `absent` — a 404: the package has never been published. A GENUINE no-op.
 * - `degraded` — a 5xx, a rate limit, a timeout, a DNS failure. Nothing was
 *   learned this run, so nothing can be claimed about the gap set either.
 */
export type PackumentRead =
  | { kind: 'absent' }
  | { kind: 'degraded'; detail: string }
  | { kind: 'live'; versions: string[] }

/**
 * Published versions from ONE public, unauthenticated abbreviated-packument
 * read — the keys of `versions` list exactly the versions that are live
 * right now; unpublished versions drop out, so the healer can never tag one.
 */
async function fetchPublishedVersions(name: string): Promise<PackumentRead> {
  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(name).replaceAll('%40', '@')}`
  let res: Response
  try {
    // socket-lint: allow global-fetch -- this CLI is dependency-free by
    // design: the workflow's gap job runs it with no pnpm install, so the
    // lib-stable http helpers are out of reach here.
    res = await fetch(url, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    return {
      detail: String(e).split('\n')[0] ?? 'fetch failed',
      kind: 'degraded',
    }
  }
  if (res.status === 404) {
    return { kind: 'absent' }
  }
  if (!res.ok) {
    return { detail: `HTTP ${res.status} from ${url}`, kind: 'degraded' }
  }
  let json: { versions?: Record<string, unknown> | undefined }
  try {
    json = (await res.json()) as {
      versions?: Record<string, unknown> | undefined
    }
  } catch (e) {
    return {
      detail: `unparseable packument body: ${String(e).split('\n')[0]}`,
      kind: 'degraded',
    }
  }
  // A 200 with no `versions` map is a packument shape the healer does not
  // understand — never read it as "nothing published".
  return json.versions
    ? { kind: 'live', versions: Object.keys(json.versions) }
    : {
        detail: `packument for ${name} carries no versions map`,
        kind: 'degraded',
      }
}

/**
 * Remote v* tags via `git ls-remote --tags origin` — the REMOTE truth, which
 * is what the healer compares against; a shallow tag-free local clone is
 * fine. When GITHUB_TOKEN is set the fetch authorizes via a per-invocation
 * extraheader, never persisted config — the fleet checkout action's shape.
 */
async function fetchRemoteTags(repoRoot: string): Promise<string[]> {
  const args: string[] = []
  const token = process.env['GITHUB_TOKEN']
  const serverUrl = process.env['SERVER_URL'] || 'https://github.com'
  if (token) {
    const auth = Buffer.from(`x-access-token:${token}`).toString('base64')
    args.push(
      '-c',
      `http.${serverUrl}/.extraheader=AUTHORIZATION: basic ${auth}`,
    )
  }
  args.push('ls-remote', '--tags', 'origin', 'v*')
  const { stdout } = await execFileP('git', args, {
    cwd: repoRoot,
    maxBuffer: 16 * 1024 * 1024,
  })
  return parseLsRemoteTags(stdout)
}

function emitOutput(name: string, value: string): void {
  const outPath = process.env['GITHUB_OUTPUT']
  if (outPath) {
    appendFileSync(outPath, `${name}=${value}\n`)
    return
  }
  // Local runs have no GITHUB_OUTPUT and want none. Inside Actions its
  // absence is fatal: the reconcile job reads `has-gap` off this file, so a
  // dropped write reads as "no gap" and the healer skips a real one silently.
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    throw new Error(
      `Cannot emit the gap job's "${name}" output: GITHUB_OUTPUT is unset.\n` +
        `  Where: the release-reconcile gap step's environment.\n` +
        `  Saw vs wanted: GITHUB_ACTIONS=true with no GITHUB_OUTPUT path; ` +
        `wanted the runner-provided output file. The reconcile job gates on ` +
        `has-gap, so a dropped write would silently skip a real tag gap.\n` +
        `  Fix: run this step through the standard runner environment — do ` +
        `not clear GITHUB_OUTPUT in the step's env: block.`,
    )
  }
}

function emitSummary(line: string): void {
  const summaryPath = process.env['GITHUB_STEP_SUMMARY']
  if (summaryPath) {
    appendFileSync(summaryPath, `${line}\n`)
  }
}

// Dependency-free stdio: this CLI must run before any pnpm install, so the
// fleet logger is out of reach — hooks-tier process.stdout.write it is.
function say(line: string): void {
  process.stdout.write(`${line}\n`)
}

function fail(line: string): void {
  process.stderr.write(`${line}\n`)
}

/**
 * A run that found no gap to heal. `skipped` is a GENUINE no-op — the repo has
 * nothing on an npm registry to reconcile against, because it declares it does
 * not publish there. `degraded` means the run learned nothing and a gap could
 * exist: a registry or git read failed, or the repo's only registry channel is
 * one the healer has no arm for.
 *
 * A degraded run stays exit-0 on purpose. This is a 30-minute cron on every
 * fleet repo; going red on an npm blip would page the whole fleet and get the
 * schedule auto-disabled. It pays for that with visibility instead — a
 * `status=degraded` output and a job-summary line, so a degraded run can never
 * be mistaken for a verified-clean one on the surfaces an operator reads.
 */
function emitNoGap(status: 'clean' | 'degraded' | 'skipped', reason: string) {
  emitOutput('has-gap', 'false')
  emitOutput('gaps', '[]')
  emitOutput('status', status)
  say(`no tag gap (${status}): ${reason}`)
  if (status !== 'clean') {
    emitSummary(`release-reconcile ${status}: ${reason}`)
  }
}

/**
 * The gap job's whole decision. Takes the repo root so the healer can be
 * driven read-only against any checkout — it reads a registry, reads remote
 * tags, and writes GitHub outputs; it never cuts a tag, pushes, or publishes.
 */
export async function runGapMode(repoRoot: string): Promise<void> {
  const subject = resolveGapSubject(repoRoot)
  if (subject.kind === 'none') {
    emitNoGap(subject.status, subject.reason)
    return
  }
  const packument = await fetchPublishedVersions(subject.name)
  if (packument.kind === 'absent') {
    emitNoGap(
      'skipped',
      `${subject.name} has never been published — no registry history to reconcile against`,
    )
    return
  }
  if (packument.kind === 'degraded') {
    emitNoGap(
      'degraded',
      `packument for ${subject.name} unreadable this run, so no gap set was computed ` +
        `— retrying on the next cron: ${packument.detail}`,
    )
    return
  }
  const published = packument.versions
  let tags: string[]
  try {
    tags = await fetchRemoteTags(repoRoot)
  } catch (e) {
    emitNoGap(
      'degraded',
      `git ls-remote --tags failed this run, so no gap set was computed ` +
        `— retrying on the next cron: ${String(e).split('\n')[0]}`,
    )
    return
  }
  const gaps = computeTagGaps({ publishedVersions: published, tagNames: tags })
  if (!gaps.length) {
    emitNoGap(
      'clean',
      `${subject.name}: no published version above the newest v* tag is missing its tag ` +
        `(${published.length} published)`,
    )
    return
  }
  const { deferredCount, selected } = capGaps(gaps)
  emitOutput('has-gap', 'true')
  emitOutput('gaps', JSON.stringify(selected))
  emitOutput('status', 'gap')
  say(
    `tag gap: ${subject.name} has ${gaps.length} published version${gaps.length === 1 ? '' : 's'} ` +
      `without a v* tag — reconciling ${selected.join(', ')}` +
      (deferredCount ? ` now; ${deferredCount} deferred to the next run` : ''),
  )
  emitSummary(
    `release-reconcile gap: \`${subject.name}\` — ${gaps.join(', ')} published but untagged` +
      (deferredCount ? ` — healing ${selected.length} this run` : ''),
  )
}

async function runFlipMode(version: string): Promise<void> {
  // Dynamic import: bump.mts pulls workspace deps, which exist only after
  // the reconcile job's setup-and-install — never on the gap job's bare
  // checkout.
  const { findVersionFlipCommit } = await import('../bump.mts')
  const flip = await findVersionFlipCommit(version, REPO_ROOT)
  if (!flip) {
    fail(
      `no content commit found for ${version}.\n` +
        `  Where: git log -S over the workspace's version-source manifest from HEAD — the bump commit that flipped version to ${version}.\n` +
        `  Saw: no reachable commit whose version-source manifest reads ${version} while its parent does not.\n` +
        `  Fix: history rewrite or squash removed the bump commit — reconcile this version by hand ` +
        `at the exact published content; the healer never guesses a commit to tag.`,
    )
    process.exitCode = 1
    return
  }
  emitOutput('flip', flip)
  say(flip)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const flipAt = args.indexOf('--flip')
  if (flipAt !== -1) {
    const version = args[flipAt + 1]
    if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      fail(`--flip needs a semver version, saw "${version ?? ''}".`)
      process.exitCode = 1
      return
    }
    await runFlipMode(version)
    return
  }
  await runGapMode(REPO_ROOT)
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    fail(String(e))
    process.exitCode = 1
  })
}
