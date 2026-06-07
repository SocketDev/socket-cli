#!/usr/bin/env node
/**
 * @file Lock-step reference hygiene gate. Mantra: comments that name a path are
 *   claims about file layout; stale claims rot silently. This gate greps every
 *   `Lock-step with <Lang>:` / `Lock-step from <Lang>:` / inline `// Lock-step
 *   with <Lang>: <path>:<lines>` comment in tracked source files, resolves each
 *   path against the per-lang impl root declared in the repo-owned config
 *   (`.config/repo/lock-step-refs.json`, with a legacy top-level
 *   `.config/lock-step-refs.json` fallback during the migration soak), and fails
 *   CI when the path no longer exists. Line ranges are advisory and can drift;
 *   path existence is enforceable and that is what we enforce. The gate is opt-in
 *   per repo: if neither config location resolves, it exits 0 immediately. Repos
 *   that don't ship cross-language ports pay nothing. Config shape: { "roots": { "Rust":
 *   ["packages/acorn/lang/rust/crates"], "Go": ["packages/acorn/lang/go/src"],
 *   "C++": ["packages/acorn/lang/cpp/src"], "TS":
 *   ["packages/acorn/lang/typescript/src"] }, "scan": ["packages/acorn/lang"],
 *   "extensions": [".rs", ".go", ".cpp", ".hpp", ".ts", ".py", ".zig"] }
 *   `roots` maps the `<Lang>` token in the comment to one or more directories
 *   the path is resolved against. The first root that contains the file wins.
 *   `scan` lists directories the gate walks looking for comments. `extensions`
 *   filters which files are inspected. Comment shapes recognized (all four are
 *   documented in `docs/claude.md/fleet/parser-comments.md` §5): //! Lock-step
 *   with Go: src/parser/class.go //! Lock-step from Rust:
 *   crates/parser/src/class.rs // Lock-step with Go: parser.go:6450-6457 //
 *   Lock-step note: <freeform — not validated, by design> Only forms that carry
 *   a `<path>` are validated; `Lock-step note:` is a rationale shape and
 *   intentionally has no enforced target. Usage: node
 *   scripts/fleet/check/lock-step-refs-resolve.mts # report + fail on rot node
 *   scripts/fleet/check/lock-step-refs-resolve.mts --json # machine-readable node
 *   scripts/fleet/check/lock-step-refs-resolve.mts --quiet # silent on clean Exit
 *   codes: 0 — clean, or repo has no lock-step-refs config (opt-in
 *   absent) 1 — at least one stale reference found 2 — gate itself crashed
 *   (malformed config, walker failure)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

// The config is repo-owned: prefer the `.config/repo/` location, fall back to
// the legacy top-level `.config/` path during the migration soak.
const CONFIG_PATHS = [
  '.config/repo/lock-step-refs.json',
  '.config/lock-step-refs.json',
]
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  'build',
  'dist',
  'node_modules',
  'out',
  'pkg-node',
  'pkg-node-dev',
  'target',
  'vendor',
])

type Config = {
  readonly roots: Readonly<Record<string, readonly string[]>>
  readonly scan: readonly string[]
  readonly extensions: readonly string[]
}

type Finding = {
  readonly file: string
  readonly line: number
  readonly lang: string
  readonly refPath: string
  readonly reason: 'unknown-lang' | 'path-not-found'
}

// Capture-group layout:
//   1: form keyword — "with" or "from"
//   2: lang token (letters, digits, +, #, hyphen — covers Rust/Go/C++/TS/Py/Zig)
//   3: path (no whitespace, no colon; must contain `.` or `/` to avoid
//      matching prose like "Lock-step with Go: JSON parser")
//   4: optional `:start[-end]` line range (discarded for path resolution)
const LOCK_STEP_RE =
  /Lock-step (from|with) ([A-Za-z][A-Za-z0-9+#-]*): ([^\s:,]*[./][^\s:,]*)(?::(?:\d+(?:-\d+)?))?/g

function loadConfig(repoRoot: string): Config | undefined {
  const configPath = CONFIG_PATHS.find(rel =>
    existsSync(path.join(repoRoot, rel)),
  )
  if (!configPath) {
    return undefined
  }
  const configFile = path.join(repoRoot, configPath)
  let raw: string
  try {
    raw = readFileSync(configFile, 'utf8')
  } catch (e) {
    throw new Error(`failed to read ${configPath}: ${(e as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`${configPath} is not valid JSON: ${(e as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${configPath} must be a JSON object`)
  }
  const obj = parsed as Record<string, unknown>
  if (!obj['roots'] || typeof obj['roots'] !== 'object') {
    throw new Error(`${configPath} missing required "roots" object`)
  }
  if (!Array.isArray(obj['scan'])) {
    throw new Error(`${configPath} missing required "scan" array`)
  }
  if (!Array.isArray(obj['extensions'])) {
    throw new Error(`${configPath} missing required "extensions" array`)
  }
  return obj as unknown as Config
}

function walk(dir: string, exts: readonly string[]): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (SKIP_DIRS.has(entry)) {
      continue
    }
    const full = path.join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      out.push(...walk(full, exts))
    } else if (st.isFile() && exts.includes(path.extname(entry))) {
      out.push(full)
    }
  }
  return out
}

function resolveRef(
  config: Config,
  repoRoot: string,
  lang: string,
  refPath: string,
): { found: boolean; knownLang: boolean } {
  const roots = config.roots[lang]
  if (!roots || !roots.length) {
    return { found: false, knownLang: false }
  }
  // Absolute-style refs (start with `packages/`, `crates/`, `src/`, etc.)
  // are tried as repo-root relative AND against each lang root. The first
  // hit wins. This tolerates the variety we see in practice: Rust files
  // reference `parser.go:6450` (root-relative) while Go files reference
  // `crates/parser/src/class.rs` (lang-relative).
  const repoRelative = path.join(repoRoot, refPath)
  if (existsSync(repoRelative)) {
    return { found: true, knownLang: true }
  }
  for (let i = 0, { length } = roots; i < length; i += 1) {
    const root = roots[i]!
    const candidate = path.join(repoRoot, root, refPath)
    if (existsSync(candidate)) {
      return { found: true, knownLang: true }
    }
  }
  return { found: false, knownLang: true }
}

function scanFile(
  filePath: string,
  config: Config,
  repoRoot: string,
): Finding[] {
  const findings: Finding[] = []
  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  } catch {
    return findings
  }
  const lines = content.split('\n')
  for (let i = 0, len = lines.length; i < len; i += 1) {
    const line = lines[i]!
    LOCK_STEP_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = LOCK_STEP_RE.exec(line)) !== null) {
      const [, , lang, refPath] = match
      const { found, knownLang } = resolveRef(config, repoRoot, lang!, refPath!)
      if (!knownLang) {
        findings.push({
          file: filePath,
          line: i + 1,
          lang: lang!,
          refPath: refPath!,
          reason: 'unknown-lang',
        })
      } else if (!found) {
        findings.push({
          file: filePath,
          line: i + 1,
          lang: lang!,
          refPath: refPath!,
          reason: 'path-not-found',
        })
      }
    }
  }
  return findings
}

function formatFindings(
  findings: readonly Finding[],
  repoRoot: string,
): string {
  const grouped = new Map<string, Finding[]>()
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    const key = f.file
    let arr = grouped.get(key)
    if (!arr) {
      arr = []
      grouped.set(key, arr)
    }
    arr.push(f)
  }
  const lines: string[] = []
  for (const [file, fileFindings] of grouped) {
    const rel = path.relative(repoRoot, file)
    lines.push(`\n${rel}:`)
    for (let i = 0, { length } = fileFindings; i < length; i += 1) {
      const f = fileFindings[i]!
      const tag =
        f.reason === 'unknown-lang'
          ? `unknown <Lang> token "${f.lang}" (add to .config/repo/lock-step-refs.json roots)`
          : `path not found: ${f.refPath}`
      lines.push(`  L${f.line}: Lock-step ${f.lang} — ${tag}`)
    }
  }
  return lines.join('\n')
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      json: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })
  const repoRoot = process.cwd()
  let config: Config | undefined
  try {
    config = loadConfig(repoRoot)
  } catch (e) {
    process.stderr.write(`check-lock-step-refs-resolve: ${(e as Error).message}\n`)
    process.exitCode = 2
    return
  }
  if (!config) {
    if (!values.quiet) {
      process.stdout.write(
        `check-lock-step-refs-resolve: ${CONFIG_PATHS[0]} not present — opt-in gate disabled, exiting clean\n`,
      )
    }
    return
  }
  const allFiles: string[] = []
  for (const scanDir of config.scan) {
    const full = path.join(repoRoot, scanDir)
    if (!existsSync(full)) {
      continue
    }
    allFiles.push(...walk(full, config.extensions))
  }
  const findings: Finding[] = []
  for (let i = 0, { length } = allFiles; i < length; i += 1) {
    const file = allFiles[i]!
    findings.push(...scanFile(file, config, repoRoot))
  }
  if (values.json) {
    process.stdout.write(
      JSON.stringify(
        findings.map(f => ({
          file: path.relative(repoRoot, f.file),
          line: f.line,
          lang: f.lang,
          refPath: f.refPath,
          reason: f.reason,
        })),
        null,
        2,
      ) + '\n',
    )
  } else if (findings.length === 0) {
    if (!values.quiet) {
      process.stdout.write(
        `check-lock-step-refs-resolve: scanned ${allFiles.length} files — clean\n`,
      )
    }
  } else {
    process.stderr.write(
      `check-lock-step-refs-resolve: ${findings.length} stale reference(s) across ${allFiles.length} scanned files`,
    )
    process.stderr.write(formatFindings(findings, repoRoot))
    process.stderr.write('\n')
  }
  if (findings.length > 0) {
    process.exitCode = 1
  }
}

main()
