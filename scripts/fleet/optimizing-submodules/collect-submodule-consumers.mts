/*
 * Collect the consumer evidence the optimizing-submodules skill needs to
 * classify each `.gitmodules` submodule — WITHOUT rendering a verdict.
 *
 * The skill's determination step is judgment (subtree-consumed vs reference-only
 * vs whole-tree). But the GATHER that feeds the judgment is deterministic, and
 * the documented false-verdict trap — counting the submodule's own internal
 * self-references as consumption — is a hand-discipline that a script should own
 * instead. This collector does exactly the mechanical half:
 *
 *   1. For each submodule, `rg` the repo for references to `upstream/<name>/`
 *      (the submodule's own `path =`).
 *   2. Apply the OUTSIDE-ONLY filter: drop every hit whose file path is inside
 *      the submodule's own directory (the internal-self-reference trap, now code
 *      not a hand-check). The dropped count is reported as `internalHitCount`.
 *   3. Bucket the surviving (outside) hits by the skill's fixed file-type roster
 *      (rust / cpp / go / jsts / testCorpus / build / other).
 *   4. Report each submodule's current sparse/verify state + on-disk tree size.
 *
 * It renders NO verdict — no subtree-consumed / reference-only / whole-tree
 * label, no proposed sparse pattern. That is the model's job, from this
 * evidence. Output is a JSON envelope (stdout); `--pretty` adds a human table.
 *
 * Reuses parseBlocks + SubmoduleBlock from verify-submodule-sparse.mts (the
 * one owner of `.gitmodules` parsing) rather than re-parsing.
 *
 * Usage:
 *   node scripts/fleet/optimizing-submodules/collect-submodule-consumers.mts [<.gitmodules>]
 *   node ...collect-submodule-consumers.mts --name <submodule>   # scope to one
 *   node ...collect-submodule-consumers.mts --path upstream/foo  # scope to one
 *   node ...collect-submodule-consumers.mts --pretty             # + human table
 */

import path from 'node:path'
import process from 'node:process'
import { existsSync, readFileSync } from 'node:fs'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { parseBlocks } from '../verify-submodule-sparse.mts'
import type { SubmoduleBlock } from '../verify-submodule-sparse.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// The file-type buckets the skill's "Determine" step enumerates. Each is a set
// of basenames (or a basename predicate) that signals a particular consumption
// shape. A surviving outside-hit file is bucketed by its basename; anything
// unmatched lands in `other`.
export type ConsumerBucket =
  | 'rust'
  | 'cpp'
  | 'go'
  | 'jsts'
  | 'testCorpus'
  | 'build'
  | 'other'

export interface ConsumerBuckets {
  rust: string[]
  cpp: string[]
  go: string[]
  jsts: string[]
  testCorpus: string[]
  build: string[]
  other: string[]
}

export interface SubmoduleConsumers {
  name: string
  path: string | undefined
  currentSparse: string | undefined
  currentVerify: string | undefined
  internalHitCount: number
  outsideHits: ConsumerBuckets
}

export interface CollectResult {
  submodules: SubmoduleConsumers[]
}

// Classify a hit file (a repo-relative path) into one bucket by its basename +
// path shape. Pure — the unit of the bucketing, tested directly.
export function bucketForFile(relPath: string): ConsumerBucket {
  const base = path.basename(relPath)
  // Normalize to forward slashes so the path-shape tests are separator-agnostic.
  const unix = normalizePath(relPath)
  if (base === 'build.rs' || base === 'Cargo.toml') {
    return 'rust'
  }
  if (base === 'binding.gyp' || base === 'CMakeLists.txt') {
    return 'cpp'
  }
  if (base === 'go.mod' || base === 'go.sum') {
    return 'go'
  }
  if (
    base === 'package.json' ||
    /\.[cm]?[jt]s$/u.test(base) ||
    base.includes('vitest')
  ) {
    return 'jsts'
  }
  if (unix.startsWith('test/') || unix.includes('/test/')) {
    return 'testCorpus'
  }
  if (unix.startsWith('scripts/') || unix.includes('/scripts/')) {
    return 'build'
  }
  return 'other'
}

function emptyBuckets(): ConsumerBuckets {
  return {
    build: [],
    cpp: [],
    go: [],
    jsts: [],
    other: [],
    rust: [],
    testCorpus: [],
  }
}

// True when a repo-relative hit path is INSIDE the submodule's own directory —
// the internal-self-reference the skill warns about. Such hits are the
// submodule consuming itself, not this repo consuming it, so they are excluded
// from the buckets (counted as internalHitCount). Path comparison is done on
// forward-slash-normalized paths so it holds on every platform.
export function isInsideSubmodule(
  hitPath: string,
  submodulePath: string,
): boolean {
  const hit = normalizePath(hitPath)
  const dir = normalizePath(submodulePath).replace(/\/$/u, '')
  return hit === dir || hit.startsWith(`${dir}/`)
}

// Run `rg -l` for a literal substring and return the matched repo-relative file
// paths. rg exits 1 when there are no matches — that is NOT an error here, so a
// non-zero exit with empty stdout maps to []. Any other failure rethrows.
async function rgFiles(pattern: string, cwd: string): Promise<string[]> {
  const result = await spawn(
    'rg',
    ['--no-messages', '--files-with-matches', '--fixed-strings', pattern],
    { cwd, stdioString: true },
  ).catch(
    (e: unknown) =>
      e as { code?: unknown | undefined; stdout?: unknown | undefined },
  )
  const stdout = typeof result.stdout === 'string' ? result.stdout : ''
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

// Best-effort on-disk size of the submodule tree (human string from `du -sh`).
// Returns undefined when du is unavailable or the path is absent.
async function treeSize(submodulePath: string, cwd: string): Promise<string> {
  const result = await spawn('du', ['-sh', submodulePath], {
    cwd,
    stdioString: true,
  }).catch((e: unknown) => e as { stdout?: unknown | undefined })
  const stdout = typeof result.stdout === 'string' ? result.stdout : ''
  const first = stdout.split(/\s+/u)[0]
  return first ?? 'unknown'
}

export async function collectForBlock(
  block: SubmoduleBlock,
  repoRoot: string,
): Promise<SubmoduleConsumers & { treeSize: string }> {
  const submodulePath = block.path
  const buckets = emptyBuckets()
  let internalHitCount = 0
  let size = 'unknown'
  if (submodulePath) {
    const hits = await rgFiles(`${submodulePath}/`, repoRoot)
    for (let i = 0, { length } = hits; i < length; i += 1) {
      const hit = hits[i]!
      if (isInsideSubmodule(hit, submodulePath)) {
        internalHitCount += 1
        continue
      }
      buckets[bucketForFile(hit)].push(hit)
    }
    size = await treeSize(submodulePath, repoRoot)
  }
  return {
    currentSparse: block.sparse,
    currentVerify: block.verify,
    internalHitCount,
    name: block.name,
    outsideHits: buckets,
    path: submodulePath,
    treeSize: size,
  }
}

export async function collect(
  gitmodulesPath: string,
  repoRoot: string,
  selector: { name?: string | undefined; path?: string | undefined },
): Promise<Array<SubmoduleConsumers & { treeSize: string }>> {
  if (!existsSync(gitmodulesPath)) {
    return []
  }
  const blocks = parseBlocks(readFileSync(gitmodulesPath, 'utf8'))
  const scoped = blocks.filter(b => {
    if (selector.name !== undefined) {
      return b.name === selector.name
    }
    if (selector.path !== undefined) {
      return b.path === selector.path
    }
    return true
  })
  const out: Array<SubmoduleConsumers & { treeSize: string }> = []
  for (let i = 0, { length } = scoped; i < length; i += 1) {
    // Sequential: each runs an rg + du; the submodule count is tiny, so the
    // simplicity of an ordered loop beats a parallel fan-out here.
    out.push(await collectForBlock(scoped[i]!, repoRoot))
  }
  return out
}

function renderPretty(
  rows: Array<SubmoduleConsumers & { treeSize: string }>,
): void {
  for (let i = 0, { length } = rows; i < length; i += 1) {
    const r = rows[i]!
    const total = (Object.keys(r.outsideHits) as ConsumerBucket[]).reduce(
      (n, k) => n + r.outsideHits[k].length,
      0,
    )
    logger.info(`── ${r.name} (${r.path ?? '?'}) — ${r.treeSize} ──`)
    logger.info(
      `   sparse: ${r.currentSparse ?? '(none)'}   verify: ${r.currentVerify ?? '(none)'}`,
    )
    logger.info(
      `   outside hits: ${total}   (internal self-refs excluded: ${r.internalHitCount})`,
    )
    for (const key of Object.keys(r.outsideHits) as ConsumerBucket[]) {
      const files = r.outsideHits[key]
      if (files.length) {
        logger.info(`     ${key}: ${files.join(', ')}`)
      }
    }
  }
}

export async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const pretty = argv.includes('--pretty')
  const nameIdx = argv.indexOf('--name')
  const pathIdx = argv.indexOf('--path')
  const name = nameIdx !== -1 ? argv[nameIdx + 1] : undefined
  const submodulePath = pathIdx !== -1 ? argv[pathIdx + 1] : undefined
  const positional = argv.find(
    a => !a.startsWith('--') && a !== name && a !== submodulePath,
  )
  const gitmodulesPath = positional ?? path.join(REPO_ROOT, '.gitmodules')

  try {
    const rows = await collect(gitmodulesPath, REPO_ROOT, {
      name,
      path: submodulePath,
    })
    if (pretty) {
      if (!rows.length) {
        logger.info('no submodules found')
      } else {
        renderPretty(rows)
      }
    } else {
      process.stdout.write(
        `${JSON.stringify({ submodules: rows }, undefined, 2)}\n`,
      )
    }
  } catch (e) {
    logger.fail(`collect-submodule-consumers failed: ${errorMessage(e)}`)
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) {
  runMain(main)
}
