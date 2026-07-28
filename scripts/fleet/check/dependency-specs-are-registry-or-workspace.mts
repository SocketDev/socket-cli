#!/usr/bin/env node
/*
 * @file Commit-time gate: every committed dependency spec must be a PIN, and
 *   the fleet prefers `catalog:`, itself exact-pinned in the fleet catalog
 *   over an exact registry version, and both over `workspace:1.2.3` — one
 *   central catalog bump beats a manifest bump per dependent on every sibling
 *   release. Order + rationale:
 *   `docs/agents.md/fleet/dependency-spec-pinning.md`.
 *   The classifier is shared with the edit-time
 *   `link-protocol-dep-guard` hook
 *   (`.claude/hooks/fleet/_shared/dependency-spec-forms.mts`) so the two tiers
 *   cannot drift.
 *
 *   Three violating classes across two surfaces:
 *
 *   1. **`package.json` local-path** — a `link:`/`file:` spec in any
 *      dependency block. The dependency resolves to a directory on the
 *      installing machine, which means the package it names is UNPUBLISHED.
 *      That is release work: publish the package (reserve the name + wire
 *      trusted publishing via `scripts/fleet/publish-infra/{npm,cargo}/`),
 *      then depend on the published version.
 *   2. **`package.json` workspace range** — `workspace:*` / `workspace:^1.2.3`
 *      float which sibling version an install resolves, and pnpm expands the
 *      range at publish time into a range consumers inherit.
 *      `workspace:1.2.3` is the pinned form.
 *   3. **`pnpm-lock.yaml`** — a `link:`/`file:` spec pnpm GENERATED because a
 *      `packages:` glob in `pnpm-workspace.yaml` covers a generated or
 *      gitignored directory. With `linkWorkspacePackages: true` pnpm resolves
 *      the matching dependency to the local directory instead of the registry,
 *      and the committed lockfile then depends on artifacts absent from a
 *      fresh clone. No manifest edit happens in that flow, so the edit-time
 *      guard can never see it. A lockfile `link:` whose target IS a
 *      git-tracked package directory is the normal representation of a
 *      workspace dependency and is not flagged; a lockfile `file:` is flagged
 *      whatever its target, because `file:` is disallowed outright.
 *
 *   Two further classes are DETECTED and REPORTED but never fail the gate:
 *
 *   - bare registry ranges (`^1.2.3`, `>=5.0.0`), staged while the fleet's
 *     remaining bare ranges convert — `isBlockingSpecKind` is the seam;
 *   - `workspace:1.2.3` pins, listed as the `catalog:` conversion backlog.
 *     These are legal and stay legal: a repo whose sibling is not published
 *     yet has nowhere else to go.
 *
 *   `peerDependencies` are permanently exempt from the range classes — a peer
 *   range states the span of host versions a package supports.
 *
 *   Usage: node scripts/fleet/check/dependency-specs-are-registry-or-workspace.mts [--quiet]
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  collectDependencySpecFindings,
  isBlockingSpecKind,
  localPathProtocol,
} from '../../../.claude/hooks/fleet/_shared/dependency-spec-forms.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { REPO_ROOT } from '../paths.mts'

import type { DependencySpecKind } from '../../../.claude/hooks/fleet/_shared/dependency-spec-forms.mts'

const logger = getDefaultLogger()

export {
  isRegistryRangeSpec,
  isWorkspaceRangeSpec,
  localPathProtocol,
} from '../../../.claude/hooks/fleet/_shared/dependency-spec-forms.mts'

// Path segments whose manifests are DATA, not this repo's dependency surface:
// vendored upstream corpora and test fixtures that deliberately exercise
// local-path resolution.
const SKIPPED_SEGMENTS = new Set([
  '__fixtures__',
  'external',
  'fixtures',
  'node_modules',
  'third_party',
  'upstream',
  'vendor',
])

export interface SpecViolation {
  readonly detail: string
  readonly file: string
  readonly kind: DependencySpecKind
  readonly subject: string
  readonly value: string
}

export interface LockfileLink {
  readonly importer: string
  readonly line: number
  readonly name: string
  readonly target: string
  readonly value: string
}

const MANIFEST_DETAIL: Record<DependencySpecKind, string> = {
  'local-path':
    'hand-written local-path spec — the package it names is unpublished',
  'registry-range': 'floating registry range where a pin belongs',
  'workspace-pin': 'legal pin, but `catalog:` is the preferred fleet form',
  'workspace-range':
    'floating `workspace:` range where a `catalog:` reference belongs',
}

// Whether a repo-relative path sits inside a tree whose manifests are data.
export function isSkippedPath(relPath: string): boolean {
  const segments = normalizePath(relPath).split('/')
  for (let i = 0, { length } = segments; i < length; i += 1) {
    if (SKIPPED_SEGMENTS.has(segments[i]!)) {
      return true
    }
  }
  return false
}

// Collect every out-of-contract spec declared in a package.json's dependency
// surface. Pure over the file text so unit tests need no fixture tree.
export function collectManifestViolations(
  file: string,
  text: string,
): SpecViolation[] {
  try {
    JSON.parse(text)
  } catch (e) {
    // An unparseable package.json outside a skipped tree is a repo defect the
    // OWNING check reports; this gate only cares about dependency specs, so
    // name the file loudly and move on rather than dying mid-scan with no path.
    logger.warn(
      `dependency-specs check: skipping unparseable ${file}: ${errorMessage(e)}`,
    )
    return []
  }
  const findings = collectDependencySpecFindings(text)
  const out: SpecViolation[] = []
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]!
    out.push({
      detail: MANIFEST_DETAIL[finding.kind],
      file,
      kind: finding.kind,
      subject: `${finding.field}.${finding.name}`,
      value: finding.value,
    })
  }
  return out
}

// `importers:` opens the block; any other column-0 key closes it.
const IMPORTERS_HEADER = /^importers:\s*$/
const TOP_LEVEL_KEY = /^[A-Za-z_][\w-]*:/
// An importer path key sits at exactly two spaces of indent: `  napi/decmpfs:`
// (optionally quoted, optionally with a trailing `{}` for an empty importer).
const IMPORTER_KEY = /^ {2}'?(?<importer>[^'\s:]+)'?:\s*(?:\{\s*\}\s*)?$/
// A resolved spec line: `        version: link:../darwin-arm64`.
const VERSION_LINE = /^\s+version:\s*(?<value>(?:file|link):\S+)\s*$/
// The dependency name above the version line: `      'pkg-name':`.
const DEP_NAME_KEY = /^ {6}'?(?<name>[^'\s:]+)'?:\s*$/

// Resolve a lockfile `link:`/`file:` spec to a repo-relative directory. The
// path is relative to the IMPORTER's directory, not the repo root.
export function resolveLinkTarget(importer: string, value: string): string {
  const spec = value.slice(value.indexOf(':') + 1)
  const importerDir = importer === '.' ? '' : importer
  return normalizePath(path.posix.normalize(path.posix.join(importerDir, spec)))
}

// Extract every `link:`/`file:` resolution from a pnpm lockfile's `importers:`
// block, resolved to a repo-relative directory. Pure over the file text.
export function parseLockfileLinks(text: string): LockfileLink[] {
  const out: LockfileLink[] = []
  const lines = text.split('\n')
  let inImporters = false
  let importer = ''
  let pendingName = ''
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (IMPORTERS_HEADER.test(line)) {
      inImporters = true
      continue
    }
    if (!inImporters) {
      continue
    }
    if (line !== '' && TOP_LEVEL_KEY.test(line)) {
      inImporters = false
      continue
    }
    const importerMatch = IMPORTER_KEY.exec(line)
    if (importerMatch) {
      importer = importerMatch.groups!['importer']!
      pendingName = ''
      continue
    }
    const nameMatch = DEP_NAME_KEY.exec(line)
    if (nameMatch) {
      pendingName = nameMatch.groups!['name']!
      continue
    }
    const versionMatch = VERSION_LINE.exec(line)
    if (versionMatch && importer !== '') {
      const value = versionMatch.groups!['value']!
      out.push({
        importer,
        line: i + 1,
        name: pendingName,
        target: resolveLinkTarget(importer, value),
        value,
      })
    }
  }
  return out
}

// A lockfile `link:` is legitimate when its target directory carries a
// git-tracked package.json — that is a real workspace member. Anything else
// points outside the committed tree. A lockfile `file:` is a violation
// whatever its target: `file:` is disallowed outright.
export function collectLockfileViolations(
  file: string,
  links: readonly LockfileLink[],
  trackedDirs: ReadonlySet<string>,
): SpecViolation[] {
  const out: SpecViolation[] = []
  for (let i = 0, { length } = links; i < length; i += 1) {
    const link = links[i]!
    const protocol = localPathProtocol(link.value)
    const where = `(importer \`${link.importer}\`, line ${link.line})`
    if (protocol === 'file') {
      out.push({
        detail: `\`file:\` resolution to \`${link.target}/\` ${where} — \`file:\` is disallowed outright, tracked target or not`,
        file,
        kind: 'local-path',
        subject: link.name === '' ? link.target : link.name,
        value: link.value,
      })
      continue
    }
    if (trackedDirs.has(link.target)) {
      continue
    }
    out.push({
      detail: `pnpm-generated link to untracked dir \`${link.target}/\` ${where} — that package is unpublished`,
      file,
      kind: 'local-path',
      subject: link.name === '' ? link.target : link.name,
      value: link.value,
    })
  }
  return out
}

// Repo-relative directories that carry a git-TRACKED package.json. A dir that
// only exists as generated output is absent here, which is exactly the signal.
export function trackedPackageDirs(tracked: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (let i = 0, { length } = tracked; i < length; i += 1) {
    const rel = normalizePath(tracked[i]!)
    if (!rel.endsWith('package.json')) {
      continue
    }
    const dir = path.posix.dirname(rel)
    out.add(dir === '.' ? '' : dir)
  }
  return out
}

async function listTrackedFiles(): Promise<string[] | undefined> {
  try {
    const result = (await spawn('git', ['ls-files'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      stdioString: true,
    })) as { stdout?: string | undefined }
    return String(result?.stdout ?? '')
      .split('\n')
      .filter(line => line !== '')
  } catch {
    return undefined
  }
}

const FIX_LINES: readonly string[] = [
  'Fix — `catalog:` is the PREFERRED fleet form. It pins hard (catalog',
  'entries are exact-pinned in .config/fleet/pnpm-workspace.fleet.yaml) and',
  'one central bump upgrades every repo, instead of a manifest bump per',
  'dependent on every release. Preference order: `catalog:` > exact `1.2.3`',
  '> `workspace:1.2.3` (fallback). Detail:',
  'docs/agents.md/fleet/dependency-spec-pinning.md',
  '',
  '1. PUBLISH THE PACKAGE, THEN GO THROUGH THE CATALOG. A dependency that',
  'resolves to a local path names a package nobody can install. Reserve the',
  'name and wire trusted publishing:',
  '  node scripts/fleet/publish-infra/npm/placeholder.mts',
  '  node scripts/fleet/publish-infra/cargo/placeholder.mts',
  '  node scripts/fleet/publish-infra/cargo/trusted-publisher.mts',
  'Add the published version to the fleet catalog, then depend on it as',
  '`catalog:`. `file:` is disallowed outright — convert it even when the',
  'target is tracked.',
  '',
  '2. REPLACE A `workspace:` RANGE WITH `catalog:`. Publish the sibling if',
  'it is not published yet, add it to the fleet catalog, and reference it',
  'as `catalog:`. Use an exact `1.2.3` when the package does not belong in',
  'the fleet-wide catalog. `workspace:1.2.3` stays legal as a FALLBACK for',
  'a sibling that genuinely cannot be published — it is not the',
  'recommended destination.',
  '',
  '3. NARROW A `packages:` GLOB. A pnpm-GENERATED lockfile link to an',
  'untracked dir means a `packages:` glob in pnpm-workspace.yaml covers',
  'generated/gitignored output; nobody typed the spec. Drop the glob and',
  'regenerate the lockfile.',
  '',
  'Worked example — decmpfs shipped five `link:` entries pointing at',
  '`napi/decmpfs/npm/<triple>/`, which are gitignored napi build output.',
  'The fix was dropping `napi/decmpfs/npm/*` from `packages:` so the',
  'per-platform packages resolve from the registry and the publish engine',
  'finds them by convention.',
]

function reportViolations(violations: readonly SpecViolation[]): void {
  logger.fail(
    'dependency-specs-are-registry-or-workspace: unpinned dependency specs found',
  )
  logger.log('')
  logger.log(
    'What: a committed dependency spec is not a pin — it resolves through a local filesystem path (so the package it names is unpublished) or through a floating range.',
  )
  logger.log('')
  logger.log('Where:')
  for (let i = 0, { length } = violations; i < length; i += 1) {
    const violation = violations[i]!
    logger.substep(violation.file)
    logger.substep(`${violation.subject}: "${violation.value}"`)
    logger.substep(violation.detail)
  }
  logger.log('')
  logger.log(
    'Saw: `link:` / `file:` (an arbitrary local path) or a `workspace:` range.',
  )
  logger.log(
    'Wanted: a published package reached through the fleet catalog — `catalog:` first, an exact registry version second, `workspace:1.2.3` only as a fallback.',
  )
  logger.log('')
  for (let i = 0, { length } = FIX_LINES; i < length; i += 1) {
    logger.log(FIX_LINES[i]!)
  }
}

function listAdvisory(violations: readonly SpecViolation[]): void {
  for (let i = 0, { length } = violations; i < length; i += 1) {
    const violation = violations[i]!
    logger.substep(
      `${violation.file} — ${violation.subject}: "${violation.value}"`,
    )
  }
}

function reportRegistryRanges(violations: readonly SpecViolation[]): void {
  logger.log('')
  logger.warn(
    `dependency-specs-are-registry-or-workspace: ${violations.length} floating registry range(s) — REPORT ONLY, not failing the gate yet.`,
  )
  listAdvisory(violations)
  logger.log(
    'Convert each to `catalog:` (preferred) or an exact version. `peerDependencies` are exempt: a peer range states the span of hosts a package supports.',
  )
}

// The `catalog:` conversion backlog. `workspace:1.2.3` is a legal pin, so this
// never fails the gate — a repo whose sibling is not published yet has nowhere
// else to go. Reporting it keeps the preferred form visible.
function reportWorkspacePins(violations: readonly SpecViolation[]): void {
  logger.log('')
  logger.warn(
    `dependency-specs-are-registry-or-workspace: ${violations.length} \`workspace:<exact>\` pin(s) — prefer \`catalog:\`. REPORT ONLY, never fails the gate.`,
  )
  listAdvisory(violations)
  logger.log(
    'Publish the sibling, add it to `.config/fleet/pnpm-workspace.fleet.yaml`, and depend on it as `catalog:` — one central bump replaces a manifest bump per dependent. Keep `workspace:<exact>` only where the sibling genuinely cannot be published.',
  )
}

async function main(): Promise<void> {
  const tracked = await listTrackedFiles()
  if (tracked === undefined) {
    // git unavailable — vacuous, never a false-green failure on a non-git tree.
    return
  }
  const packageDirs = trackedPackageDirs(tracked)
  const violations: SpecViolation[] = []
  for (let i = 0, { length } = tracked; i < length; i += 1) {
    const rel = normalizePath(tracked[i]!)
    if (isSkippedPath(rel)) {
      continue
    }
    const base = path.posix.basename(rel)
    if (base !== 'package.json' && base !== 'pnpm-lock.yaml') {
      continue
    }
    let text: string
    try {
      text = await fs.readFile(path.join(REPO_ROOT, rel), 'utf8')
    } catch {
      continue
    }
    if (base === 'package.json') {
      violations.push(...collectManifestViolations(rel, text))
    } else {
      violations.push(
        ...collectLockfileViolations(
          rel,
          parseLockfileLinks(text),
          packageDirs,
        ),
      )
    }
  }
  const blocking = violations.filter(violation =>
    isBlockingSpecKind(violation.kind),
  )
  const registryRanges = violations.filter(
    violation => violation.kind === 'registry-range',
  )
  const workspacePins = violations.filter(
    violation => violation.kind === 'workspace-pin',
  )
  if (blocking.length === 0) {
    if (!process.argv.includes('--quiet')) {
      logger.success(
        'dependency-specs-are-registry-or-workspace: every dependency spec is a pin — `catalog:` (preferred), an exact registry version, or `workspace:<exact>`.',
      )
    }
  } else {
    reportViolations(blocking)
  }
  if (registryRanges.length > 0) {
    reportRegistryRanges(registryRanges)
  }
  if (workspacePins.length > 0) {
    reportWorkspacePins(workspacePins)
  }
  if (blocking.length > 0) {
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    logger.fail(
      'dependency-specs-are-registry-or-workspace failed:',
      errorMessage(error),
    )
    process.exitCode = 1
  })
}
