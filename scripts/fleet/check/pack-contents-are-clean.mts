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
// It also gates the PACKED MANIFEST's lifecycle scripts: every declared
// preinstall/install/postinstall/prepare/prepack must resolve to a file
// INSIDE the tarball — the consumer's installer runs these from the tarball
// alone, so a repo-only target breaks every install (the sdk 4.0.3 manifest
// shipped `preinstall` → scripts/fleet/setup/… with no such file packed).
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

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
// oxlint-disable-next-line socket/prefer-async-spawn -- sync CLI check; pack + tar listing are sequential by nature.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { findDanglingLifecycleScripts } from '../_shared/lifecycle-scripts.mts'
import { isCoveredByFiles } from '../_shared/pack-files.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { resolveReleaseSubject } from '../_shared/release-subject.mts'
import { withPrunedPackManifest } from '../publish-infra/npm/pack-manifest.mts'

import type { DanglingLifecycleScript } from '../_shared/lifecycle-scripts.mts'

// Re-exported for the isCoveredByFiles consumers/tests that import it from
// this check — the implementation moved to _shared/pack-files.mts so the
// publish pack surface shares the one files-field matcher.
export { isCoveredByFiles } from '../_shared/pack-files.mts'

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

export interface PackInspection {
  /**
   * Tarball entries, stripped of the leading `package/`.
   */
  readonly entries: string[]
  /**
   * The `scripts` map of the PACKED package.json (what consumers install).
   */
  readonly packedScripts: Record<string, unknown> | undefined
}

/**
 * The dangling lifecycle scripts of a PACKED manifest: every declared
 * preinstall/install/postinstall/prepare/prepack whose `node <path>` target
 * is not a tarball entry. Consumers run these from the tarball alone, so any
 * hit is a broken install. Pure.
 */
export function findPackedManifestDanglers(
  packedScripts: Record<string, unknown> | undefined,
  entries: readonly string[],
): DanglingLifecycleScript[] {
  const entrySet = new Set(entries.map(e => normalizePath(e)))
  return findDanglingLifecycleScripts(packedScripts, rel =>
    entrySet.has(normalizePath(rel)),
  )
}

/**
 * Pack the package at `pkgRoot` into a temp dir and return the tarball's
 * entry list (stripped of the leading `package/`) plus the packed manifest's
 * `scripts` map. Undefined on pack/tar failure (the caller fails loud).
 */
export function packAndInspect(pkgRoot: string): PackInspection | undefined {
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
  const entries = String(listed.stdout ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .map(e => e.replace(/^package\//, ''))
  // The manifest consumers actually install is the one INSIDE the tarball —
  // the on-disk manifest can differ (pnpm's exportable rewrite, the publish
  // pipeline's pack-time pruning), so read the packed bytes.
  const manifestRead = spawnSync(
    'tar',
    ['-xzOf', tarball, 'package/package.json'],
    { timeout: 60_000 },
  )
  if (manifestRead.status !== 0) {
    return undefined
  }
  let packedScripts: Record<string, unknown> | undefined
  try {
    const packedManifest = JSON.parse(String(manifestRead.stdout ?? '')) as {
      scripts?: Record<string, unknown> | undefined
    }
    packedScripts = packedManifest.scripts
  } catch {
    return undefined
  }
  return { entries, packedScripts }
}

async function main(): Promise<void> {
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
  // Pack through the SAME manifest-prune bracket the publish pipeline packs
  // through, so this gate verifies the sanctioned pack surface end-to-end: a
  // pruning regression leaves the dangling lifecycle ref in the packed
  // manifest and this check goes red.
  const subject = resolveReleaseSubject(REPO_ROOT)
  const inspection = await withPrunedPackManifest(subject.dir, async () =>
    packAndInspect(REPO_ROOT),
  )
  if (!inspection) {
    logger.fail(
      '[pack-contents-are-clean] pnpm pack (or tar listing) failed — cannot verify the tarball. Run `pnpm pack` manually to see the error.',
    )
    process.exitCode = 1
    return
  }
  const { entries, packedScripts } = inspection
  const { hidden, outsideFiles, scaffolding } = classifyPackEntries(
    entries,
    pkg.files,
  )
  const danglers = findPackedManifestDanglers(packedScripts, entries)
  if (danglers.length) {
    const lines = [
      `[pack-contents-are-clean] ${pkg.name ?? 'package'} PACKED manifest declares ${danglers.length} lifecycle script${danglers.length === 1 ? '' : 's'} whose target is not in the tarball — consumer installs will break:`,
    ]
    for (const d of danglers) {
      lines.push(
        `  ${d.name}: ${d.command}`,
        `    missing from tarball: ${d.missing.join(', ')}`,
      )
    }
    lines.push(
      '',
      '  Fix: drop the repo-only lifecycle script from the published manifest',
      '  (the publish pipeline prunes these at pack time via',
      '  publish-infra/npm/pack-manifest.mts) or ship the target in `files`.',
    )
    logger.fail(lines.join('\n'))
    process.exitCode = 1
  }
  const bad = scaffolding.length + hidden.length + outsideFiles.length
  if (bad === 0) {
    if (!quiet && danglers.length === 0) {
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
  // No top-level await (CJS bundle target): fail the process loud on an
  // unexpected rejection instead.
  main().catch((e: unknown) => {
    logger.fail(`[pack-contents-are-clean] ${errorMessage(e)}`)
    process.exitCode = 1
  })
}
