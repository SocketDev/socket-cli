#!/usr/bin/env node
// Fleet check — pack-contents-are-clean.
//
// The release gate for the FILES FIELD: packs the package (`pnpm pack`) and
// inspects the actual tarball entry list, failing LOUD when anything ships
// that shouldn't — fleet/claude scaffolding (.claude/, scripts/fleet/,
// .git-hooks/, template/, .github/, .config/), hidden files (.env*,
// .DS_Store, dotfiles), logs, or entries outside the package.json `files`
// contract. A wrong `files` field publishes silently; this catches it at
// check time from the REAL pack output, not a prediction.
//
// Private packages (`"private": true`) never publish, so the check passes
// without packing. The pipeline (release program 13d) runs this before every
// staged publish; `check --all` runs it too.
//
// Usage: node scripts/fleet/check/pack-contents-are-clean.mts [--quiet]

import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
// oxlint-disable-next-line socket/prefer-async-spawn -- sync CLI check; pack + tar listing are sequential by nature.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Path prefixes (tarball-relative, after stripping `package/`) that are fleet
// or agent scaffolding and must NEVER ship in an npm tarball.
const SCAFFOLDING_PREFIXES = [
  '.agents/',
  '.claude/',
  '.config/',
  '.git-hooks/',
  '.github/',
  'bootstrap/',
  'scripts/fleet/',
  'template/',
]

// Entry basenames npm always includes regardless of `files` — allowed.
const ALWAYS_ALLOWED_RE =
  /^(?:CHANGELOG(?:\..+)?|LICENCE(?:\..+)?|LICENSE(?:\..+)?|README(?:\..+)?|package\.json)$/i

// Hidden-file allowlist: dotfiles that are legitimately published.
const HIDDEN_ALLOWED_RE = /^\.(?:npmignore)$/

export interface PackClassification {
  readonly clean: string[]
  readonly hidden: string[]
  readonly outsideFiles: string[]
  readonly scaffolding: string[]
}

/**
 * True when a tarball-relative path is covered by a package.json `files`
 * entry (a listed file, or anything under a listed directory). A missing /
 * empty `files` field covers everything (npm's default). Pure.
 */
export function isCoveredByFiles(
  entry: string,
  filesField: readonly string[] | undefined,
): boolean {
  if (!filesField || filesField.length === 0) {
    return true
  }
  const e = normalizePath(entry)
  for (const f of filesField) {
    const nf = normalizePath(f).replace(/\/+$/, '')
    if (e === nf || e.startsWith(`${nf}/`)) {
      return true
    }
    // A simple one-level glob (`lib/*.js`) — match by prefix + suffix.
    if (nf.includes('*')) {
      const [pre = '', post = ''] = nf.split('*', 2)
      if (e.startsWith(pre) && e.endsWith(post)) {
        return true
      }
    }
  }
  return false
}

/**
 * Classify tarball entries (already stripped of the `package/` prefix) into
 * clean / scaffolding / hidden / outside-the-files-contract. Pure.
 */
export function classifyPackEntries(
  entries: readonly string[],
  filesField: readonly string[] | undefined,
): PackClassification {
  const clean: string[] = []
  const hidden: string[] = []
  const outsideFiles: string[] = []
  const scaffolding: string[] = []
  for (const raw of entries) {
    const e = normalizePath(raw)
    if (!e) {
      continue
    }
    const base = e.split('/').pop()!
    if (SCAFFOLDING_PREFIXES.some(p => e.startsWith(p))) {
      scaffolding.push(e)
      continue
    }
    const hiddenSegment = e
      .split('/')
      .some(seg => seg.startsWith('.') && !HIDDEN_ALLOWED_RE.test(seg))
    if (hiddenSegment || base === '.DS_Store' || base.endsWith('.log')) {
      hidden.push(e)
      continue
    }
    if (ALWAYS_ALLOWED_RE.test(base) && !e.includes('/')) {
      clean.push(e)
      continue
    }
    if (!isCoveredByFiles(e, filesField)) {
      outsideFiles.push(e)
      continue
    }
    clean.push(e)
  }
  return { clean, hidden, outsideFiles, scaffolding }
}

/**
 * Pack the package at `pkgRoot` into a temp dir and return the tarball's
 * entry list (stripped of the leading `package/`). Undefined on pack/tar
 * failure (the caller fails loud).
 */
export function packAndList(pkgRoot: string): string[] | undefined {
  const dest = mkdtempSync(path.join(os.tmpdir(), 'pack-clean-'))
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', dest], {
    cwd: pkgRoot,
    timeout: 180_000,
  })
  if (packed.status !== 0) {
    return undefined
  }
  // pnpm prints the tarball path as the last non-empty stdout line.
  const lines = String(packed.stdout ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
  const tarball = lines.at(-1)
  if (!tarball || !existsSync(tarball)) {
    return undefined
  }
  const listed = spawnSync('tar', ['-tzf', tarball], { timeout: 60_000 })
  if (listed.status !== 0) {
    return undefined
  }
  return String(listed.stdout ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .map(e => e.replace(/^package\//, ''))
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const manifestPath = path.join(REPO_ROOT, 'package.json')
  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    files?: string[] | undefined
    name?: string | undefined
    private?: boolean | undefined
  }
  if (pkg.private === true) {
    if (!quiet) {
      logger.success(
        '[pack-contents-are-clean] private package — never publishes; skipping.',
      )
    }
    return
  }
  const entries = packAndList(REPO_ROOT)
  if (!entries) {
    logger.fail(
      '[pack-contents-are-clean] pnpm pack (or tar listing) failed — cannot verify the tarball. Run `pnpm pack` manually to see the error.',
    )
    process.exitCode = 1
    return
  }
  const { hidden, outsideFiles, scaffolding } = classifyPackEntries(
    entries,
    pkg.files,
  )
  const bad = scaffolding.length + hidden.length + outsideFiles.length
  if (bad === 0) {
    if (!quiet) {
      logger.success(
        `[pack-contents-are-clean] tarball is clean (${entries.length} entries).`,
      )
    }
    return
  }
  const lines = [
    `[pack-contents-are-clean] ${pkg.name ?? 'package'} tarball ships ${bad} entr${bad === 1 ? 'y' : 'ies'} it must not:`,
  ]
  for (const [label, list] of [
    ['fleet/agent scaffolding', scaffolding],
    ['hidden/log files', hidden],
    ['outside the files field', outsideFiles],
  ] as const) {
    if (list.length) {
      lines.push(`  ${label}:`)
      const es = list.slice(0, 15)
      for (let i = 0, { length } = es; i < length; i += 1) {
        const e = es[i]!
        lines.push(`    ${e}`)
      }
      if (list.length > 15) {
        lines.push(`    ... and ${list.length - 15} more`)
      }
    }
  }
  lines.push(
    '',
    '  Fix: tighten package.json `files` (list only published paths) or add',
    '  the offending paths to .npmignore; scaffolding must never be listed.',
  )
  logger.fail(lines.join('\n'))
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
