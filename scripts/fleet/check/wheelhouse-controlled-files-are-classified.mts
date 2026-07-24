#!/usr/bin/env node
/**
 * @file Belt scan asserting every file under `template/base/` is classified
 *   into exactly one distribution channel, so the silent-drift class that
 *   shipped a stale `github-release.yml` / `npm-publish.yml` (seeded PRESETs
 *   whose root copies drifted for weeks) can never reappear. Two assertions: A
 *   (BLOCKING) — walk `template/base` on disk; every file must be reachable by
 *   one channel: `IDENTICAL_FILES` (mirror), `OPTIONAL_IDENTICAL_FILES`,
 *   `PRESET_FILES`, `CONDITIONAL_FILES`, `EXPECTED_FILES`, a `carveOut`, or a
 *   per-file native handler (`.claude/settings.json`, `README.md`,
 *   `.github/aw/actions-lock.json`). An unclassified file reaches no member and
 *   no release bundle — a defect. Sets `process.exitCode = 1`. B (REPORT-ONLY)
 *   — for THIS repo, every present byte-controlled root copy (mirror + optional
 *   file entries) must byte-match its resolved template source (base + kind +
 *   overrides, via the cascade resolver). Drift is logged but does not yet fail
 *   the gate. Wheelhouse-only in effect: `scripts/repo/` is not cascaded, so a
 *   member (no `template/base`) is a vacuous pass — same shape as
 *   bundle-is-installable. Detail:
 *   docs/agents.md/fleet/wheelhouse-controlled-drift.md.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

// The write-time guard OWNS the native-handler set; the belt scan imports it so
// the two can never disagree (importing the hook is a no-op — its runHook is
// entrypoint-guarded). Same shape as golden-fixtures-are-named-golden importing
// the golden-fixture-naming-guard predicate.
import { NATIVE_HANDLER_FILES } from '../../../.claude/hooks/fleet/_shared/native-handler-files.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { REPO_ROOT } from '../paths.mts'

// Re-exported so consumers + tests can read the native-handler set from the belt
// scan too (the write-time guard remains its single owner).
export { NATIVE_HANDLER_FILES }

const logger = getDefaultLogger()

// The byte-canonical template tree the whole fleet syncs against. Computed here
// (not imported) because scripts/fleet/paths.mts is the cascaded per-member paths
// module and never resolves the wheelhouse-only template root.
const TEMPLATE_BASE_DIR = path.join(REPO_ROOT, 'template', 'base')

/**
 * The classification model: `prefixes` are exact-or-prefix entries (a file is
 * classified if it equals one or sits under `entry + '/'`), covering every
 * manifest list entry plus the `repo/` carve-outs; `nativeHandlerFiles` are
 * exact-only extras handled by a per-file native handler.
 */
export interface ClassificationModel {
  readonly prefixes: readonly string[]
  readonly nativeHandlerFiles: readonly string[]
}

/**
 * Build the classification model from the manifest lists + carve-outs. Every
 * list is folded into `prefixes`: a file entry matches only its exact self, a
 * dir entry (mirror root / carve-out) matches everything beneath it — one
 * prefix test covers both because no file sits under a file entry.
 */
export function buildClassificationModel(input: {
  readonly identicalFiles: readonly string[]
  readonly optionalIdenticalFiles: readonly string[]
  readonly presetFiles: readonly string[]
  readonly conditionalFiles: readonly string[]
  readonly expectedFiles: readonly string[]
  readonly carveOuts: readonly string[]
  readonly nativeHandlerFiles?: readonly string[] | undefined
}): ClassificationModel {
  return {
    prefixes: [
      ...input.identicalFiles,
      ...input.optionalIdenticalFiles,
      ...input.presetFiles,
      ...input.conditionalFiles,
      ...input.expectedFiles,
      ...input.carveOuts,
    ],
    nativeHandlerFiles: input.nativeHandlerFiles ?? NATIVE_HANDLER_FILES,
  }
}

/**
 * True when `relPosix` (a repo-relative POSIX path under `template/base`) is
 * classified into some channel. Pure.
 */
export function isClassified(
  relPosix: string,
  model: ClassificationModel,
): boolean {
  if (model.nativeHandlerFiles.includes(relPosix)) {
    return true
  }
  const { prefixes } = model
  for (let i = 0, { length } = prefixes; i < length; i += 1) {
    const prefix = prefixes[i]!
    if (relPosix === prefix || relPosix.startsWith(`${prefix}/`)) {
      return true
    }
  }
  return false
}

/**
 * Walk `baseDir`, returning every file's repo-relative POSIX path (sorted).
 * Skips `.git` / `node_modules` — local state, never template content — and
 * `.DS_Store`: gitignored macOS Finder noise that respawns while a Finder
 * window is open on the tree, so counting it makes the check flap on macOS.
 */
export function walkBaseFiles(baseDir: string): string[] {
  const out: string[] = []
  function walk(dir: string, rel: string): void {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      if (
        entry.name === '.DS_Store' ||
        entry.name === '.git' ||
        entry.name === 'node_modules'
      ) {
        continue
      }
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      const childAbs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(childAbs, childRel)
      } else {
        out.push(childRel)
      }
    }
  }
  walk(baseDir, '')
  return out.toSorted()
}

/**
 * Assertion A: every `template/base` file not classified into a channel. Pure.
 */
export function findUnclassifiedFiles(
  baseDir: string,
  model: ClassificationModel,
): string[] {
  return walkBaseFiles(baseDir).filter(file => !isClassified(file, model))
}

/**
 * One byte-controlled root copy that drifted from its resolved template source.
 */
export interface RootCopyDrift {
  readonly file: string
  readonly message: string
}

/**
 * Assertion B: for each byte-controlled file entry, compare the repo's root
 * copy (when present) against its resolved template source. Pure — the resolver
 * + reader are injected so tests drive it without the real cascade engine. An
 * absent root copy (optional-when-present) or a path no layer provides for this
 * repo is skipped, not flagged.
 */
export function findRootCopyDrift(input: {
  readonly repoRoot: string
  readonly fileEntries: readonly string[]
  readonly resolveWinnerAbs: (entry: string) => string | undefined
  readonly readFile: (abs: string) => string | undefined
}): RootCopyDrift[] {
  const { fileEntries, readFile, repoRoot, resolveWinnerAbs } = input
  const findings: RootCopyDrift[] = []
  for (let i = 0, { length } = fileEntries; i < length; i += 1) {
    const entry = fileEntries[i]!
    const rootContent = readFile(path.join(repoRoot, entry))
    if (rootContent === undefined) {
      continue
    }
    const winnerAbs = resolveWinnerAbs(entry)
    if (winnerAbs === undefined) {
      continue
    }
    const winnerContent = readFile(winnerAbs)
    if (winnerContent === undefined) {
      continue
    }
    if (rootContent !== winnerContent) {
      findings.push({
        file: entry,
        message: `root copy differs from its resolved template source`,
      })
    }
  }
  return findings
}

// The carve-out (`repo/` tier) prefixes, read from the bundle manifest. Returns
// [] when the file is absent (a member) so classification simply has no
// carve-outs there.
function readCarveOuts(): string[] {
  const bundlePath = path.join(
    REPO_ROOT,
    'scripts/repo/sync-scaffolding/manifest/bundle.json',
  )
  try {
    const parsed = JSON.parse(readFileSync(bundlePath, 'utf8')) as {
      carveOuts?: readonly string[] | undefined
    }
    return Array.isArray(parsed.carveOuts) ? [...parsed.carveOuts] : []
  } catch {
    return []
  }
}

function readFileSafe(abs: string): string | undefined {
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  // Wheelhouse-only: a cascaded member ships this check but has no template/base
  // to walk (and no scripts/repo to import). Vacuous pass — same shape as
  // bundle-is-installable.mts.
  if (!existsSync(TEMPLATE_BASE_DIR)) {
    return
  }
  // scripts/repo/ is wheelhouse-only (not cascaded), so a STATIC import would
  // break every member. Import at runtime, guarded by the probe above.
  const manifestUrl = pathToFileURL(
    path.join(REPO_ROOT, 'scripts/repo/sync-scaffolding/manifest.mts'),
  ).href
  const layersUrl = pathToFileURL(
    path.join(REPO_ROOT, 'scripts/repo/sync-scaffolding/template-layers.mts'),
  ).href
  const configUrl = pathToFileURL(
    path.join(
      REPO_ROOT,
      'scripts/repo/sync-scaffolding/socket-wheelhouse-config.mts',
    ),
  ).href
  const manifest = (await import(manifestUrl)) as {
    IDENTICAL_FILES: readonly string[]
    OPTIONAL_IDENTICAL_FILES: readonly string[]
    PRESET_FILES: readonly string[]
    EXPECTED_FILES: readonly string[]
    CONDITIONAL_FILES: ReadonlyArray<{ files: readonly string[] }>
  }
  const layers = (await import(layersUrl)) as {
    resolveTemplateSource: (
      relPath: string,
      options: unknown,
    ) => { winner: string | undefined }
    layerAbsPath: (layer: string, relPath: string) => string
  }
  const config = (await import(configUrl)) as {
    composeOptionsFor: (targetDir: string) => unknown
  }

  const model = buildClassificationModel({
    identicalFiles: manifest.IDENTICAL_FILES,
    optionalIdenticalFiles: manifest.OPTIONAL_IDENTICAL_FILES,
    presetFiles: manifest.PRESET_FILES,
    conditionalFiles: manifest.CONDITIONAL_FILES.flatMap(group => group.files),
    expectedFiles: manifest.EXPECTED_FILES,
    carveOuts: readCarveOuts(),
  })

  // ── Assertion A (BLOCKING) ─────────────────────────────────────────────────
  const unclassified = findUnclassifiedFiles(TEMPLATE_BASE_DIR, model)

  // ── Assertion B (REPORT-ONLY) ──────────────────────────────────────────────
  const composeOpts = config.composeOptionsFor(REPO_ROOT)
  const byteControlledFiles = [
    ...manifest.IDENTICAL_FILES,
    ...manifest.OPTIONAL_IDENTICAL_FILES,
  ].filter(entry => {
    const abs = path.join(TEMPLATE_BASE_DIR, entry)
    return existsSync(abs) && !statSync(abs).isDirectory()
  })
  const drift = findRootCopyDrift({
    repoRoot: REPO_ROOT,
    fileEntries: byteControlledFiles,
    resolveWinnerAbs: entry => {
      const resolution = layers.resolveTemplateSource(entry, composeOpts)
      return resolution.winner === undefined
        ? undefined
        : layers.layerAbsPath(resolution.winner, entry)
    },
    readFile: readFileSafe,
  })

  if (unclassified.length === 0) {
    logger.success('every template/base file is classified into a channel')
  } else {
    logger.fail(
      `template/base file(s) classified into NO distribution channel — they reach no member and no release bundle:`,
    )
    logger.log('')
    for (let i = 0, { length } = unclassified; i < length; i += 1) {
      logger.log(`  ${unclassified[i]!}`)
    }
    logger.log('')
    logger.log(
      '  Fix: classify each into a channel (mirror / optional / preset /',
    )
    logger.log(
      '  conditional / expected / carveOut / overrides / native handler) —',
    )
    logger.log('  edit template/base/... then re-cascade:')
    logger.log('    node scripts/repo/sync.mts')
    logger.log('  Detail: docs/agents.md/fleet/wheelhouse-controlled-drift.md')
    process.exitCode = 1
  }

  // DISABLED SEAM: report-only until the fleet-wide cascade lands; flip to
  // exitCode=1 after.
  if (drift.length > 0) {
    logger.warn(
      `[report-only] ${drift.length} wheelhouse-controlled root cop(y/ies) drifted from template/base:`,
    )
    for (let i = 0, { length } = drift; i < length; i += 1) {
      logger.log(`  ${drift[i]!.file} — ${drift[i]!.message}`)
    }
    logger.log(
      '  Fix: edit template/base/... then re-cascade: node scripts/repo/sync.mts',
    )
    logger.log('  Detail: docs/agents.md/fleet/wheelhouse-controlled-drift.md')
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(
      `wheelhouse-controlled-files-are-classified failed: ${String(e)}`,
    )
    process.exitCode = 1
  })
}
