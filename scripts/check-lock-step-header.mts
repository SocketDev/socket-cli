#!/usr/bin/env node
/**
 * @file Lock-step header byte-equality gate. Mantra: the four impls of a
 *   quadruplet agree about WHAT THE FILE IS FOR. The `BEGIN LOCK-STEP HEADER` /
 *   `END LOCK-STEP HEADER` block names that contract; every member of the
 *   quadruplet carries the same block, byte-for-byte (after stripping the `// `
 *   comment prefix). Drift on the contract is a different failure mode from a
 *   stale path reference (which `check-lock-step-refs.mts` catches) — this gate
 *   is the _intent_ tripwire. Opt-in per repo: uses the same
 *   `.config/lock-step-refs.json` as the path gate. Without the config, the
 *   gate is a no-op. With the config, the gate walks every scanned source file,
 *   looks for a `BEGIN LOCK-STEP HEADER` marker on the canonical side (a file
 *   whose header contains one or more `Lock-step with <Lang>: <path>` refs),
 *   extracts the header content, then opens each named peer and demands its
 *   header block be byte-identical. "Canonical side" is determined by the
 *   header content itself:
 *
 *   - A file with `Lock-step with <Lang>: <path>` is canonical for that peer.
 *     (The peer should reciprocate with `Lock-step from <Lang>: <my-path>`, but
 *     the gate doesn't rely on that — symmetry is a §5 rule, not a §7 rule.)
 *   - A file with only `Lock-step from <Lang>: <path>` is a port and is checked
 *     against its canonical source. Header format (single-line `// ` across
 *     every language): // BEGIN LOCK-STEP HEADER // Class Parsing
 *     (Declarations, Expressions, Elements, Methods) // // Lock-step with Go:
 *     src/parser/class.go // Lock-step with C++: src/parser/class.cpp // END
 *     LOCK-STEP HEADER Comparison strips the `// ` prefix from each line; an
 *     empty comment line (`//`) is preserved as an empty content line. The
 *     content between BEGIN and END is the contract. Usage: node
 *     scripts/check-lock-step-header.mts # report + fail node
 *     scripts/check-lock-step-header.mts --json # machine-readable node
 *     scripts/check-lock-step-header.mts --quiet # silent on clean Exit codes:
 *     0 — clean (no quadruplets diverged, or config absent) 1 — at least one
 *     quadruplet has a header diff 2 — gate itself crashed
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

const CONFIG_PATH = '.config/lock-step-refs.json'
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

const BEGIN_MARKER = 'BEGIN LOCK-STEP HEADER'
const END_MARKER = 'END LOCK-STEP HEADER'

type Config = {
  readonly roots: Readonly<Record<string, readonly string[]>>
  readonly scan: readonly string[]
  readonly extensions: readonly string[]
}

type HeaderBlock = {
  readonly file: string
  readonly bodyLines: readonly string[]
  readonly withRefs: ReadonlyArray<{ lang: string; refPath: string }>
}

type Diff = {
  readonly canonical: string
  readonly peer: string
  readonly lang: string
  readonly canonicalBody: readonly string[]
  readonly peerBody: readonly string[]
  readonly reason: 'peer-missing-header' | 'body-mismatch' | 'peer-not-found'
}

function loadConfig(repoRoot: string): Config | undefined {
  const configFile = path.join(repoRoot, CONFIG_PATH)
  if (!existsSync(configFile)) {
    return undefined
  }
  const raw = readFileSync(configFile, 'utf8')
  const parsed = JSON.parse(raw) as Config
  return parsed
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

// Extract a HeaderBlock from file content, or undefined if no
// `BEGIN LOCK-STEP HEADER` marker is present. The block is the lines
// between BEGIN and END, with the `// ` prefix stripped from each.
// Each line in the returned `bodyLines` is the comment content WITHOUT
// the `// ` prefix; an empty comment line (`//` alone) becomes `''`.
function extractHeader(file: string): HeaderBlock | undefined {
  let content: string
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  const lines = content.split('\n')
  let beginIdx = -1
  let endIdx = -1
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (lines[i]!.includes(BEGIN_MARKER)) {
      beginIdx = i
      break
    }
  }
  if (beginIdx === -1) {
    return undefined
  }
  for (let i = beginIdx + 1, { length } = lines; i < length; i += 1) {
    if (lines[i]!.includes(END_MARKER)) {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) {
    return undefined
  }
  const bodyLines: string[] = []
  for (let i = beginIdx + 1; i < endIdx; i += 1) {
    const raw = lines[i]!
    const stripped = stripCommentPrefix(raw)
    bodyLines.push(stripped)
  }
  const withRe =
    /Lock-step with ([A-Za-z][A-Za-z0-9+#-]*): ([^\s:,]*[./][^\s:,]*)/g
  const withRefs: Array<{ lang: string; refPath: string }> = []
  for (let i = 0, { length } = bodyLines; i < length; i += 1) {
    const line = bodyLines[i]!
    withRe.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = withRe.exec(line)) !== null) {
      withRefs.push({ lang: m[1]!, refPath: m[2]! })
    }
  }
  return { file, bodyLines, withRefs }
}

// Strip the `// ` prefix (or `//` for empty content lines) from a
// comment line. Returns the content. Non-comment lines come back as
// empty string — they shouldn't appear inside a BEGIN/END block, but
// we tolerate them silently rather than failing on whitespace.
function stripCommentPrefix(line: string): string {
  const trimmed = line.replace(/^\s*/, '')
  if (trimmed === '//') {
    return ''
  }
  if (trimmed.startsWith('// ')) {
    return trimmed.slice(3)
  }
  if (trimmed.startsWith('//')) {
    return trimmed.slice(2)
  }
  return ''
}

function resolveRefPath(
  config: Config,
  repoRoot: string,
  lang: string,
  refPath: string,
): string | undefined {
  const roots = config.roots[lang]
  if (!roots) {
    return undefined
  }
  const candidates = [
    path.join(repoRoot, refPath),
    ...roots.map(r => path.join(repoRoot, r, refPath)),
  ]
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const c = candidates[i]!
    if (existsSync(c)) {
      return c
    }
  }
  return undefined
}

function bodyEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0, { length } = a; i < length; i += 1) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

function formatDiff(d: Diff, repoRoot: string): string {
  const out: string[] = []
  const rel = (p: string) => path.relative(repoRoot, p)
  out.push(
    `\n${rel(d.canonical)} (canonical) ↔ ${rel(d.peer)} (${d.lang} peer):`,
  )
  if (d.reason === 'peer-not-found') {
    out.push(`  peer path doesn't exist on disk: ${rel(d.peer)}`)
    return out.join('\n')
  }
  if (d.reason === 'peer-missing-header') {
    out.push(`  peer is missing its BEGIN LOCK-STEP HEADER block`)
    return out.join('\n')
  }
  // body-mismatch — show the diff.
  out.push('  canonical header body:')
  for (const line of d.canonicalBody) {
    out.push(`    | ${line}`)
  }
  out.push('  peer header body:')
  for (const line of d.peerBody) {
    out.push(`    | ${line}`)
  }
  return out.join('\n')
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
    process.stderr.write(`check-lock-step-header: ${(e as Error).message}\n`)
    process.exitCode = 2
    return
  }
  if (!config) {
    if (!values.quiet) {
      process.stdout.write(
        `check-lock-step-header: ${CONFIG_PATH} not present — opt-in gate disabled, exiting clean\n`,
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
  // Build a map of canonical files (with at least one `Lock-step with`
  // ref) and check each peer they name.
  const diffs: Diff[] = []
  let canonicalCount = 0
  for (let i = 0, { length } = allFiles; i < length; i += 1) {
    const file = allFiles[i]!
    const header = extractHeader(file)
    if (!header || header.withRefs.length === 0) {
      continue
    }
    canonicalCount += 1
    for (const ref of header.withRefs) {
      const peerPath = resolveRefPath(config, repoRoot, ref.lang, ref.refPath)
      if (!peerPath) {
        diffs.push({
          canonical: file,
          peer: path.join(repoRoot, ref.refPath),
          lang: ref.lang,
          canonicalBody: header.bodyLines,
          peerBody: [],
          reason: 'peer-not-found',
        })
        continue
      }
      const peerHeader = extractHeader(peerPath)
      if (!peerHeader) {
        diffs.push({
          canonical: file,
          peer: peerPath,
          lang: ref.lang,
          canonicalBody: header.bodyLines,
          peerBody: [],
          reason: 'peer-missing-header',
        })
        continue
      }
      if (!bodyEqual(header.bodyLines, peerHeader.bodyLines)) {
        diffs.push({
          canonical: file,
          peer: peerPath,
          lang: ref.lang,
          canonicalBody: header.bodyLines,
          peerBody: peerHeader.bodyLines,
          reason: 'body-mismatch',
        })
      }
    }
  }
  if (values.json) {
    process.stdout.write(
      JSON.stringify(
        diffs.map(d => ({
          canonical: path.relative(repoRoot, d.canonical),
          peer: path.relative(repoRoot, d.peer),
          lang: d.lang,
          reason: d.reason,
          canonicalBody: d.canonicalBody,
          peerBody: d.peerBody,
        })),
        null,
        2,
      ) + '\n',
    )
  } else if (diffs.length === 0) {
    if (!values.quiet) {
      process.stdout.write(
        `check-lock-step-header: validated ${canonicalCount} canonical header(s) — clean\n`,
      )
    }
  } else {
    process.stderr.write(
      `check-lock-step-header: ${diffs.length} quadruplet diff(s) across ${canonicalCount} canonical header(s)`,
    )
    for (let i = 0, { length } = diffs; i < length; i += 1) {
      const d = diffs[i]!
      process.stderr.write(formatDiff(d, repoRoot))
    }
    process.stderr.write('\n')
  }
  if (diffs.length > 0) {
    process.exitCode = 1
  }
}

main()
