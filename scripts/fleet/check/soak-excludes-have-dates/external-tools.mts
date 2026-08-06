/*
 * @file The external-tools.json half of `soak-excludes-have-dates`. The parent
 *   check reads pnpm-workspace.yaml's `minimumReleaseAgeExclude:` /
 *   `trustPolicyExclude:` bullets; this module reads the OTHER soak-bypass
 *   surface — the per-tool `soakBypass` block (`{ version, published,
 *   removable }`) an external-tools entry carries when it was bumped inside its
 *   soak window.
 *   Deciding the third defect below needs the registry's publish date, so that
 *   pass FAILS OPEN: only npm-distributed entries (`repository: "npm:<name>"`)
 *   are probed, and a spec whose date can't be resolved is skipped rather than
 *   reported. The scan itself is pure — the caller supplies the manifests and
 *   the dates. Three defects, mirroring the YAML side's vocabulary:
 *
 *   - `missing` — a block whose `published`/`removable` dates are absent or
 *     malformed, OR whose `version` names a release the entry no longer pins.
 *     Blocking: an undated bypass never disarms, and a mismatched one would
 *     otherwise mask a still-soaking pin from the `unbypassed` probe below.
 *   - `stale` — a block whose window has closed. Informational, exactly like a
 *     stale YAML bullet; `external-tools prune --apply` owns the removal.
 *   - `unbypassed` — a pin whose version is STILL inside its soak window with no
 *     block at all. Blocking: this is the npm 12.0.2 gap, a version adopted
 *     through `bump-tool --soak-bypass` with nothing recording the bypass or
 *     retiring it.
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'

import { relPath, resolveManifestPaths } from '../../external-tools/_shared.mts'
import { fetchPackagePublishDate } from '../../registry-publish-date.mts'
import { addDaysISO } from '../../soak-bypass.mts'

// The soak window a tool's publish date is measured against — the
// `minimumReleaseAge: 10080` minutes every fleet pnpm-workspace.yaml carries.
const SOAK_DAYS = 7
// The `repository` marker that makes a tool entry npm-distributed, the only
// shape whose publish date this gate can look up.
const NPM_REPOSITORY_PREFIX = 'npm:'
// A bare ISO day — the form a `soakBypass` block stores, so plain string
// comparison orders two of them chronologically.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface ExternalToolManifest {
  // Repo-relative path — what the report prints.
  path: string
  tools: Readonly<Record<string, unknown>>
}

export interface ExternalToolFinding {
  kind: 'missing' | 'stale' | 'unbypassed'
  manifest: string
  removable?: string | undefined
  tool: string
  version: string
}

/**
 * The npm package a tool entry is distributed as, or undefined when it ships
 * some other way (a GitHub release, a purl, a bare version pin).
 */
export function npmToolPackageName(entry: unknown): string | undefined {
  const repository = (entry as { repository?: unknown | undefined } | undefined)
    ?.repository
  return typeof repository === 'string' &&
    repository.startsWith(NPM_REPOSITORY_PREFIX)
    ? repository.slice(NPM_REPOSITORY_PREFIX.length)
    : undefined
}

/**
 * Every `<npm package>@<version>` an entry pins WITHOUT a `soakBypass` block —
 * the set whose publish dates decide whether a bypass was needed. Only
 * npm-distributed entries qualify (see [[npmToolPackageName]]).
 */
export function npmToolSpecsNeedingPublishDate(
  manifests: readonly ExternalToolManifest[],
): string[] {
  const specs = new Set<string>()
  for (let i = 0, { length } = manifests; i < length; i += 1) {
    const entries = Object.entries(manifests[i]!.tools)
    for (let j = 0, { length: rows } = entries; j < rows; j += 1) {
      const entry = entries[j]![1] as Record<string, unknown> | undefined
      if (!entry || entry['soakBypass']) {
        continue
      }
      const npmName = npmToolPackageName(entry)
      const version = entry['version']
      if (npmName && typeof version === 'string' && version) {
        specs.add(`${npmName}@${version}`)
      }
    }
  }
  return [...specs].toSorted()
}

/**
 * The per-tool `soakBypass` defects across the given manifests.
 * `publishedDates` maps `<npm package>@<version>` to the registry's publish day
 * (`YYYY-MM-DD`); a spec absent from the map is SKIPPED, which is how the
 * network pass fails open. Pure — the caller does the I/O.
 */
export function scanExternalToolBypasses(
  manifests: readonly ExternalToolManifest[],
  todayISO: string,
  publishedDates: ReadonlyMap<string, string>,
): ExternalToolFinding[] {
  const findings: ExternalToolFinding[] = []
  for (let i = 0, { length } = manifests; i < length; i += 1) {
    const manifest = manifests[i]!
    const entries = Object.entries(manifest.tools)
    for (let j = 0, { length: rows } = entries; j < rows; j += 1) {
      const [tool, raw] = entries[j]!
      const entry = raw as Record<string, unknown> | undefined
      if (!entry) {
        continue
      }
      const version =
        typeof entry['version'] === 'string' ? entry['version'] : ''
      const bypass = entry['soakBypass'] as
        | {
            published?: unknown | undefined
            removable?: unknown | undefined
            version?: unknown | undefined
          }
        | undefined
      if (bypass) {
        const { published, removable, version: bypassVersion } = bypass
        // A block naming a version the entry no longer pins is not a bypass for
        // THIS pin. Report it as malformed (blocking) rather than letting the
        // `bypass` branch below swallow the entry — otherwise a still-soaking pin
        // carrying a leftover block evades the `unbypassed` probe entirely.
        if (
          typeof bypassVersion !== 'string' ||
          (version !== '' && bypassVersion !== version)
        ) {
          findings.push({
            kind: 'missing',
            manifest: manifest.path,
            tool,
            version,
          })
          continue
        }
        if (
          typeof published !== 'string' ||
          !ISO_DATE_RE.test(published) ||
          typeof removable !== 'string' ||
          !ISO_DATE_RE.test(removable)
        ) {
          findings.push({
            kind: 'missing',
            manifest: manifest.path,
            tool,
            version,
          })
          continue
        }
        // The same rule the YAML bullets use: a bypass applies while
        // `removable` is today or later, and is dead weight once it has passed.
        if (removable < todayISO) {
          findings.push({
            kind: 'stale',
            manifest: manifest.path,
            removable,
            tool,
            version,
          })
        }
        continue
      }
      const npmName = npmToolPackageName(entry)
      if (!npmName || !version) {
        continue
      }
      const published = publishedDates.get(`${npmName}@${version}`)
      if (!published) {
        continue
      }
      const removable = addDaysISO(published, SOAK_DAYS)
      if (removable >= todayISO) {
        findings.push({
          kind: 'unbypassed',
          manifest: manifest.path,
          removable,
          tool,
          version,
        })
      }
    }
  }
  return findings
}

/**
 * Read the shipped external-tools manifests. A missing or unparseable file is
 * SKIPPED — manifest validity is `check-external-tools-are-valid`'s gate, and
 * this one must not double-report it.
 */
export function loadExternalToolManifests(
  manifestPaths: readonly string[],
): ExternalToolManifest[] {
  const manifests: ExternalToolManifest[] = []
  for (let i = 0, { length } = manifestPaths; i < length; i += 1) {
    const manifestPath = manifestPaths[i]!
    let tools: Record<string, unknown> | undefined
    try {
      const json = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        tools?: Record<string, unknown> | undefined
      }
      tools = json.tools
    } catch {
      continue
    }
    if (tools) {
      manifests.push({ path: relPath(manifestPath), tools })
    }
  }
  return manifests
}

/**
 * Publish dates for the specs that need one, fetched in parallel so an offline
 * run pays one timeout window rather than one per tool. A lookup that yields
 * undefined is simply absent from the map — the scan then skips that tool.
 */
export async function collectPublishDates(
  specs: readonly string[],
  fetchPublishDate: (
    name: string,
    version: string,
  ) => Promise<string | undefined>,
): Promise<Map<string, string>> {
  const dates = new Map<string, string>()
  const results = await Promise.all(
    specs.map(async spec => {
      const at = spec.lastIndexOf('@')
      const published = await fetchPublishDate(
        spec.slice(0, at),
        spec.slice(at + 1),
      )
      return { published, spec }
    }),
  )
  for (let i = 0, { length } = results; i < length; i += 1) {
    const { published, spec } = results[i]!
    if (published) {
      dates.set(spec, published)
    }
  }
  return dates
}

export interface ExternalToolScanOptions {
  // The manifests to scan. Defaults to every shipped external-tools.json; a
  // test passes its own fixture set (or none) to stay hermetic.
  manifestPaths?: readonly string[] | undefined
  // Publish-date lookup, injected so a test never touches the registry.
  fetchPublishDate?:
    | ((name: string, version: string) => Promise<string | undefined>)
    | undefined
}

/**
 * Load, date, and scan the external-tools manifests in one call — the entry
 * point the parent check uses.
 */
export async function findExternalToolBypassDefects(
  todayISO: string,
  options?: ExternalToolScanOptions | undefined,
): Promise<ExternalToolFinding[]> {
  const opts = { __proto__: null, ...options } as ExternalToolScanOptions
  const manifests = loadExternalToolManifests(
    opts.manifestPaths ?? resolveManifestPaths(),
  )
  const publishedDates = await collectPublishDates(
    npmToolSpecsNeedingPublishDate(manifests),
    opts.fetchPublishDate ?? fetchPackagePublishDate,
  )
  return scanExternalToolBypasses(manifests, todayISO, publishedDates)
}

/**
 * Print the external-tools findings and report whether any of them blocks.
 * A stale block is informational, since the prune verb removes it; a malformed
 * block or a still-soaking pin with no block at all fails the check.
 */
export function reportExternalToolFindings(
  findings: readonly ExternalToolFinding[],
): boolean {
  const missing = findings.filter(f => f.kind === 'missing')
  const stale = findings.filter(f => f.kind === 'stale')
  const unbypassed = findings.filter(f => f.kind === 'unbypassed')

  if (stale.length > 0) {
    process.stderr.write(
      `[check-soak-excludes-have-dates] ${stale.length} cleared external-tools ` +
        `soakBypass block${stale.length === 1 ? '' : 's'} ` +
        `(removable: date in the past):\n`,
    )
    for (let i = 0, { length } = stale; i < length; i += 1) {
      const f = stale[i]!
      process.stderr.write(
        `  ${f.manifest}: ${f.tool}@${f.version} (removable ${f.removable})\n`,
      )
    }
    process.stderr.write(
      `\nThe soak has cleared naturally, so the block is dead weight. Drop it with:\n` +
        `  node scripts/fleet/external-tools/prune.mts --apply\n\n`,
    )
  }

  if (missing.length > 0) {
    process.stderr.write(
      `[check-soak-excludes-have-dates] ${missing.length} malformed external-tools ` +
        `soakBypass block${missing.length === 1 ? '' : 's'} ` +
        `(missing/invalid dates, or a version the entry no longer pins):\n`,
    )
    for (let i = 0, { length } = missing; i < length; i += 1) {
      const f = missing[i]!
      process.stderr.write(`  ${f.manifest}: ${f.tool}@${f.version}\n`)
    }
    process.stderr.write(
      `\nA soakBypass block names the pinned version and carries both ISO dates, so\n` +
        `the bypass applies to a known release and disarms itself:\n` +
        `  "soakBypass": { "published": "<YYYY-MM-DD>", "removable": "<YYYY-MM-DD>", "version": "<x.y.z>" }\n` +
        `\nA block left behind by a moved pin is obsolete — drop it with:\n` +
        `  node scripts/fleet/external-tools/prune.mts --apply\n` +
        `\nReference: docs/agents.md/fleet/tooling.md "Soak time".\n\n`,
    )
  }

  if (unbypassed.length > 0) {
    process.stderr.write(
      `[check-soak-excludes-have-dates] ${unbypassed.length} external-tools ` +
        `pin${unbypassed.length === 1 ? '' : 's'} still inside the soak window ` +
        `with no soakBypass block:\n`,
    )
    for (let i = 0, { length } = unbypassed; i < length; i += 1) {
      const f = unbypassed[i]!
      process.stderr.write(
        `  ${f.manifest}: ${f.tool}@${f.version} (would be removable ${f.removable})\n`,
      )
    }
    process.stderr.write(
      `\nAdopting a version inside its soak window is a bypass — record it so it\n` +
        `is dated, auditable, and self-disarming. Re-run the bump so the planner\n` +
        `stamps the block:\n` +
        `  node scripts/repo/bump-tool.mts <tool> --soak-bypass --apply\n` +
        `\nReference: docs/agents.md/fleet/tooling.md "Soak time".\n\n`,
    )
  }

  return missing.length > 0 || unbypassed.length > 0
}
