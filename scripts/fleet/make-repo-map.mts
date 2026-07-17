/*
 * @file Repo-map — emits a token-cheap symbol skeleton for a file or directory
 *   instead of its full contents. A model (Claude today, any model later) reads
 *   the skeleton to locate a symbol, then reads only that line span — rather
 *   than pulling whole files into context, where they accumulate and get
 *   re-read on every subsequent turn (the dominant Claude cost surface).
 *   Model-agnostic: this is the retrieval substrate the "RAG + repo-map" answer
 *   points at. Deterministic, read-only apart from `--write`.
 *   Two modes:
 *
 *   - stdout (default): print the skeleton for the given paths.
 *   - `--write`: persist each file's skeleton to a gitignored on-disk cache at
 *     `<out>/<relpath>.skel` (+ an `index.txt` roll-up), so the hooks/harness
 *     can point a model at the ready-made skeleton instead of re-generating it
 *     every turn. The cache dir (default `.repo-map/`) is gitignored + counted
 *     as generated (generated-globs), so it never enters the commit cascade —
 *     it belongs to the gh-release bundle, not the byte-identical cascade.
 *     Flags: --write persist skeletons to the cache instead of printing.
 *     --changed only process git-changed source files (tracked diff vs HEAD +
 *     untracked); pairs with --write for the cheap incremental refresh the
 *     SessionStart hook runs. --out <dir> cache dir for --write (default
 *     `.repo-map`). Usage: node scripts/fleet/make-repo-map.mts <file|dir>
 *     [<file|dir>…] node scripts/fleet/make-repo-map.mts --write . node
 *     scripts/fleet/make-repo-map.mts --write --changed
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { isMainModule } from './_shared/is-main-module.mts'

// Default on-disk cache directory (repo-root-relative). Gitignored + treated as
// generated output, so a warm cache never leaks into the commit cascade.
export const DEFAULT_OUT_DIR = '.repo-map'

// A top-level declaration at column 0 (fleet style keeps every exported symbol
// module-scoped). Group 1 = kind keyword, group 2 = the symbol name. Leading
// `export` / `default` / `async` / `abstract` modifiers are consumed but not
// captured.
const TOP_DECL_RE =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(class|const|enum|function\*?|interface|let|namespace|type|var)\s+([A-Za-z0-9_$]+)/

const SOURCE_EXTS = new Set<string>(['.cjs', '.cts', '.mjs', '.mts', '.ts'])
const SKIP_DIRS = new Set<string>([
  '_dispatch',
  '.git',
  '.repo-map',
  'build',
  'coverage',
  'dist',
  'node_modules',
])

interface RepoMapSymbol {
  readonly startLine: number
  readonly endLine: number
  readonly kind: string
  readonly name: string
  readonly signature: string
}

/**
 * Extract top-level symbols (with line spans) from source. Pure. A symbol's
 * span runs from its declaration line to the line before the next top-level
 * symbol (or end of file), so a reader knows exactly which range to fetch for
 * the body.
 */
export function extractSymbols(source: string): RepoMapSymbol[] {
  const linesArr = source.split('\n')
  const starts: Array<{
    line: number
    kind: string
    name: string
    sig: string
  }> = []
  for (let i = 0, { length } = linesArr; i < length; i += 1) {
    const line = linesArr[i]!
    const match = TOP_DECL_RE.exec(line)
    if (!match) {
      continue
    }
    const sig = line.replace(/\s*\{?\s*$/, '').trim()
    starts.push({ line: i + 1, kind: match[1]!, name: match[2]!, sig })
  }
  const out: RepoMapSymbol[] = []
  for (let i = 0, { length } = starts; i < length; i += 1) {
    const cur = starts[i]!
    const next = starts[i + 1]
    out.push({
      startLine: cur.line,
      endLine: next ? next.line - 1 : linesArr.length,
      kind: cur.kind,
      name: cur.name,
      signature: cur.sig,
    })
  }
  return out
}

/**
 * Render one file's skeleton block: a header line plus one line per symbol,
 * `Lstart-Lend  <signature>`. Pure.
 */
export function buildSkeleton(
  relPath: string,
  source: string,
): { text: string; sourceBytes: number; skeletonBytes: number } {
  const symbols = extractSymbols(source)
  const totalLines = source.split('\n').length
  const lines: string[] = [
    `${relPath} (${totalLines} lines, ${symbols.length} symbols)`,
  ]
  for (let i = 0, { length } = symbols; i < length; i += 1) {
    const s = symbols[i]!
    lines.push(`  ${s.startLine}-${s.endLine}  ${s.signature}`)
  }
  const text = lines.join('\n')
  return {
    text,
    sourceBytes: Buffer.byteLength(source),
    skeletonBytes: Buffer.byteLength(text),
  }
}

/**
 * Recursively collect source files under a root (or return the root itself when
 * it is a file). Skips vendored / generated / VCS directories.
 */
export function collectFiles(root: string): string[] {
  const st = statSync(root)
  if (st.isFile()) {
    return [root]
  }
  const out: string[] = []
  const entries = readdirSync(root, { withFileTypes: true })
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue
      }
      out.push(...collectFiles(path.join(root, entry.name)))
    } else if (SOURCE_EXTS.has(path.extname(entry.name))) {
      out.push(path.join(root, entry.name))
    }
  }
  return out
}

/**
 * Map a source file to its cache path: `<outDir>/<relpath>.skel`, mirroring the
 * source tree under the cache root. Pure — `repoRoot` and `outDir` in, cache
 * path out. `.skel` suffix keeps the cache out of SOURCE_EXTS so a `--write .`
 * over a warm cache never re-maps its own output.
 */
export function cacheRelPath(
  repoRoot: string,
  absFile: string,
  outDir: string,
): string {
  const rel = path.relative(repoRoot, absFile)
  return path.join(outDir, `${rel}.skel`)
}

/**
 * Git-changed source files under `repoRoot`: tracked diff vs HEAD (staged +
 * unstaged) plus untracked-but-not-ignored, filtered to SOURCE_EXTS and files
 * that still exist. Read-only. Returns absolute paths. Fails SOFT — a non-repo,
 * a git error, or a missing binary yields `[]` (the caller then no-ops), so the
 * SessionStart refresh never breaks a session over a git hiccup.
 */
export function gitChangedSources(repoRoot: string): string[] {
  const run = (args: string[]): string[] => {
    const r = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' })
    if (r.status !== 0 || typeof r.stdout !== 'string') {
      return []
    }
    return r.stdout.split('\n')
  }
  const rels = [
    ...run(['diff', '--name-only', 'HEAD']),
    ...run(['ls-files', '--others', '--exclude-standard']),
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = 0, { length } = rels; i < length; i += 1) {
    const rel = rels[i]!.trim()
    if (rel === '' || !SOURCE_EXTS.has(path.extname(rel)) || seen.has(rel)) {
      continue
    }
    seen.add(rel)
    const abs = path.join(repoRoot, rel)
    if (existsSync(abs)) {
      out.push(abs)
    }
  }
  return out
}

interface WriteCacheResult {
  filesWritten: number
  sourceTotal: number
  skeletonTotal: number
}

/**
 * Write each file's skeleton to the cache (`<outDir>/<relpath>.skel`) and, when
 * `writeIndex` is set, refresh `<outDir>/index.txt` — a greppable roll-up of
 * every cached file with its line/symbol counts + the aggregate savings. The
 * index is skipped on an incremental (`--changed`) run so a partial refresh
 * doesn't clobber the full index with a sparse one.
 */
export function writeCache(
  repoRoot: string,
  files: readonly string[],
  outDir: string,
  writeIndex: boolean,
): WriteCacheResult {
  let sourceTotal = 0
  let skeletonTotal = 0
  const indexRows: string[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    const rel = path.relative(repoRoot, file)
    const source = readFileSync(file, 'utf8')
    const { skeletonBytes, sourceBytes, text } = buildSkeleton(rel, source)
    sourceTotal += sourceBytes
    skeletonTotal += skeletonBytes
    const skelPath = path.join(repoRoot, cacheRelPath(repoRoot, file, outDir))
    mkdirSync(path.dirname(skelPath), { recursive: true })
    writeFileSync(skelPath, `${text}\n`)
    indexRows.push(text.split('\n')[0]!)
  }
  if (writeIndex) {
    indexRows.sort()
    const ratio = sourceTotal === 0 ? 0 : (skeletonTotal / sourceTotal) * 100
    const header = [
      '# Repo-map cache index — generated by scripts/fleet/make-repo-map.mts.',
      `# ${files.length} files, source ${(sourceTotal / 1024).toFixed(0)}KB → skeleton ${(skeletonTotal / 1024).toFixed(0)}KB (${(100 - ratio).toFixed(1)}% saved).`,
      '# Read <this-dir>/<relpath>.skel for a file, then Read only the span you need.',
      '',
    ]
    mkdirSync(path.join(repoRoot, outDir), { recursive: true })
    writeFileSync(
      path.join(repoRoot, outDir, 'index.txt'),
      `${[...header, ...indexRows].join('\n')}\n`,
    )
  }
  return { filesWritten: files.length, skeletonTotal, sourceTotal }
}

interface ParsedArgs {
  changed: boolean
  outDir: string
  roots: string[]
  write: boolean
}

/**
 * Parse argv into flags + positional roots. Pure. Unknown flags are roots.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let changed = false
  let outDir = DEFAULT_OUT_DIR
  let write = false
  const roots: string[] = []
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--write') {
      write = true
    } else if (arg === '--changed') {
      changed = true
    } else if (arg === '--out') {
      outDir = argv[i + 1] ?? DEFAULT_OUT_DIR
      i += 1
    } else {
      roots.push(arg)
    }
  }
  return { changed, outDir, roots, write }
}

function main(): void {
  const { changed, outDir, roots, write } = parseArgs(process.argv.slice(2))
  const repoRoot = process.cwd()

  // Resolve the file set. --changed narrows to git-touched sources; otherwise
  // walk the given roots (default `.` when --write is used with no roots).
  let files: string[]
  if (changed) {
    files = gitChangedSources(repoRoot)
  } else {
    const walkRoots = roots.length > 0 ? roots : write ? ['.'] : []
    if (walkRoots.length === 0) {
      process.stderr.write(
        'What: no path given.\n' +
          'Where: make-repo-map.mts\n' +
          'Fix: node scripts/fleet/make-repo-map.mts <file|dir> [<file|dir>…]\n' +
          '     node scripts/fleet/make-repo-map.mts --write [--changed]\n',
      )
      process.exitCode = 1
      return
    }
    files = []
    for (let i = 0, { length } = walkRoots; i < length; i += 1) {
      files.push(...collectFiles(walkRoots[i]!))
    }
  }
  files.sort()

  if (write) {
    // --changed is an incremental refresh; don't overwrite the full index with
    // a sparse one.
    const { filesWritten, skeletonTotal, sourceTotal } = writeCache(
      repoRoot,
      files,
      outDir,
      /* writeIndex */ !changed,
    )
    const ratio = sourceTotal === 0 ? 0 : (skeletonTotal / sourceTotal) * 100
    process.stderr.write(
      `[repo-map] wrote ${filesWritten} skeleton(s) to ${outDir}/ ` +
        `(source ${(sourceTotal / 1024).toFixed(0)}KB → skeleton ` +
        `${(skeletonTotal / 1024).toFixed(0)}KB; ${(100 - ratio).toFixed(1)}% saved)\n`,
    )
    return
  }

  let sourceTotal = 0
  let skeletonTotal = 0
  const blocks: string[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    const source = readFileSync(file, 'utf8')
    const { skeletonBytes, sourceBytes, text } = buildSkeleton(file, source)
    sourceTotal += sourceBytes
    skeletonTotal += skeletonBytes
    blocks.push(text)
  }

  process.stdout.write(blocks.join('\n\n') + '\n')
  const ratio = sourceTotal === 0 ? 0 : (skeletonTotal / sourceTotal) * 100
  process.stderr.write(
    `\n[${files.length} files] source ${(sourceTotal / 1024).toFixed(0)}KB → ` +
      `skeleton ${(skeletonTotal / 1024).toFixed(0)}KB ` +
      `(${ratio.toFixed(1)}% of source; ${(100 - ratio).toFixed(1)}% saved)\n`,
  )
}

if (isMainModule(import.meta.url)) {
  main()
}
