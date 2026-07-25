#!/usr/bin/env node
/*
 * @file Fleet-wide check: the `@lockstep-mirror` lint/format exemption can only
 *   land on a GENUINE verbatim mirror, and every declared mirror is actually
 *   protected. The marker (grammar in the oxlint plugin's comment-markers.mts)
 *   exempts a file from the fidelity rules in LOCKSTEP_MIRROR_EXEMPT_RULES and,
 *   via a derived .prettierignore block, from oxfmt. Left unchecked that is a
 *   paste-anywhere escape hatch, so this gate ties the marker to the lockstep
 *   manifest in both directions:
 *
 *   1. FORWARD (anti-abuse): a marked file must be covered by a `file-fork` row
 *      with `mirror: true` whose `local` resolves to it, `upstream_path` equals
 *      the marker path, and `forked_at_sha` equals the marker sha. A marked
 *      file with no covering row — or a row whose path/sha disagrees — fails.
 *   2. REVERSE: a row declared `mirror: true` missing its header marker or its
 *      .prettierignore entry fails, so a declared mirror can't be left
 *      unprotected.
 *   3. FORMAT-BLOCK: the generated `lockstep-mirrors` block in
 *      .config/fleet/.prettierignore must exactly equal the manifest-derived
 *      glob set (regenerate with `pnpm run lockstep:emit-mirror-globs`), so the
 *      format-skip set can never grow past declared mirrors.
 *   4. MEMBERSHIP (defense-in-depth): a file-scope `oxlint-disable` on a marked
 *      mirror may name only rules in LOCKSTEP_MIRROR_EXEMPT_RULES.
 *
 *   A repo with NO lockstep manifest (not enrolled in lockstep) VACUOUS-PASSES
 *   the declared-mirror gates — nothing is declared, so there is nothing to
 *   verify — while the FORWARD anti-abuse gate and the FORMAT-BLOCK gate still
 *   run against the empty set (a marker or a stray .prettierignore glob with no
 *   manifest is still a violation). Exit: 0 = all gates pass; 1 = at least one
 *   violation. Usage: node
 *   scripts/fleet/check/lockstep-mirror-markers-are-declared.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { parseLockstepMirrorMarker } from '../../../.config/fleet/oxlint-plugin/lib/comment-markers.mts'
import { isLockstepMirrorExemptRule } from '../../../.config/fleet/oxlint-plugin/lib/lockstep-mirror.mts'
import { resolveManifestRoot } from '../lockstep/manifest.mts'
import {
  collectDeclaredMirrors,
  derivedMirrorGlobs,
  extractMirrorBlock,
  mirrorGlob,
} from '../lockstep/mirror-globs.mts'
import type { DeclaredMirror } from '../lockstep/mirror-globs.mts'
import { CONFIG_FLEET_DIR, REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const PRETTIERIGNORE_PATH = path.join(CONFIG_FLEET_DIR, '.prettierignore')

// A file-scope `oxlint-disable <rules>` directive (NOT `-next-line`), capturing
// the rule-name list. Mirrors no-file-scope-oxlint-disable's own detector.
const FILE_SCOPE_DISABLE_RE =
  /(?:\/\*|\/\/)\s*oxlint-disable(?!-next-line)\s+([^*\n]+)/

export interface MarkedFile {
  readonly file: string
  readonly upstreamPath: string
  readonly sha: string
}

export interface Violation {
  readonly file: string
  readonly message: string
}

/**
 * FORWARD gate: every marked file must be covered by a `mirror: true` row whose
 * `local` resolves to it, with agreeing upstream path + sha.
 */
export function findUndeclaredMarkers(
  marked: readonly MarkedFile[],
  mirrors: readonly DeclaredMirror[],
): Violation[] {
  const byLocal = new Map<string, DeclaredMirror>()
  for (let i = 0, { length } = mirrors; i < length; i += 1) {
    byLocal.set(normalizePath(mirrors[i]!.local), mirrors[i]!)
  }
  const violations: Violation[] = []
  for (let i = 0, { length } = marked; i < length; i += 1) {
    const m = marked[i]!
    const row = byLocal.get(normalizePath(m.file))
    if (!row) {
      violations.push({
        file: m.file,
        message:
          'carries a @lockstep-mirror marker but no `file-fork` row with `mirror: true` declares it. Add the row (or remove the marker — the exemption is only for genuine verbatim mirrors).',
      })
      continue
    }
    if (normalizePath(row.upstreamPath) !== normalizePath(m.upstreamPath)) {
      violations.push({
        file: m.file,
        message: `marker upstream path \`${m.upstreamPath}\` disagrees with the row's \`upstream_path\` (\`${row.upstreamPath}\`).`,
      })
    }
    if (row.sha !== m.sha) {
      violations.push({
        file: m.file,
        message: `marker sha \`${m.sha}\` disagrees with the row's \`forked_at_sha\` (\`${row.sha}\`) — the mirror has drifted from its pin.`,
      })
    }
  }
  return violations
}

/**
 * REVERSE gate: every declared mirror row must have its file carrying a
 * matching marker AND a covering .prettierignore glob.
 */
export function findUnprotectedMirrors(
  mirrors: readonly DeclaredMirror[],
  markedByLocal: ReadonlyMap<string, MarkedFile>,
  prettierGlobs: ReadonlySet<string>,
): Violation[] {
  const violations: Violation[] = []
  for (let i = 0, { length } = mirrors; i < length; i += 1) {
    const row = mirrors[i]!
    const marked = markedByLocal.get(normalizePath(row.local))
    if (!marked) {
      violations.push({
        file: row.local,
        message: `is declared \`mirror: true\` (row \`${row.id}\`) but is missing the \`// @lockstep-mirror ${row.upstreamPath} @ ${row.sha}\` header marker.`,
      })
    }
    if (!prettierGlobs.has(mirrorGlob(row.local))) {
      violations.push({
        file: row.local,
        message: `is declared \`mirror: true\` (row \`${row.id}\`) but has no \`${mirrorGlob(row.local)}\` entry in the .prettierignore lockstep-mirrors block. Run \`pnpm run lockstep:emit-mirror-globs\`.`,
      })
    }
  }
  return violations
}

/**
 * FORMAT-BLOCK gate: the .prettierignore block must exactly equal the derived
 * globs (order-insensitive — the deriver sorts).
 */
export function findBlockDrift(
  blockGlobs: readonly string[] | undefined,
  derivedGlobs: readonly string[],
): Violation[] {
  if (blockGlobs === undefined) {
    if (derivedGlobs.length === 0) {
      return []
    }
    return [
      {
        file: '.config/fleet/.prettierignore',
        message:
          'has no `# BEGIN lockstep-mirrors (generated)` block. Run `pnpm run lockstep:emit-mirror-globs`.',
      },
    ]
  }
  const have = new Set(blockGlobs)
  const want = new Set(derivedGlobs)
  const violations: Violation[] = []
  for (const g of want) {
    if (!have.has(g)) {
      violations.push({
        file: '.config/fleet/.prettierignore',
        message: `lockstep-mirrors block is missing \`${g}\`. Run \`pnpm run lockstep:emit-mirror-globs\`.`,
      })
    }
  }
  for (const g of have) {
    if (!want.has(g)) {
      violations.push({
        file: '.config/fleet/.prettierignore',
        message: `lockstep-mirrors block has stray \`${g}\` with no matching \`mirror: true\` row. Run \`pnpm run lockstep:emit-mirror-globs\`.`,
      })
    }
  }
  return violations
}

/**
 * MEMBERSHIP gate: a file-scope `oxlint-disable` on a marked mirror may name
 * only rules in LOCKSTEP_MIRROR_EXEMPT_RULES.
 */
export function findIllegalDisables(
  file: string,
  sourceText: string,
): Violation[] {
  const violations: Violation[] = []
  const lines = sourceText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const m = FILE_SCOPE_DISABLE_RE.exec(lines[i]!)
    if (!m) {
      continue
    }
    const names = m[1]!
      .replace(/\*\/\s*$/, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    const illegal = names.filter(n => !isLockstepMirrorExemptRule(n))
    if (illegal.length) {
      violations.push({
        file,
        message: `file-scope \`oxlint-disable\` on a lockstep mirror names non-exempt rule(s): ${illegal.join(', ')}. Only LOCKSTEP_MIRROR_EXEMPT_RULES may be disabled file-scope on a mirror.`,
      })
    }
  }
  return violations
}

/**
 * The declared mirrors for a repo — or the EMPTY set when the repo carries no
 * lockstep manifest at `rootManifestPath`. A repo not enrolled in lockstep has
 * nothing to declare, so the declared-mirror gates VACUOUS-PASS instead of
 * failing on "manifest not found" (readManifest exits 1 on an absent file).
 * The FORWARD anti-abuse gate and the FORMAT-BLOCK gate still run against the
 * empty set: a `@lockstep-mirror` marker — or a stray .prettierignore glob —
 * in an unenrolled repo is exactly the paste-anywhere escape hatch this check
 * exists to reject.
 */
export function declaredMirrorsIfEnrolled(
  rootManifestPath: string,
): DeclaredMirror[] {
  return existsSync(rootManifestPath)
    ? collectDeclaredMirrors(rootManifestPath)
    : []
}

/**
 * Every tracked source file carrying a well-formed `@lockstep-mirror` HEADER
 * marker (parsed via the shared grammar so a prose/fixture mention deeper in a
 * file never counts). `git grep -l` narrows the candidate set; the parser is
 * authoritative on header position + well-formedness.
 */
export function scanMarkedFiles(rootDir: string): MarkedFile[] {
  const grep = spawnSync(
    'git',
    [
      'grep',
      '-l',
      '@lockstep-mirror',
      '--',
      '*.mts',
      '*.ts',
      '*.js',
      '*.mjs',
      '*.cts',
      '*.cjs',
    ],
    { cwd: rootDir, stdio: 'pipe', stdioString: true },
  )
  // `git grep -l` exits 1 with no output when there are no matches.
  const candidates = String(grep.stdout ?? '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
  const marked: MarkedFile[] = []
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const rel = candidates[i]!
    const abs = path.join(rootDir, rel)
    if (!existsSync(abs)) {
      continue
    }
    const parsed = parseLockstepMirrorMarker(readFileSync(abs, 'utf8'))
    if (parsed) {
      marked.push({
        file: rel,
        upstreamPath: parsed.upstreamPath,
        sha: parsed.sha,
      })
    }
  }
  return marked
}

function report(violations: readonly Violation[]): void {
  for (let i = 0, { length } = violations; i < length; i += 1) {
    const v = violations[i]!
    logger.error(`  ${v.file}`)
    logger.log(`    ${v.message}`)
  }
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const rootManifest = resolveManifestRoot(REPO_ROOT)
  const enrolled = existsSync(rootManifest)
  const mirrors = declaredMirrorsIfEnrolled(rootManifest)
  const marked = scanMarkedFiles(REPO_ROOT)

  const markedByLocal = new Map<string, MarkedFile>()
  for (let i = 0, { length } = marked; i < length; i += 1) {
    markedByLocal.set(normalizePath(marked[i]!.file), marked[i]!)
  }

  const prettierContent = existsSync(PRETTIERIGNORE_PATH)
    ? readFileSync(PRETTIERIGNORE_PATH, 'utf8')
    : ''
  const blockGlobs = extractMirrorBlock(prettierContent)
  const prettierGlobSet = new Set(blockGlobs ?? [])
  const derived = derivedMirrorGlobs(mirrors)

  const violations: Violation[] = [
    ...findUndeclaredMarkers(marked, mirrors),
    ...findUnprotectedMirrors(mirrors, markedByLocal, prettierGlobSet),
    ...findBlockDrift(blockGlobs, derived),
  ]
  for (let i = 0, { length } = marked; i < length; i += 1) {
    const rel = marked[i]!.file
    const abs = path.join(REPO_ROOT, rel)
    if (existsSync(abs)) {
      violations.push(...findIllegalDisables(rel, readFileSync(abs, 'utf8')))
    }
  }

  if (violations.length === 0) {
    if (!quiet) {
      logger.success(
        enrolled
          ? `lockstep-mirror markers are declared (${mirrors.length} mirror${mirrors.length === 1 ? '' : 's'}).`
          : 'lockstep-mirror markers are declared (no lockstep manifest — nothing to declare).',
      )
    }
    return
  }
  logger.error(
    `lockstep-mirror-markers-are-declared: ${violations.length} violation${violations.length === 1 ? '' : 's'}.`,
  )
  report(violations)
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
