/**
 * @file Sync this repo's `uses:` pins for socket-registry reusable workflows to
 *   the SHA socket-registry itself pins. A fleet repo's pinned SHA can become
 *   unreachable from socket-registry's `origin/main` — orphaned for any of
 *   several reasons (a superseded cascade commit, a rebased/amended branch,
 *   history cleanup) — and GitHub's `uses:` resolver then 404s it with
 *   "workflow was not found" (incident 2026-06-03: ci.yml@a3f89d93, an orphaned
 *   commit, broke CI fleet-wide). The fix is independent of the cause: repin to
 *   whatever reachable SHA socket-registry currently declares. The source of
 *   truth for "the reachable SHA for reusable workflow <w>" is
 *   socket-registry's own `.github/workflows/_local-not-for-reuse-<w>.yml` —
 *   the local caller it uses to self-test, always pinned to a live commit. This
 *   script reads those `_local-*` pins and repins every
 *   `SocketDev/socket-registry/.github/workflows/<w>.yml@<sha>` line in this
 *   repo's workflows to match (with the canonical `# main (YYYY-MM-DD)`
 *   comment). Usage: node scripts/fleet/sync-registry-workflow-pins.mts #
 *   report drift, exit 1 if any node
 *   scripts/fleet/sync-registry-workflow-pins.mts --fix # rewrite pins in place
 *   node scripts/fleet/sync-registry-workflow-pins.mts --quiet # suppress the
 *   clean-state line.
 */

// prefer-async-spawn: sync-required — top-level CLI; sequential gh fetches +
// file rewrites with exit-code aggregation.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

// git context vars a hook (or a parent git invocation) exports. Any git command
// we run against a DIFFERENT repo via `-C` must drop these, or it will operate
// on the ambient repo's index/objects/worktree instead — under a pre-commit
// hook, `GIT_INDEX_FILE`/`GIT_DIR` point at THIS repo, corrupting a sibling-repo
// or temp-repo git op ("invalid object … Error building trees").
const GIT_CONTEXT_VARS = [
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_WORK_TREE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_PREFIX',
] as const

/**
 * A copy of process.env with the inherited git-context vars stripped, so a git
 * command run against another repo via `-C` resolves that repo's own git dir.
 */
export function gitEnvForOtherRepo(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (let i = 0, { length } = GIT_CONTEXT_VARS; i < length; i += 1) {
    delete env[GIT_CONTEXT_VARS[i]!]
  }
  return env
}

const REGISTRY = 'SocketDev/socket-registry'
// The reusable workflows a fleet repo references from socket-registry. Each has
// a matching `_local-not-for-reuse-<name>.yml` self-caller that pins the live SHA.
export const REUSABLE_WORKFLOWS = ['ci', 'provenance', 'weekly-update']

export interface RegistryPin {
  sha: string
  comment: string
}

/**
 * `<repo>/.github/workflows/<workflow>.yml@<40-hex>` with an optional trailing
 * `# main (YYYY-MM-DD)` comment, captured per workflow name.
 */
export function pinLineRe(workflow: string): RegExp {
  return new RegExp(
    `(SocketDev/socket-registry/\\.github/workflows/${workflow}\\.yml@)[0-9a-f]{40}([^\\n]*)`,
  )
}

/**
 * Locate a sibling socket-registry checkout next to this repo, or `undefined`
 * when absent. A path lookup (not an import) is unavoidable: the goal is to
 * read another repo's on-disk workflow files, which no package import exposes.
 * socket-registry is public, so the API fallback in `readLocalPin` covers the
 * no-checkout case. (The reverse — socket-registry syncing the PRIVATE
 * wheelhouse — must stay local-only; there is no API fallback for a private
 * repo.)
 */
export function findRegistryCheckout(
  repoRoot: string = REPO_ROOT,
): string | undefined {
  // socket-lint: allow cross-repo -- locating a sibling checkout by path is the function's purpose.
  const sibling = path.join(path.dirname(repoRoot), 'socket-registry')
  return existsSync(path.join(sibling, '.github', 'workflows'))
    ? sibling
    : undefined
}

/**
 * Extract the `<workflow>.yml@<sha>` pin (+ trailing `# main (date)` comment)
 * from a `_local-not-for-reuse-<workflow>.yml`'s text. Pure — used by both the
 * local-checkout and API readers. Returns undefined when no pin matches.
 */
export function parseLocalPin(
  workflow: string,
  content: string,
): RegistryPin | undefined {
  const m = new RegExp(
    `socket-registry/\\.github/workflows/${workflow}\\.yml@([0-9a-f]{40})(\\s*#[^\\n]*)?`,
  ).exec(content)
  if (!m) {
    return undefined
  }
  return { sha: m[1]!, comment: (m[2] ?? '').trim() }
}

/**
 * Read `_local-not-for-reuse-<workflow>.yml` from a sibling checkout AT
 * `origin/main`, never from the working tree. This is the orphan guard: a
 * behind/dirty/detached working tree can hold a `_local` pin that points at a
 * since-orphaned SHA, and repinning the fleet to THAT would re-break CI. The
 * pin `_local` declares on `origin/main` is reachable-by-construction (the same
 * cascade that advances the workflows updates `_local` in the same commit), so
 * reading it at the ref — after refreshing the remote-tracking ref — yields a
 * SHA we can trust. Returns undefined when there's no checkout, no remote ref,
 * or the file/pin is absent at the ref (caller falls back to the API).
 */
// Checkouts whose origin/main we've already refreshed this process. A
// fleet-wide cascade resolves the same socket-registry checkout once per
// repo (16+ times); without this guard each call re-runs `git fetch` —
// 16 serialized network round-trips on the same .git lock. Fetch once.
const fetchedCheckouts = new Set<string>()

export function readLocalPinFromGit(
  workflow: string,
  registryCheckout: string,
): RegistryPin | undefined {
  const relPath = `.github/workflows/_local-not-for-reuse-${workflow}.yml`
  // Refresh the remote-tracking ref ONCE per checkout per process so a
  // long-lived checkout doesn't read a stale origin/main. Best-effort:
  // offline → keep the cached ref.
  if (!fetchedCheckouts.has(registryCheckout)) {
    fetchedCheckouts.add(registryCheckout)
    spawnSync(
      'git',
      ['-C', registryCheckout, 'fetch', '--quiet', 'origin', 'main'],
      { env: gitEnvForOtherRepo() },
    )
  }
  const r = spawnSync(
    'git',
    ['-C', registryCheckout, 'show', `origin/main:${relPath}`],
    { env: gitEnvForOtherRepo() },
  )
  if (r.status !== 0) {
    return undefined
  }
  return parseLocalPin(workflow, String(r.stdout))
}

/**
 * Read the pin socket-registry's `_local-not-for-reuse-<workflow>.yml`
 * declares. Source order, each yielding a reachable SHA by construction:
 *
 * 1. Sibling checkout at `origin/main` (offline-friendly, no rate limit), via
 *    `readLocalPinFromGit` — the orphan guard, reads the ref not the worktree;
 * 2. The GitHub contents API at `main` (no checkout, or no remote ref). Returns
 *    undefined when no source yields the file/pin.
 */
export function readLocalPin(
  workflow: string,
  registryCheckout: string | undefined = findRegistryCheckout(),
): RegistryPin | undefined {
  // 1. Sibling checkout, read at origin/main (not the working tree).
  if (registryCheckout) {
    const fromGit = readLocalPinFromGit(workflow, registryCheckout)
    if (fromGit) {
      return fromGit
    }
  }
  // 2. GitHub contents API. `ref` must be a URL query param for the GET
  // contents API; `gh api -f` would send it as a body field (ignored → 404).
  const relPath = `.github/workflows/_local-not-for-reuse-${workflow}.yml`
  const r = spawnSync(
    'gh',
    [
      'api',
      `repos/${REGISTRY}/contents/${relPath}?ref=main`,
      '--jq',
      '.content',
    ],
    {},
  )
  if (r.status !== 0) {
    return undefined
  }
  const content = Buffer.from(String(r.stdout), 'base64').toString('utf8')
  return parseLocalPin(workflow, content)
}

/**
 * List `.github/workflows/*.yml` in the repo (absolute paths). Empty when the
 * dir is absent.
 */
export function listWorkflowFiles(repoRoot: string): string[] {
  const dir = path.join(repoRoot, '.github', 'workflows')
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (name.endsWith('.yml') || name.endsWith('.yaml')) {
      out.push(path.join(dir, name))
    }
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- `out` is a locally-built array (just filled via .push() in the loop above), so the in-place sort can't mutate a shared receiver; .toSorted() would trip socket/no-runtime-features-below-engine-floor in cascaded Node-18 repos.
  return out.sort()
}

export interface PinDrift {
  file: string
  workflow: string
  currentSha: string
  wantedSha: string
}

export interface ReconcilePinsOptions {
  // When true, rewrite drifted pins in place; otherwise report-only.
  fix?: boolean | undefined
}

/**
 * Rewrite (or, in report mode, collect) every registry-reusable pin in `files`
 * to match `pins`. Returns the drift it found (whether or not it was fixed).
 */
export function reconcilePins(
  files: readonly string[],
  pins: ReadonlyMap<string, RegistryPin>,
  options?: ReconcilePinsOptions | undefined,
): PinDrift[] {
  const { fix = false } = {
    __proto__: null,
    ...options,
  } as ReconcilePinsOptions
  const drift: PinDrift[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    let text = readFileSync(file, 'utf8')
    let changed = false
    for (let w = 0, wl = REUSABLE_WORKFLOWS.length; w < wl; w += 1) {
      const workflow = REUSABLE_WORKFLOWS[w]!
      const pin = pins.get(workflow)
      if (!pin) {
        continue
      }
      const re = pinLineRe(workflow)
      const match = re.exec(text)
      if (!match) {
        continue
      }
      const currentSha = /@([0-9a-f]{40})/.exec(match[0])![1]!
      if (currentSha === pin.sha) {
        continue
      }
      drift.push({ currentSha, file, wantedSha: pin.sha, workflow })
      if (fix) {
        const replacement = `${match[1]}${pin.sha}${pin.comment ? ` ${pin.comment}` : ''}`
        text = text.replace(re, replacement)
        changed = true
      }
    }
    if (changed) {
      writeFileSync(file, text)
    }
  }
  return drift
}

// Per-checkout memo of the resolved `_local` pin map. The SHAs don't change
// within a single cascade run, and a fleet-wide cascade calls this once per
// repo against the same socket-registry checkout — memoizing turns N reads
// (+ N API fallbacks when there's no checkout) into one.
const registryPinsCache = new Map<string, Map<string, RegistryPin>>()

/**
 * Build the `_local` pin map (one read of socket-registry's `_local-*` files,
 * local checkout first then API), memoized per checkout for the process.
 * Returns an empty map when no pin resolves.
 */
export function loadRegistryPins(
  registryCheckout?: string | undefined,
): Map<string, RegistryPin> {
  const cacheKey = registryCheckout ?? '<api>'
  const cached = registryPinsCache.get(cacheKey)
  if (cached) {
    return cached
  }
  const pins = new Map<string, RegistryPin>()
  for (let i = 0, { length } = REUSABLE_WORKFLOWS; i < length; i += 1) {
    const workflow = REUSABLE_WORKFLOWS[i]!
    const pin = readLocalPin(workflow, registryCheckout)
    if (pin) {
      pins.set(workflow, pin)
    }
  }
  registryPinsCache.set(cacheKey, pins)
  return pins
}

function main(): void {
  const argv = process.argv.slice(2)
  const fix = argv.includes('--fix')
  const quiet = argv.includes('--quiet')

  const pins = loadRegistryPins()
  if (pins.size === 0) {
    logger.fail(
      '[sync-registry-workflow-pins] no _local pins resolved (gh auth / network?); cannot sync.',
    )
    process.exitCode = 1
    return
  }

  const files = listWorkflowFiles(REPO_ROOT)
  const drift = reconcilePins(files, pins, { fix })

  if (!drift.length) {
    if (!quiet) {
      logger.success(
        `[sync-registry-workflow-pins] all socket-registry reusable pins match the _local SHAs.`,
      )
    }
    return
  }

  for (let i = 0, { length } = drift; i < length; i += 1) {
    const d = drift[i]!
    const rel = path.relative(REPO_ROOT, d.file)
    if (fix) {
      logger.log(
        `  repinned ${d.workflow} in ${rel}: ${d.currentSha.slice(0, 8)} → ${d.wantedSha.slice(0, 8)}`,
      )
    } else {
      logger.error(
        `  ✗ ${rel}: ${d.workflow}.yml pinned ${d.currentSha.slice(0, 8)}, _local says ${d.wantedSha.slice(0, 8)}`,
      )
    }
  }
  if (!fix) {
    logger.error(
      'Run `node scripts/fleet/sync-registry-workflow-pins.mts --fix` to repin.',
    )
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPathSafe(import.meta.url)) {
  main()
}

/**
 * `fileURLToPath(import.meta.url)` without importing `node:url` at the top —
 * keeps the module import-side-effect-free for the unit test (which imports the
 * pure helpers without triggering `main()`).
 */
function fileURLToPathSafe(url: string): string {
  return url.startsWith('file://') ? new URL(url).pathname : url
}
