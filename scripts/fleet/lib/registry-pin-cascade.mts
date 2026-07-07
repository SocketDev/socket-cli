/*
 * @file Reusable fundamentals for the socket-registry shared-workflow SHA
 *   cascade, DRY'd out of the upstream writer so every consumer resolves a
 *   propagation SHA, walks the workflow YAML, and rewrites the pins the same
 *   way. This pairs with the cascade's other reusable piece, the green-gate
 *   `assertPropagationShaIsGreen` in `scripts/fleet/lib/registry-ci-gate.mts`.
 *
 *   Everything here is self-contained — it spawns `git` directly via the lib (no
 *   `scripts/repo/shared.mts` import) and takes the registry checkout dir as a
 *   `registryDir` argument (no hard import of the wheelhouse-relative sibling
 *   path) so it resolves byte-identically in every fleet repo the cascade
 *   mirrors it into, and so the `cascade-shared-workflow-shas` override script
 *   imports it without a deep cross-tier reach into wheelhouse-only `scripts/repo/`.
 *
 *   Exports:
 *   - `resolvePropagationSha` — the SHA-resolution contract (explicit `--sha`
 *     override, else `git rev-parse origin/main` after a quiet fetch).
 *   - `walkYamlFiles` — recursively list `.yml`/`.yaml` files under a dir.
 *   - `rewriteRegistryPinsByDiff` — rewrite `SocketDev/socket-registry/...@<sha>`
 *     `uses:` pins to a new SHA, but only for pins whose pinned subtree's content
 *     differs (or whose old SHA is orphaned/unreachable).
 *   - `runGit` — throw-on-nonzero git runner the writer uses to stage + commit.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

// oxlint-disable-next-line socket/prefer-async-spawn -- cascade script needs sync stdin/stdout + typed string return; v5 lib spawnSync omits 'encoding' from SpawnSyncOptions and returns string-or-Buffer. v6 lib (when published) will obviate this.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

// Matches a socket-registry uses: pin, capturing the sub-path and the SHA.
// `SocketDev\/socket-registry` — literal org/repo prefix
// `(\/[^@\s]+)` — group 1: sub-path starting with `/`, no `@` or whitespace
// `@` — literal separator between path and commit SHA
// `([a-f0-9]{40})` — group 2: exactly 40 hex chars (full git SHA)
// Same pattern as registry's cascade-workflows.mts so both scripts agree.
export const REGISTRY_PIN_RE = // group 1: sub-path `(\/[^@\s]+)`; group 2: 40-hex SHA `([a-f0-9]{40})`
  /SocketDev\/socket-registry(\/[^@\s]+)@([a-f0-9]{40})/g

export interface ResolvePropagationShaOptions {
  // Explicit 40-char SHA to pin against. When set, the fetch + rev-parse is
  // skipped and this SHA is returned verbatim (the caller has already
  // validated its shape). Maps to the writer's `--sha <sha>` flag.
  explicit?: string | undefined
}

export interface RewritePinsOptions {
  // When true, compute + report what would change but write nothing to disk.
  dryRun?: boolean | undefined
}

/**
 * Run a git command in `cwd`, returning trimmed stdout. Throws loud (What /
 * Where / Saw) on a non-zero exit so a failed stage/commit never silently
 * no-ops. Self-contained so the override writer doesn't reach into
 * wheelhouse-only `scripts/repo/shared.mts` for the same helper.
 */
export function runGit(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd })
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed in ${cwd}: ${String(r.stderr).trim()}`,
    )
  }
  return String(r.stdout).trim()
}

/**
 * Resolve the socket-registry SHA a cascade should pin to. Returns `explicit`
 * verbatim when provided; otherwise fetches `origin/main` (quiet, without
 * mutating the checkout's local main — a cascade operator may be on a feature
 * branch) and returns its rev-parse. Throws loud on a failed fetch or rev-parse
 * so a stale remote can never silently resolve to an outdated SHA.
 */
export function resolvePropagationSha(
  registryDir: string,
  options?: ResolvePropagationShaOptions | undefined,
): string {
  const { explicit } = {
    __proto__: null,
    ...options,
  } as ResolvePropagationShaOptions
  if (explicit) {
    return explicit
  }
  const f = spawnSync('git', ['fetch', 'origin', 'main', '--quiet'], {
    cwd: registryDir,
  })
  if (f.status !== 0) {
    throw new Error(
      `git fetch origin main failed in ${registryDir}: check the remote.`,
    )
  }
  const r = spawnSync('git', ['rev-parse', 'origin/main'], { cwd: registryDir })
  if (r.status !== 0) {
    throw new Error(
      `git rev-parse origin/main failed in ${registryDir}: ${String(r.stderr).trim()}`,
    )
  }
  return String(r.stdout).trim()
}

/**
 * Recursively list every `.yml`/`.yaml` file under `rootDir`.
 */
export async function walkYamlFiles(rootDir: string): Promise<string[]> {
  const out: string[] = []
  async function recurse(d: string): Promise<void> {
    if (!existsSync(d)) {
      return
    }
    const entries = await fs.readdir(d, { withFileTypes: true })
    // Walk sibling entries in parallel — subdirectory recursion was
    // previously serialized via `for await`, so each subdir blocked
    // the next. Disk-bound walk, no shared mutable state per recursion,
    // so Promise.all is safe and trivially faster on the
    // `.github/workflows/` tree.
    await Promise.all(
      entries.map(async e => {
        const p = path.join(d, e.name)
        if (e.isDirectory()) {
          await recurse(p)
        } else if (e.name.endsWith('.yml') || e.name.endsWith('.yaml')) {
          out.push(p)
        }
      }),
    )
  }
  await recurse(rootDir)
  return out
}

// True when `sha` resolves to a commit object in `registryDir`. Orphaned pins
// (unreachable from origin/main) fail this — `git cat-file -e <sha>^{commit}`
// exits non-zero — which is the signal `pinSubtreeChanged` uses to force a
// rewrite instead of crashing on `git diff`'s exit 128.
export function isResolvableCommit(registryDir: string, sha: string): boolean {
  return (
    spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
      cwd: registryDir,
    }).status === 0
  )
}

// True when `<pinPath>` differs between `oldSha` and `newSha` in the
// registry repo. Skips bumps for pins to subtrees that didn't change.
//
// Memoized per-run: across the fleet's workflow tree, the same
// (pinPath, oldSha, newSha) triple is hit by every workflow that
// pins to it (the registry SHA cascades into N consumer workflows).
// One `git diff` per distinct triple is enough.
const pinSubtreeChangedCache = new Map<string, boolean>()

export function pinSubtreeChanged(
  registryDir: string,
  pinPath: string,
  oldSha: string,
  newSha: string,
): boolean {
  if (oldSha === newSha) {
    return false
  }
  const key = `${pinPath}\0${oldSha}\0${newSha}`
  const cached = pinSubtreeChangedCache.get(key)
  if (cached !== undefined) {
    return cached
  }
  const r = spawnSync(
    'git',
    ['diff', '--quiet', oldSha, newSha, '--', pinPath],
    { cwd: registryDir },
  )
  let result: boolean
  if (r.status === 0) {
    result = false
  } else if (r.status === 1) {
    result = true
  } else if (!isResolvableCommit(registryDir, oldSha)) {
    // `oldSha` is orphaned — unreachable from origin/main (a superseded
    // cascade commit, a rebased/amended branch, history cleanup). git diff
    // can't resolve it (exit 128), and the consumer's `uses:` ref pointed at
    // it 404s ("workflow was not found", incident 2026-06-03). Force the
    // rewrite: an orphaned pin must always be bumped to the reachable newSha,
    // regardless of subtree content.
    result = true
  } else {
    throw new Error(
      `git diff ${oldSha.slice(0, 8)}..${newSha.slice(0, 8)} -- ` +
        `${pinPath} exited ${r.status}`,
    )
  }
  pinSubtreeChangedCache.set(key, result)
  return result
}

interface PinHit {
  pinPath: string
  sha: string
  shaStart: number
}

/**
 * Rewrite registry pins in `files` to `newSha`, only for pins whose pinned
 * subtree's content differs between current and `newSha` (resolved against
 * `registryDir`). Returns count of pins rewritten and set of files touched.
 * When `dryRun` is true, computes counts without writing — same diff decisions,
 * just observed instead of applied.
 */
export async function rewriteRegistryPinsByDiff(
  registryDir: string,
  files: string[],
  newSha: string,
  options?: RewritePinsOptions | undefined,
): Promise<{ pinsRewritten: number; filesTouched: Set<string> }> {
  const { dryRun = false } = {
    __proto__: null,
    ...options,
  } as RewritePinsOptions
  // Parallelize the read + scan + write per file. pinSubtreeChanged is
  // memoized across calls (see pinSubtreeChangedCache above), so
  // multiple files hitting the same pin only run `git diff` once.
  // Sequential git invocations remain serialized inside spawnSync,
  // but each file's parse + write fans out.
  const perFileResults = await Promise.all(
    files.map(async f => {
      const text = await fs.readFile(f, 'utf8')
      // Per-call regex object — RegExp.lastIndex isn't safe to share
      // across concurrent matchAll iterations on the same RegExp.
      const re = new RegExp(REGISTRY_PIN_RE.source, REGISTRY_PIN_RE.flags)
      const hits: PinHit[] = []
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        hits.push({
          pinPath: m[1]!.replace(/^\//, ''),
          sha: m[2]!,
          shaStart: m.index + m[0].length - m[2]!.length,
        })
      }
      if (hits.length === 0) {
        return { file: f, staleCount: 0, touched: false }
      }
      const stale = hits.filter(h =>
        pinSubtreeChanged(registryDir, h.pinPath, h.sha, newSha),
      )
      if (stale.length === 0) {
        return { file: f, staleCount: 0, touched: false }
      }
      if (!dryRun) {
        let next = text
        // Right-to-left so earlier offsets stay valid.
        for (const h of [...stale].toSorted(
          (a, b) => b.shaStart - a.shaStart,
        )) {
          next =
            next.slice(0, h.shaStart) + newSha + next.slice(h.shaStart + 40)
        }
        await fs.writeFile(f, next)
      }
      return { file: f, staleCount: stale.length, touched: true }
    }),
  )
  let pinsRewritten = 0
  const filesTouched = new Set<string>()
  for (let i = 0, { length } = perFileResults; i < length; i += 1) {
    const r = perFileResults[i]!
    pinsRewritten += r.staleCount
    if (r.touched) {
      filesTouched.add(r.file)
    }
  }
  return { pinsRewritten, filesTouched }
}
