/*
 * @file Evergreen auto-bump for gh-aw compiled action/container SHA pins. For
 *   each tracked `*.github/workflows/*.md` agentic workflow source, runs `gh aw
 *   compile` to re-resolve the latest SHA for every pinned action version +
 *   refresh container image digests, updating the sibling `.lock.yml` and the
 *   shared `.github/aw/actions-lock.json` in one pass. Mirrors the evergreen
 *   pattern of `action-pins-are-current.mts --fix` (internal action pins).
 *   Usage: node
 *   scripts/fleet/sync-gh-aw-action-pins.mts # recompile all .md workflows node
 *   scripts/fleet/sync-gh-aw-action-pins.mts --quiet # suppress the clean-state
 *   line Fails loud (exit 1) when:
 *
 *   - `gh aw` extension is not installed
 *   - `gh aw compile` exits non-zero for any workflow Vacuous pass when no
 *     tracked `.md` workflows exist.
 */

// prefer-async-spawn: sync-required — sequential per-workflow gh subprocess +
// git file-list; no async flow needed.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

// Enumerate tracked gh-aw workflow markdown sources via `git ls-files`. The
// glob `*.github/workflows/*.md` matches both `.github/workflows/*.md` (at the
// repo root) and nested paths (template layers in the wheelhouse). Returns
// absolute paths.
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
// changed anything (compile is idempotent — a changed output signals a
// previously-stale pin was bumped).
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
// output changed (a changed file signals a previously-stale pin was bumped).
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

function main(): void {
  const argv = process.argv.slice(2)
  const quiet = argv.includes('--quiet')

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

  const results: CompileResult[] = []
  let anyFailed = false

  for (let i = 0, { length } = mdFiles; i < length; i += 1) {
    const result = compileOne(mdFiles[i]!)
    results.push(result)
    if (!result.ok) {
      anyFailed = true
    }
  }

  const failed = results.filter(r => !r.ok)
  const bumped = results.filter(r => r.ok && r.changed)
  const unchanged = results.filter(r => r.ok && !r.changed)

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
