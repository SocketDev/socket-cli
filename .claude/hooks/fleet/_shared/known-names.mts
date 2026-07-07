/*
 * @file Shared dictionary of known software identifiers + a prose scanner that
 *   finds them written as BARE words (not code spans). Backing lib for the
 *   prose-code-format-nudge hook and the prose skill (one source of truth).
 *
 *   The dictionary is assembled from artifacts the repo already owns
 *   (package.json deps, the pnpm catalog, external-tools.json, Cargo.toml) so it
 *   cannot go stale, plus a small curated EXTRA_NAMES for prose-recurring names
 *   not depended on here. Advisory only — the dictionary can't be exhaustive,
 *   and the context-stripper + ambiguous denylist err toward UNDER-flagging.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// Curated names that recur in fleet prose but aren't dependencies of THIS repo
// (e.g. Rust crates discussed in support-matrix docs). Keep SMALL + concrete;
// it is the only hand-maintained surface. Sorted.
export const EXTRA_NAMES: readonly string[] = [
  'oxfmt',
  'oxlint',
  'pacquet',
  'reqwest',
  'rolldown',
  'rustls',
  'undici',
  'vitest',
]

// Short / English-colliding identifiers that would fire on ordinary sentences.
// Excluded from the dictionary entirely. Sorted.
export const AMBIGUOUS_DENYLIST: ReadonlySet<string> = new Set([
  'aube',
  'chalk',
  'gem',
  'go',
  'next',
  'nub',
  'uv',
])

export interface BareNameHit {
  name: string
  line: number
  col: number
}

export function safeRead(filePath: string): string | undefined {
  try {
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : undefined
  } catch {
    return undefined
  }
}

export function namesFromPackageJson(repoRoot: string): string[] {
  const raw = safeRead(path.join(repoRoot, 'package.json'))
  if (!raw) {
    return []
  }
  try {
    const json = JSON.parse(raw) as Record<string, unknown>
    const fields = [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]
    const out: string[] = []
    for (let i = 0, { length } = fields; i < length; i += 1) {
      const dep = json[fields[i]!]
      if (dep && typeof dep === 'object') {
        out.push(...Object.keys(dep as Record<string, unknown>))
      }
    }
    return out
  } catch {
    return []
  }
}

export function namesFromCatalog(repoRoot: string): string[] {
  const raw = safeRead(path.join(repoRoot, 'pnpm-workspace.yaml'))
  if (!raw) {
    return []
  }
  // Catalog entries live under a `catalog:` / `catalogs:` block as
  //   '<name>': <version>   OR   <name>: <version>
  // Pull keys from those blocks only — a dedent back to column 0 ends the block.
  const lines = raw.split('\n')
  const out: string[] = []
  let inCatalog = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (/^catalogs?:/.test(line)) {
      inCatalog = true
      continue
    }
    if (inCatalog && /^\S/.test(line)) {
      inCatalog = false
    }
    if (!inCatalog) {
      continue
    }
    // A single indented `<key>:` entry; the key may be quoted or scoped.
    const m = /^\s+'?([@a-z0-9][\w@/.-]*?)'?\s*:/i.exec(line)
    if (m) {
      out.push(m[1]!)
    }
  }
  return out
}

export function namesFromExternalTools(repoRoot: string): string[] {
  const raw = safeRead(
    path.join(repoRoot, 'scripts/fleet/setup/external-tools.json'),
  )
  if (!raw) {
    return []
  }
  try {
    const json = JSON.parse(raw) as Record<string, unknown>
    const tools =
      json['tools'] && typeof json['tools'] === 'object'
        ? (json['tools'] as Record<string, unknown>)
        : json
    return Object.keys(tools)
  } catch {
    return []
  }
}

export function namesFromCargo(repoRoot: string): string[] {
  const raw = safeRead(path.join(repoRoot, 'Cargo.toml'))
  if (!raw) {
    return []
  }
  const lines = raw.split('\n')
  const out: string[] = []
  let inDeps = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    // `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`.
    if (/^\[[a-z-]*dependencies\]/.test(line)) {
      inDeps = true
      continue
    }
    if (line.startsWith('[')) {
      inDeps = false
      continue
    }
    if (!inDeps) {
      continue
    }
    const m = /^([a-z0-9][\w-]*)\s*=/i.exec(line)
    if (m) {
      out.push(m[1]!)
    }
  }
  return out
}

export function buildKnownNames(repoRoot: string): Set<string> {
  const all = [
    ...namesFromPackageJson(repoRoot),
    ...namesFromCatalog(repoRoot),
    ...namesFromExternalTools(repoRoot),
    ...namesFromCargo(repoRoot),
    ...EXTRA_NAMES,
  ]
  const set = new Set<string>()
  for (let i = 0, { length } = all; i < length; i += 1) {
    const name = all[i]
    // Only UNSCOPED, wordish names — scoped (@a/b) and pathy names are rarely
    // written bare in prose and complicate boundary matching. Drop ambiguous.
    if (
      name &&
      /^[a-z0-9][a-z0-9.-]*$/i.test(name) &&
      !AMBIGUOUS_DENYLIST.has(name.toLowerCase())
    ) {
      set.add(name)
    }
  }
  return set
}

export function escapeRegExp(text: string): string {
  return text.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')
}

// Replace regions where an identifier is legitimately NOT bare prose with
// equal-length blanks (newlines preserved so line/col stay correct): fenced
// code, inline code, link/image targets, autolinks, and HTML tags.
export function blankNonProse(text: string): string {
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ')
  return text
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/~~~[\s\S]*?~~~/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/\]\([^)]*\)/g, blank)
    .replace(/<https?:\/\/[^>]*>/g, blank)
    .replace(/<[^>]+>/g, blank)
}

export function findBareKnownNames(
  prose: string,
  options?: { names?: Set<string> | undefined; repoRoot?: string | undefined },
): BareNameHit[] {
  const opts = { __proto__: null, ...options } as {
    names?: Set<string> | undefined
    repoRoot?: string | undefined
  }
  const names = opts.names ?? buildKnownNames(opts.repoRoot ?? process.cwd())
  if (!names.size) {
    return []
  }
  const scan = blankNonProse(prose)
  // Longest-first so a substring name can't pre-empt a longer match.
  const sorted = [...names].toSorted((a, b) => b.length - a.length)
  const hits: BareNameHit[] = []
  for (let i = 0, { length } = sorted; i < length; i += 1) {
    const name = sorted[i]!
    // Word-boundary match that won't fire mid-identifier or inside a path; the
    // lookbehind/lookahead exclude the chars that make a name part of a token.
    const re = new RegExp(`(?<![\\w@/.-])${escapeRegExp(name)}(?![\\w/.-])`)
    const m = re.exec(scan)
    if (m) {
      const before = scan.slice(0, m.index)
      const line = before.split('\n').length
      const col = m.index - before.lastIndexOf('\n')
      hits.push({ name, line, col })
    }
  }
  hits.sort((a, b) => a.line - b.line || a.col - b.col)
  return hits
}
