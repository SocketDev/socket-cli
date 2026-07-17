// Fleet check — every `node <script>` reference in skill/command docs resolves.
//
// SKILL.md and command `.md` bodies document runnable steps as `node
// scripts/…mts` lines. When a script is renamed/moved/deleted and the doc isn't
// updated, the instruction silently rots — a reader (or an agent following the
// skill) runs a dead path. `script-paths-resolve.mts` covers package.json +
// CANONICAL_SCRIPT_BODIES; this is its complement for the prose surfaces.
//
// Past incident (2026-06-06): setup-repo/SKILL.md listed
// `scripts/fleet/setup/{sfw,agentshield,zizmor}.mts` — none existed (sfw lived
// at install-sfw.mts; the scanners are installed by a SessionStart hook, not
// standalone scripts). No gate caught it.
//
// Scans `.claude/skills/**/SKILL.md` and `.claude/commands/**/*.md` for
// `node <path>` invocations whose path ends in a script extension, and fails
// `check --all` when the target file does not exist under the repo root.
//
// Only `node <local-script>` is checked (same rule as script-paths-resolve):
// bin tools, `pnpm run`, `node -e`, and bare `/command` mentions are out of
// scope — a `/command` token space is too noisy to validate without a curated
// registry, and would false-fire on path fragments (`/fleet`, `/run`, …).
//
// Usage: node scripts/fleet/check/doc-references-resolve.mts [--quiet]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { extractNodeScriptPath } from './script-paths-resolve.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Doc trees whose `node <script>` references must resolve.
const DOC_ROOTS = [
  ['.claude/skills', 'SKILL.md'],
  ['.claude/commands', '.md'],
] as const

export interface DocRefHit {
  readonly doc: string
  readonly line: number
  readonly scriptPath: string
}

// Only validate refs that are meant to resolve in THIS repo — the
// wheelhouse-owned trees. A generic skill (e.g. running-test262) documents
// host-repo conventions with example paths like `scripts/test262.mts` or
// `test/<corpus>-runner.mts` that legitimately live only in a consuming repo;
// those are not wheelhouse rot and must not false-fire. Per the "Conformance
// runners" CLAUDE.md section, host runners live under <pkg>/test/, not here.
const WHEELHOUSE_OWNED_PREFIXES = [
  'scripts/fleet/',
  'scripts/repo/',
  '.claude/',
]

export function isWheelhouseOwnedRef(scriptPath: string): boolean {
  for (let i = 0, { length } = WHEELHOUSE_OWNED_PREFIXES; i < length; i += 1) {
    if (scriptPath.startsWith(WHEELHOUSE_OWNED_PREFIXES[i]!)) {
      return true
    }
  }
  return false
}

// The canonical fleet opt-out marker (the same one cross-repo-guard honors). A
// SKILL that documents how to cascade FROM the wheelhouse INTO a member repo
// prints a multi-line shell block — `cd <…>/socket-wheelhouse && \n node
// scripts/repo/sync-scaffolding/cli.mts …` — where the `node` path resolves in
// the wheelhouse, not in the member repo running this check. Such a path is
// documented-on-purpose, not rot, and the block carries the marker. The marker
// sits on the `cd` line (`# socket-lint: allow cross-repo`), so the ref one
// line below it is exempt too: cross-repo cascade instructions are inherently
// two-line `cd && node` echo blocks.
const CROSS_REPO_ALLOW_RE = /socket-lint:\s*allow cross-repo/

export function lineIsCrossRepoExempt(
  lines: readonly string[],
  index: number,
): boolean {
  if (CROSS_REPO_ALLOW_RE.test(lines[index] ?? '')) {
    return true
  }
  // The marker on the immediately-preceding line covers the `cd && node` pair.
  return index > 0 && CROSS_REPO_ALLOW_RE.test(lines[index - 1] ?? '')
}

/**
 * Find every `node <local-script>` reference in a markdown body whose target is
 * missing under repoRoot. Scans line by line so a doc can carry many refs;
 * pulls the path out of any `node …` run anywhere on the line (tables, fenced
 * blocks, prose) by reusing the script-paths extractor on each `node …` slice.
 */
export function scanDoc(
  relDoc: string,
  text: string,
  repoRoot: string,
): DocRefHit[] {
  const hits: DocRefHit[] = []
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (lineIsCrossRepoExempt(lines, i)) {
      continue
    }
    // A line can contain `node …` inside a table cell / backticks / prose.
    // Slice from each `node ` occurrence and let the extractor read the path.
    let idx = line.indexOf('node ')
    while (idx !== -1) {
      // Trim trailing markdown delimiters (`|`, backtick) from the slice so
      // the path token is clean.
      const slice = line.slice(idx).replace(/[`|].*$/, '')
      const scriptPath = extractNodeScriptPath(slice)
      if (
        scriptPath &&
        isWheelhouseOwnedRef(scriptPath) &&
        !existsSync(path.join(repoRoot, scriptPath))
      ) {
        hits.push({ doc: relDoc, line: i + 1, scriptPath })
      }
      idx = line.indexOf('node ', idx + 5)
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

export function scanRepo(repoRoot: string): DocRefHit[] {
  const hits: DocRefHit[] = []
  for (let r = 0, { length: rLen } = DOC_ROOTS; r < rLen; r += 1) {
    const [rel, suffix] = DOC_ROOTS[r]!
    const root = path.join(repoRoot, rel)
    const docs: string[] = []
    walkDocs(root, suffix, docs)
    for (let i = 0, { length } = docs; i < length; i += 1) {
      const abs = docs[i]!
      let text: string
      try {
        text = readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      hits.push(...scanDoc(path.relative(repoRoot, abs), text, repoRoot))
    }
  }
  return hits
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const hits = scanRepo(REPO_ROOT)
  if (hits.length) {
    logger.fail(
      '[check-doc-references-resolve] skill/command docs reference scripts that do not exist:',
    )
    for (let i = 0, { length } = hits; i < length; i += 1) {
      const h = hits[i]!
      logger.error(
        `  ✗ ${h.doc}:${h.line} → node ${h.scriptPath} (file not found)`,
      )
    }
    logger.error(
      '  A SKILL.md / command doc that names a missing script rots silently. Point it at the real path, or remove the row.',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-doc-references-resolve] every node-script reference in skill/command docs resolves.',
    )
  }
}

if (isMainModule(import.meta.url)) {
  try {
    main()
  } catch (e) {
    logger.error(`[check-doc-references-resolve] failed: ${errorMessage(e)}`)
    process.exitCode = 1
  }
}
