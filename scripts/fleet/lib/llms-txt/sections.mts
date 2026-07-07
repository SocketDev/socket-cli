/*
 * @file Deterministic section builder for the llms.txt generator. Discovers
 *   docs, public API entry points, packages, key commands, and conventions from
 *   the repo FS. No AI calls; no network. All link URLs are relative.
 *   Section ordering: Docs, API, Packages, Commands, Conventions, Optional.
 *   Empty sections are omitted from the rendered output. Within each section
 *   links are sorted: lead entry first (README or package root), then ASCII.
 *   Hard cap: 16 KB total rendered. Overflow ladder: collapse API namespace at.
 *
 *   > 40 subpaths, then truncate remaining links with a note.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type { LlmsLink, LlmsSection, RepoFacts } from './types.mts'

const API_COLLAPSE_THRESHOLD = 40

/**
 * Collect `.md` files from a directory, returning relative paths from
 * `repoRoot`. Skips node_modules and hidden dirs.
 */
function collectMdFiles(dir: string, repoRoot: string, maxDepth = 3): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results
  function walk(current: string, depth: number): void {
    if (depth > maxDepth) return
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      return
    }
    for (const entry of entries.sort()) {
      if (entry.startsWith('.') || entry === 'node_modules') continue
      const full = path.join(current, entry)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(full, depth + 1)
      } else if (entry.endsWith('.md')) {
        results.push(normalizePath(path.relative(repoRoot, full)))
      }
    }
  }
  walk(dir, 0)
  return results
}

/**
 * Read the first non-blank, non-heading line from a markdown file as
 * a description hint (used as the slot source for link notes).
 */
function readMdLead(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined
  const lines = readFileSync(filePath, 'utf8').split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (t === '' || t.startsWith('#')) continue
    if (t.length <= 200) return t
    // Word-boundary truncation: cut at last space before 200, add ellipsis.
    const cut = t.lastIndexOf(' ', 200)
    return (cut > 0 ? t.slice(0, cut) : t.slice(0, 200)).trimEnd() + '…'
  }
  return undefined
}

/**
 * Collect package subdir names from a monorepo `packages/` dir, limited to
 * direct children that have a `package.json`. Never globs pnpm-workspace
 * patterns (which in the wheelhouse match ~200 hook dirs).
 */
function collectPackages(
  packagesDir: string,
  repoRoot: string,
): Array<{ name: string; relPath: string }> {
  if (!existsSync(packagesDir)) return []
  let entries: string[]
  try {
    entries = readdirSync(packagesDir)
  } catch {
    return []
  }
  const result: Array<{ name: string; relPath: string }> = []
  for (const entry of entries.sort()) {
    const full = path.join(packagesDir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    if (!existsSync(path.join(full, 'package.json'))) continue
    result.push({
      name: entry,
      relPath: normalizePath(path.relative(repoRoot, full)),
    })
  }
  return result
}

/**
 * Sort links: a single "lead" entry first, then rest by name ASCII order.
 */
function sortLinks(
  links: LlmsLink[],
  leadName: string | undefined,
): LlmsLink[] {
  const lead = leadName ? links.find(l => l.name === leadName) : undefined
  const rest = links
    .filter(l => l !== lead)
    .sort((a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'variant' }),
    )
  return lead ? [lead, ...rest] : rest
}

/**
 * Build the six canonical llms.txt sections from the repo FS.
 * Empty sections are returned with an empty links array; callers omit them.
 */
export function buildSections(
  repoRoot: string,
  facts: RepoFacts,
): LlmsSection[] {
  // --- Docs section ---
  const docsLinks: LlmsLink[] = []
  const readmePath = path.join(repoRoot, 'README.md')
  if (existsSync(readmePath)) {
    docsLinks.push({
      name: 'README',
      note: facts.readmeLead,
      url: 'README.md',
    })
  }
  const docsDir = path.join(repoRoot, 'docs')
  // Cap docs entries so the rendered output stays within the 16 KB hard cap.
  // README + CHANGELOG take 2 slots; leave 28 for discovered docs.
  const docsMdFiles = collectMdFiles(docsDir, repoRoot).slice(0, 28)
  for (const rel of docsMdFiles) {
    const name = path.basename(rel, '.md')
    docsLinks.push({
      name,
      note: readMdLead(path.join(repoRoot, rel)),
      url: rel,
    })
  }
  const changelogPath = path.join(repoRoot, 'CHANGELOG.md')
  if (existsSync(changelogPath)) {
    docsLinks.push({ name: 'CHANGELOG', note: undefined, url: 'CHANGELOG.md' })
  }

  // --- API section ---
  const apiLinks: LlmsLink[] = []
  const srcDir = path.join(repoRoot, 'src')
  if (existsSync(srcDir)) {
    const entries: string[] = []
    let dirEntries: string[]
    try {
      dirEntries = readdirSync(srcDir)
    } catch {
      dirEntries = []
    }
    for (const entry of dirEntries.sort()) {
      if (entry.startsWith('.') || entry.startsWith('_')) continue
      const full = path.join(srcDir, entry)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isFile() && /\.(mts|ts|cts|js|mjs|cjs)$/.test(entry)) {
        entries.push(normalizePath(path.relative(repoRoot, full)))
      }
    }
    // Namespace collapse at >40 paths.
    const collapsed =
      entries.length > API_COLLAPSE_THRESHOLD
        ? entries.slice(0, API_COLLAPSE_THRESHOLD)
        : entries
    for (const rel of collapsed) {
      const name = path.basename(rel).replace(/\.(mts|ts|cts|js|mjs|cjs)$/, '')
      apiLinks.push({
        name,
        note: readMdLead(
          path.join(repoRoot, rel.replace(/\.(mts|ts)$/, '.md')),
        ),
        url: rel,
      })
    }
  }

  // --- Packages section (monorepo only) ---
  const packagesLinks: LlmsLink[] = []
  if (facts.layout === 'monorepo') {
    const packagesDir = path.join(repoRoot, 'packages')
    for (const pkg of collectPackages(packagesDir, repoRoot)) {
      const pkgReadme = path.join(repoRoot, pkg.relPath, 'README.md')
      packagesLinks.push({
        name: pkg.name,
        note: existsSync(pkgReadme) ? readMdLead(pkgReadme) : undefined,
        url: `${pkg.relPath}/package.json`,
      })
    }
  }

  // --- Commands section ---
  const commandLinks: LlmsLink[] = []
  const pkgJsonPath = path.join(repoRoot, 'package.json')
  if (existsSync(pkgJsonPath)) {
    let pkg: Record<string, unknown> | undefined
    try {
      pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as Record<
        string,
        unknown
      >
    } catch {
      pkg = undefined
    }
    if (pkg !== undefined) {
      const scripts = pkg['scripts'] as Record<string, string> | undefined
      if (scripts !== undefined) {
        const KEY_COMMANDS = [
          'check',
          'fix',
          'test',
          'cover',
          'build',
          'update',
          'lint',
          'format',
        ]
        for (const cmd of KEY_COMMANDS) {
          if (typeof scripts[cmd] === 'string') {
            commandLinks.push({
              name: `pnpm run ${cmd}`,
              note: scripts[cmd],
              url: 'package.json',
            })
          }
        }
      }
    }
  }

  // --- Conventions section ---
  const conventionLinks: LlmsLink[] = []
  const claudeMdPath = path.join(repoRoot, 'CLAUDE.md')
  if (existsSync(claudeMdPath)) {
    conventionLinks.push({
      name: 'CLAUDE.md',
      note: 'Engineering rules and fleet conventions for Claude Code.',
      url: 'CLAUDE.md',
    })
  }
  const agentsMdPath = path.join(repoRoot, 'docs', 'agents.md')
  let agentsMdStat
  try {
    agentsMdStat = statSync(agentsMdPath)
  } catch {
    agentsMdStat = undefined
  }
  if (agentsMdStat?.isFile()) {
    conventionLinks.push({
      name: 'docs/agents.md',
      note: 'Detailed agent conventions and discipline docs.',
      url: 'docs/agents.md',
    })
  }

  // --- Optional section ---
  const optionalLinks: LlmsLink[] = []
  const lockstepPath = path.join(repoRoot, 'lockstep.json')
  if (existsSync(lockstepPath)) {
    optionalLinks.push({
      name: 'lockstep.json',
      note: 'Cross-project lock-step manifest tracking version pins and parity.',
      url: 'lockstep.json',
    })
  }

  return [
    {
      links: sortLinks(docsLinks, 'README'),
      title: 'Docs',
    },
    {
      links: sortLinks(apiLinks, undefined),
      title: 'API',
    },
    {
      links: sortLinks(packagesLinks, undefined),
      title: 'Packages',
    },
    {
      links: sortLinks(commandLinks, undefined),
      title: 'Commands',
    },
    {
      links: sortLinks(conventionLinks, 'CLAUDE.md'),
      title: 'Conventions',
    },
    {
      links: sortLinks(optionalLinks, undefined),
      title: 'Optional',
    },
  ]
}
