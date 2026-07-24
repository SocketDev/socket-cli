/*
 * @file Evergreen auto-bump for gh-aw compiled action/container SHA pins. For
 *   each tracked `*.github/workflows/*.md` agentic workflow source, runs `gh aw
 *   compile` to re-resolve the latest SHA for every pinned action version +
 *   refresh container image digests, updating the sibling `.lock.yml` and the
 *   shared `.github/aw/actions-lock.json` in one pass. Mirrors the evergreen
 *   pattern of `action-pins-are-current.mts --fix` (internal action pins). The
 *   soak-gate decision + on-disk restore live in `lib/gh-aw-action-pin-soak.mts`.
 *   Usage: node
 *   scripts/fleet/sync-gh-aw-action-pins.mts # recompile all .md workflows node
 *   scripts/fleet/sync-gh-aw-action-pins.mts --quiet # suppress the clean-state
 *   line Fails loud (exit 1) when:
 *
 *   - `gh aw` extension is not installed
 *   - `gh aw compile` exits non-zero for any workflow
 *   - a non-Socket action pin is younger than the soak window (held) Vacuous
 *     pass when no tracked `.md` workflows exist.
 */

// prefer-async-spawn: sync-required — sequential per-workflow gh subprocess +
// git file-list; no async flow needed.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { SOAK_DAYS } from './constants/soak.mts'
import {
  actionsLockPathFor,
  lockYmlPathFor,
  soakGateCompile,
} from './lib/gh-aw-action-pin-soak.mts'
import type {
  HeldActionPin,
  ResolveCommitDate,
} from './lib/gh-aw-action-pin-soak.mts'
import { REPO_ROOT } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const DAY_MS = 86_400_000

const logger = getDefaultLogger()

// Enumerate tracked gh-aw workflow markdown sources via `git ls-files`. The
// glob `*.github/workflows/*.md` matches both `.github/workflows/*.md` (at the
// repo root) and nested paths (template layers in the wheelhouse). A gh-aw
// workflow source always opens with YAML frontmatter (`---`); plain
// documentation living beside the workflows (README.md) does not, and feeding
// it to `gh aw compile` fails the whole sync — filter those out (same gate as
// check/gh-aw-locks-are-current.mts). Returns absolute paths.
export function listTrackedMarkdown(): string[] {
  const r = spawnSync('git', ['ls-files', '*.github/workflows/*.md'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return []
  }
  return r.stdout
    .split(/\r?\n/u)
    .map(s => s.trim())
    .filter(Boolean)
    .map(rel => path.join(REPO_ROOT, rel))
    .filter(abs => {
      let head = ''
      try {
        head = readFileSync(abs, 'utf8').slice(0, 4)
      } catch {
        head = ''
      }
      return head.startsWith('---')
    })
    .toSorted()
}

// True when the `gh aw` extension is installed and callable. `gh aw version`
// exits 0 when installed. Best-effort: a spawn error → not installed.
export function ghAwInstalled(): boolean {
  const r = spawnSync('gh', ['aw', 'version'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  })
  return typeof r.status === 'number' && r.status === 0
}

export interface CompileResult {
  changed: boolean
  mdPath: string
  ok: boolean
  stderr: string
}

// Snapshot the relevant outputs for a workflow source: the sibling `.lock.yml`
// and the nearest `actions-lock.json`. Used to detect whether `gh aw compile`
// changed anything (compile is idempotent — a changed output means a stale pin
// advanced).
function snapshotOutputs(mdPath: string): string {
  const dir = path.dirname(mdPath)
  const tracked = spawnSync('git', ['ls-files', dir], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  const awDir = path.join(path.dirname(dir), 'aw')
  const awTracked = spawnSync('git', ['ls-files', awDir], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  return (
    (typeof tracked.stdout === 'string' ? tracked.stdout : '') +
    (typeof awTracked.stdout === 'string' ? awTracked.stdout : '')
  )
}

// Run `gh aw compile <mdFile> --dir <workflowDir> --approve` for one workflow
// source. `--approve` auto-approves action-addition prompts that strict mode
// surfaces interactively. Returns whether the compile succeeded and whether the
// output changed (a changed file means a stale pin advanced).
export function compileOne(mdPath: string): CompileResult {
  const dir = path.dirname(mdPath)
  const relMd = path.relative(REPO_ROOT, mdPath)
  const relDir = path.relative(REPO_ROOT, dir)
  const before = snapshotOutputs(mdPath)
  const r = spawnSync(
    'gh',
    ['aw', 'compile', relMd, '--dir', relDir, '--approve'],
    {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      stdioString: true,
    },
  )
  const ok = typeof r.status === 'number' && r.status === 0
  const after = snapshotOutputs(mdPath)
  return {
    changed: before !== after,
    mdPath,
    ok,
    stderr: typeof r.stderr === 'string' ? r.stderr.trim() : '',
  }
}

// Absolute paths of every tracked file under a workflow's dir + its sibling
// `aw/` dir, plus the deterministic lock + compiled `.lock.yml` paths.
// Snapshotted so a soak-held recompile can be rolled back: existing files are
// restored, fresh ones deleted. The deterministic paths seed the set so a
// first-time compile output (not yet tracked) is still covered.
export function workflowOutputPaths(mdPath: string): string[] {
  const dir = path.dirname(mdPath)
  const awDir = path.join(path.dirname(dir), 'aw')
  // oxlint-disable-next-line socket/sort-set-args -- non-literal elements (runtime path calls); already alphanumeric by call text (actionsLockPathFor < lockYmlPathFor).
  const out = new Set<string>([
    actionsLockPathFor(mdPath),
    lockYmlPathFor(mdPath),
  ])
  const targets = [awDir, dir]
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const r = spawnSync('git', ['ls-files', targets[i]!], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      stdioString: true,
    })
    if (r.status !== 0 || typeof r.stdout !== 'string') {
      continue
    }
    const lines = r.stdout.split(/\r?\n/u)
    for (let j = 0, len = lines.length; j < len; j += 1) {
      const rel = lines[j]!.trim()
      if (rel) {
        out.add(path.join(REPO_ROOT, rel))
      }
    }
  }
  return [...out].toSorted()
}

// Resolve a commit's authored date through the sanctioned `gh api` read path.
// Returns undefined on any failure so the soak gate treats an unverifiable date
// as not-cleared (fail closed). Never a raw api.github.com fetch.
export const resolveCommitDateViaGhApi: ResolveCommitDate = (
  ownerRepo: string,
  sha: string,
): Date | undefined => {
  const r = spawnSync(
    'gh',
    [
      'api',
      `repos/${ownerRepo}/commits/${sha}`,
      '--jq',
      '.commit.committer.date',
    ],
    {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      stdioString: true,
    },
  )
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return undefined
  }
  const iso = r.stdout.trim()
  if (!iso) {
    return undefined
  }
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : date
}

// Parse the sync CLI argv into its resolved flags. `--quiet` suppresses the
// clean-state success line; everything else is ignored (the sync takes no
// other options).
export function parseSyncArgs(argv: readonly string[]): { quiet: boolean } {
  return { quiet: argv.includes('--quiet') }
}

export interface CategorizedResults {
  bumped: CompileResult[]
  failed: CompileResult[]
  unchanged: CompileResult[]
}

// Partition compile results into the three reporting buckets: `failed`
// (compile exited non-zero), `bumped` (compiled clean and advanced a pin), and
// `unchanged` (compiled clean, already current).
export function categorizeResults(
  results: readonly CompileResult[],
): CategorizedResults {
  return {
    bumped: results.filter(r => r.ok && r.changed),
    failed: results.filter(r => !r.ok),
    unchanged: results.filter(r => r.ok && !r.changed),
  }
}

export interface CompileGateResult {
  anyFailed: boolean
  heldPins: HeldActionPin[]
  results: CompileResult[]
}

// Recompile every workflow source and run the soak gate on each, seam-injected
// so the plan assembly is unit-testable without a `gh aw` subprocess or the fs:
// `compile`, the fs probes (`existsFile`/`readFile`), `outputPathsFor`, and the
// `soakGate` are all supplied by the caller. Returns the raw compile results,
// the accumulated held pins, and whether any compile failed.
export function runCompileGate(config: {
  compile: (mdPath: string) => CompileResult
  existsFile: (file: string) => boolean
  mdFiles: readonly string[]
  outputPathsFor: (mdPath: string) => string[]
  readFile: (file: string) => string
  resolveCommitDate: ResolveCommitDate
  soakGate: (soakOptions: {
    beforeContents: ReadonlyMap<string, string>
    mdPath: string
    outputPaths: readonly string[]
    resolveCommitDate: ResolveCommitDate
  }) => HeldActionPin[]
}): CompileGateResult {
  const {
    compile,
    existsFile,
    mdFiles,
    outputPathsFor,
    readFile,
    resolveCommitDate,
    soakGate,
  } = { __proto__: null, ...config } as typeof config
  const results: CompileResult[] = []
  const heldPins: HeldActionPin[] = []
  let anyFailed = false
  for (let i = 0, { length } = mdFiles; i < length; i += 1) {
    const mdPath = mdFiles[i]!
    const outputPaths = outputPathsFor(mdPath)
    const beforeContents = new Map<string, string>()
    for (let j = 0, len = outputPaths.length; j < len; j += 1) {
      const file = outputPaths[j]!
      // Snapshot only files that already exist: a held-restore writes these
      // back verbatim. A file the compile creates fresh (absent before) is
      // never in the snapshot; soakGateCompile deletes those on a hold.
      if (existsFile(file)) {
        beforeContents.set(file, readFile(file))
      }
    }
    const result = compile(mdPath)
    results.push(result)
    if (!result.ok) {
      anyFailed = true
      continue
    }
    const held = soakGate({
      beforeContents,
      mdPath,
      outputPaths,
      resolveCommitDate,
    })
    for (let j = 0, len = held.length; j < len; j += 1) {
      heldPins.push(held[j]!)
    }
  }
  return { anyFailed, heldPins, results }
}

function main(): void {
  const { quiet } = parseSyncArgs(process.argv.slice(2))

  const mdFiles = listTrackedMarkdown()
  if (mdFiles.length === 0) {
    if (!quiet) {
      logger.success(
        '[sync-gh-aw-action-pins] no tracked gh-aw workflow .md files found — not applicable.',
      )
    }
    return
  }

  if (!ghAwInstalled()) {
    logger.fail(
      '[sync-gh-aw-action-pins] `gh aw` extension is not installed — cannot recompile gh-aw workflows.',
    )
    logger.group()
    logger.error(
      'What: `gh aw compile` is required to refresh action/container SHA pins in compiled .lock.yml files.',
    )
    logger.error(
      'Where: .github/workflows/*.md (and template layers in the wheelhouse)',
    )
    logger.error('Wanted: `gh aw` extension on PATH; got: extension not found.')
    logger.error('Fix: run `gh extension install github/gh-aw` then retry.')
    logger.groupEnd()
    process.exitCode = 1
    return
  }

  const { anyFailed, heldPins, results } = runCompileGate({
    compile: compileOne,
    existsFile: existsSync,
    mdFiles,
    outputPathsFor: workflowOutputPaths,
    readFile: file => readFileSync(file, 'utf8'),
    resolveCommitDate: resolveCommitDateViaGhApi,
    soakGate: soakGateCompile,
  })

  const { bumped, failed, unchanged } = categorizeResults(results)

  for (let i = 0, { length } = failed; i < length; i += 1) {
    const f = failed[i]!
    const rel = path.relative(REPO_ROOT, f.mdPath)
    const relDir = path.relative(REPO_ROOT, path.dirname(f.mdPath))
    logger.fail(`[sync-gh-aw-action-pins] ${rel}: gh aw compile failed`)
    logger.group()
    logger.error(`What: gh aw compile exited non-zero for ${rel}.`)
    logger.error(
      `Fix: run \`gh aw compile ${rel} --dir ${relDir}\` to see the error and resolve it.`,
    )
    if (f.stderr) {
      logger.error(`Compiler output: ${f.stderr.slice(0, 400)}`)
    }
    logger.groupEnd()
  }

  for (let i = 0, { length } = bumped; i < length; i += 1) {
    logger.log(
      `bumped: ${path.relative(REPO_ROOT, bumped[i]!.mdPath)} — action/container SHA pins refreshed`,
    )
  }

  if (heldPins.length) {
    logger.fail(
      `[sync-gh-aw-action-pins] ${heldPins.length} action pin(s) held under the ${SOAK_DAYS}-day soak — pins kept at their current SHA.`,
    )
    logger.group()
    for (let i = 0, { length } = heldPins; i < length; i += 1) {
      const { bump, committedAt, remainingMs } = heldPins[i]!
      const shortSha = bump.newSha.slice(0, 12)
      const age =
        committedAt === undefined
          ? 'commit date unverifiable'
          : `${Math.ceil(remainingMs / DAY_MS)}d left of ${SOAK_DAYS}d soak`
      logger.error(
        `What: ${bump.repo}@${bump.version} (${shortSha}) is too fresh — ${age}.`,
      )
    }
    logger.error(
      'Where: gh-aw compiled action SHA pins (actions-lock.json + .lock.yml).',
    )
    logger.error(
      'Saw: a non-Socket action newer than the soak window; wanted every third-party pin past its soak.',
    )
    logger.error(
      `Fix: re-run once the release clears the ${SOAK_DAYS}-day soak; Socket-owned actions are exempt.`,
    )
    logger.groupEnd()
    process.exitCode = 1
    return
  }

  if (anyFailed) {
    process.exitCode = 1
    return
  }

  if (!quiet) {
    if (bumped.length) {
      logger.success(
        `[sync-gh-aw-action-pins] refreshed ${bumped.length} workflow(s); ${unchanged.length} already current.`,
      )
    } else {
      logger.success(
        `[sync-gh-aw-action-pins] all ${unchanged.length} workflow(s) already current.`,
      )
    }
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
