// Fleet check — every `pnpm run <name>` a skill/command doc cites is a real script.
//
// SKILL.md, its sibling reference.md, and command `.md` bodies are THIN wrappers
// that defer the heavy lifting to a backing script — they instruct a reader (or
// an agent following the skill) to run `pnpm run <name>`. When the package.json
// script is renamed or dropped and the doc isn't updated, the citation rots: the
// reader runs `pnpm run gone` and gets nothing. `script-paths-resolve.mts` covers
// package.json + CANONICAL_SCRIPT_BODIES and `doc-references-resolve.mts` covers
// `node <local-script>` references in the same docs; this is their complement for
// the `pnpm run <name>` surface those two deliberately skip.
//
// Past incident: a placeholder citation (`pnpm run dedup-scan`) outlived the
// script it named — the doc shipped fleet-wide pointing at a `pnpm run` target
// no package.json defined, and no gate caught it.
//
// Scans `.claude/skills/**/SKILL.md`, `.claude/skills/**/reference.md`, and
// `.claude/commands/**/*.md` for `pnpm run <name>` invocations and fails
// `check --all` when <name> resolves to no script in the repo-root package.json.
//
// Out of scope (so we never double-fire with a sibling gate or on prose noise):
//   - `node <local-script>` references — owned by doc-references-resolve.mts.
//   - `allowed-tools:` frontmatter lines — those are Bash() permission GLOBS
//     (`Bash(pnpm run cover:*)`), not citations to a single named script.
//   - A name carrying a `*` glob or a trailing `:` is treated as a PREFIX and
//     passes when ANY script starts with it (`pnpm run build:*` ⇢ a `build:foo`
//     exists), matching how pnpm itself expands a glob script reference.
//
// Usage: node scripts/fleet/check/pnpm-run-citations-resolve.mts [--quiet]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Doc trees whose `pnpm run <name>` citations must resolve. Each entry is a
// [relative root, matching file suffix] pair walked recursively.
const DOC_ROOTS = [
  ['.claude/commands', '.md'],
  ['.claude/skills', 'SKILL.md'],
  ['.claude/skills', 'reference.md'],
] as const

// Captures the script name token after `pnpm run `. The name may carry a `:`
// namespace, a trailing `*` glob, or a trailing `:` (a documented prefix). The
// extractor stops at whitespace or a markdown/shell delimiter so a citation
// inside a table cell or backticks reads clean.
const PNPM_RUN_RE = /pnpm run ([A-Za-z][A-Za-z0-9:_*-]*)/g

// Metasyntactic stand-ins a doc uses to ILLUSTRATE the `pnpm run <x>` shape
// (e.g. "scripts named `pnpm run foo --flag`") rather than cite a real script.
// They can never name an on-disk script, so resolving them is a phantom — the
// same documentation-placeholder carve-out script-paths-resolve makes for a
// `<name>` path segment.
const PLACEHOLDER_NAMES = new Set(['bar', 'baz', 'foo', 'qux'])

export interface ScriptRefHit {
  readonly doc: string
  readonly line: number
  readonly scriptName: string
}

/**
 * A `name` that ends in `*` or `:` is a documented prefix (a glob script ref or
 * a `build:`-family mention) — it resolves when ANY defined script starts with
 * the prefix. Returns the prefix with the trailing `*` stripped, or undefined
 * when `name` is a plain exact-match script name.
 */
export function scriptPrefix(name: string): string | undefined {
  if (name.endsWith('*')) {
    return name.slice(0, -1)
  }
  if (name.endsWith(':')) {
    return name
  }
  return undefined
}

/**
 * True when `name` names a real script in `scriptNames` — an exact match, or
 * (for a `*`/`:`-suffixed prefix) any script that starts with the prefix.
 */
export function scriptExists(
  name: string,
  scriptNames: readonly string[],
): boolean {
  const prefix = scriptPrefix(name)
  if (prefix !== undefined) {
    for (let i = 0, { length } = scriptNames; i < length; i += 1) {
      if (scriptNames[i]!.startsWith(prefix)) {
        return true
      }
    }
    return false
  }
  return scriptNames.includes(name)
}

/**
 * Find every `pnpm run <name>` citation in a markdown body whose <name>
 * resolves to no script in `scriptNames`. Skips a YAML-frontmatter
 * `allowed-tools:` line: those carry Bash() permission globs, not single-script
 * citations.
 */
export function scanDoc(
  relDoc: string,
  text: string,
  scriptNames: readonly string[],
): ScriptRefHit[] {
  const hits: ScriptRefHit[] = []
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.trimStart().startsWith('allowed-tools:')) {
      continue
    }
    PNPM_RUN_RE.lastIndex = 0
    let m = PNPM_RUN_RE.exec(line)
    while (m) {
      const scriptName = m[1]!
      if (PLACEHOLDER_NAMES.has(scriptName)) {
        m = PNPM_RUN_RE.exec(line)
        continue
      }
      if (!scriptExists(scriptName, scriptNames)) {
        hits.push({ doc: relDoc, line: i + 1, scriptName })
      }
      m = PNPM_RUN_RE.exec(line)
    }
  }
  return hits
}

function walkDocs(dir: string, suffix: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (name === 'node_modules' || name.startsWith('.')) {
      continue
    }
    const abs = path.join(dir, name)
    let isDir = false
    try {
      isDir = statSync(abs).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      walkDocs(abs, suffix, out)
    } else if (name === suffix || name.endsWith(suffix)) {
      out.push(abs)
    }
  }
}

/**
 * Read the repo-root package.json `scripts` keys. Returns an empty list when
 * the file is missing or malformed (a downstream repo with no scripts simply
 * has no citation to resolve against — the docs there shouldn't cite `pnpm run`
 * either).
 */
export function readScriptNames(repoRoot: string): string[] {
  const pkgPath = path.join(repoRoot, 'package.json')
  if (!existsSync(pkgPath)) {
    return []
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      scripts?: Readonly<Record<string, string>> | undefined
    }
    return pkg.scripts ? Object.keys(pkg.scripts) : []
  } catch {
    return []
  }
}

export function scanRepo(repoRoot: string): ScriptRefHit[] {
  const scriptNames = readScriptNames(repoRoot)
  const hits: ScriptRefHit[] = []
  for (let r = 0, { length: rLen } = DOC_ROOTS; r < rLen; r += 1) {
    const [rel, suffix] = DOC_ROOTS[r]!
    const root = path.join(repoRoot, rel)
    const docs: string[] = []
    walkDocs(root, suffix, docs)
    for (let i = 0, { length } = docs; i < length; i += 1) {
      const abs = docs[i]!
      let docText: string
      try {
        docText = readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      hits.push(...scanDoc(path.relative(repoRoot, abs), docText, scriptNames))
    }
  }
  return hits
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const hits = scanRepo(REPO_ROOT)
  if (hits.length) {
    logger.fail(
      '[check-pnpm-run-citations-resolve] skill/command docs cite `pnpm run` scripts that do not exist:',
    )
    logger.group()
    for (let i = 0, { length } = hits; i < length; i += 1) {
      const h = hits[i]!
      logger.fail(
        `${h.doc}:${h.line} → pnpm run ${h.scriptName} (no such package.json script)`,
      )
    }
    logger.groupEnd()
    logger.error(
      'A skill/command that cites a missing `pnpm run` target rots silently — a reader runs nothing. Point the citation at the real script name, or remove the line.',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-pnpm-run-citations-resolve] every `pnpm run` citation in skill/command docs resolves.',
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (e) {
    logger.error(
      `[check-pnpm-run-citations-resolve] failed: ${errorMessage(e)}`,
    )
    process.exitCode = 1
  }
}
