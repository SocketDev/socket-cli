/**
 * @file Enforce wheelhouse soak-exclude ⊆ EXPECTED_RELEASE_AGE_EXCLUDE. Past
 *   incident (2026-05-31, cascade@4ec6212c): wheelhouse's own
 *   `pnpm-workspace.yaml` listed `@oxc-project/types@0.133.0` in
 *   `minimumReleaseAgeExclude:` because it's a transitive dep of rolldown@1.0.3
 *   that hasn't soaked yet — but `EXPECTED_RELEASE_AGE_EXCLUDE` (the
 *   cascade-canonical list in `scripts/sync-scaffolding/manifest.mts`) was
 *   missing it. Every fleet repo's cascade applied the workspace yaml changes
 *   from elsewhere but didn't inherit this entry, so every downstream `pnpm
 *   install` rejected rolldown@1.0.3's transitive dep with
 *   `[ERR_PNPM_NO_MATURE_MATCHING_VERSION]`. The invariant: **anything
 *   wheelhouse needs to install (its own soak-exclude block) must be in
 *   `EXPECTED_RELEASE_AGE_EXCLUDE` so it propagates to every fleet repo via the
 *   cascade**. Bare names (`@socketsecurity/*` etc.) are already in the
 *   SOCKET_PACKAGE_PATTERNS spread; this check focuses on the versioned entries
 *   (`name@version`) that drift case-by-case. Exit 0 = parity. Exit 1 = drift;
 *   lists the diffs. CI gate via `scripts/check.mts`. Wheelhouse-only — fleet
 *   repos don't have an EXPECTED_RELEASE_AGE_EXCLUDE; the cascade hands them
 *   the synth. Second invariant: no EXPECTED `name@version` pin may have soaked
 *   past its 7-day window. A cleared pin is dead weight — the cascade's insert
 *   loop and prune loop disagree about it (insert wants the canonical pin
 *   present, prune drops a soak-cleared one), so it flip-flops on every wave
 *   and the pre-push soak gate rejects the re-add. Failing here keeps the
 *   manifest minimal: drop a pin the day its `removable` date passes (the dep
 *   stays in the catalog; it no longer needs a soak bypass). Pairs with the
 *   soak-fixer rule in checks/workspace-config.mts (expired target → drop, not
 *   re-pin). Third invariant: each STILL-SOAKING pin's annotated `published`
 *   date must match the registry's REAL publish date for that exact version.
 *   The workspace.mts load-time invariant proves the annotation is internally
 *   consistent (`removable === published + 7d`) but can't prove `published` is
 *   what the registry actually recorded — a fat-fingered date sails through
 *   with a wrong soak window (admits the version too early = a trust hole, or
 *   too late = a stuck install). This fetches the packument `time` (via the
 *   shared `registry-publish-date.mts` helper — `httpJson`, never bare `fetch`)
 *   and compares. FAIL-OPEN: an unreachable registry / unknown version yields
 *   undefined and is skipped, never a red, so offline CI never blocks; fetches
 *   run in parallel so an offline run pays one timeout window, not one per
 *   pin.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  isSocketSourcedPackage,
  SOCKET_PACKAGE_PATTERNS,
} from '../constants/socket-scopes.mts'
import { REPO_ROOT } from '../paths.mts'
import { fetchPackagePublishDate } from '../registry-publish-date.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const WORKSPACE_YAML = path.join(REPO_ROOT, 'pnpm-workspace.yaml')
// `manifest.mts` lives under `scripts/repo/sync-scaffolding/` in the
// wheelhouse host repo; downstream fleet repos don't ship it (the
// manifest is wheelhouse-only orchestration). This check is meaningful
// only when invoked from the wheelhouse itself.
const MANIFEST = path.join(
  REPO_ROOT,
  'scripts/repo/sync-scaffolding/manifest.mts',
)

/**
 * Parse the `minimumReleaseAgeExclude:` list from a pnpm-workspace.yaml.
 * Returns the bullet values (unquoted), preserving order.
 */
export function parseSoakExcludeBlock(content: string): string[] {
  const lines = content.split('\n')
  const blockIdx = lines.findIndex(
    line => line.trimEnd() === 'minimumReleaseAgeExclude:',
  )
  if (blockIdx === -1) {
    return []
  }
  const entries: string[] = []
  for (let i = blockIdx + 1; i < lines.length; i += 1) {
    const ln = lines[i]!
    if (ln === '' || (ln.length > 0 && !/^\s/.test(ln))) {
      break
    }
    // Match a YAML bullet entry line and capture the unquoted package specifier.
    // ^\s*        leading whitespace
    // -\s*        YAML list dash + trailing space(s)
    // ['"]?       optional opening single- or double-quote
    // ([^'"#\s]+) capture group: package name — no quotes, hashes, or whitespace
    // ['"]?       optional closing quote
    // \s*         optional trailing whitespace before an inline comment
    // (?:#.*)?    non-capturing optional inline comment starting with #
    // $           end of line
    const m = /^\s*-\s*['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/.exec(ln)
    if (m) {
      entries.push(m[1]!)
    }
  }
  return entries
}

/**
 * The Socket-owned soak-bypass patterns (globs + bare names) that MUST be
 * present in the live `minimumReleaseAgeExclude` block. Returns the canonical
 * `SOCKET_PACKAGE_PATTERNS` entries ABSENT from `wheelhouse` — the reverse of
 * `diffSoakExclude`, which guards `wheelhouse ⊆ canonical`. Without this, a
 * stale or hand-trimmed live block (missing e.g. `@ultrathink/*`) reads green
 * even though those scopes get no soak bypass — a fresh Socket publish then
 * fails every `pnpm install` with `[ERR_PNPM_NO_MATURE_MATCHING_VERSION]`, and
 * the "Socket scopes are always soak-excluded" invariant becomes a doc claim,
 * not code-as-law.
 */
export function missingSocketPatterns(wheelhouse: readonly string[]): string[] {
  const present = new Set(wheelhouse)
  const missing: string[] = []
  for (let i = 0, { length } = SOCKET_PACKAGE_PATTERNS; i < length; i += 1) {
    const pattern = SOCKET_PACKAGE_PATTERNS[i]!
    if (!present.has(pattern)) {
      missing.push(pattern)
    }
  }
  return missing
}

/**
 * Compute the soak-exclude parity diff. Returns entries present in `wheelhouse`
 * but missing from `canonical` — the drift the cascade would leave behind.
 * Filters out entries that are transitively covered:
 *
 * - Glob entries in canonical (`@socketsecurity/*`) cover any matching name.
 * - Bare-name `rolldown` is covered by a versioned `rolldown@<version>` in
 *   canonical (the cascade upgrades bare→pinned). Same for `@scope/name`.
 *
 * The drift this surfaces is the case that bit us in cascade@4ec6212c: a
 * `name@version` entry present only in wheelhouse, with no canonical
 * counterpart (bare or pinned), so the cascade omits it entirely.
 */
export function diffSoakExclude(
  wheelhouse: readonly string[],
  canonical: readonly string[],
): string[] {
  const canonicalSet = new Set(canonical)
  // Pre-compute the bare-name set of pinned canonical entries, so a
  // wheelhouse `rolldown` bullet is recognized as covered by canonical
  // `rolldown@1.0.3` (the cascade's bare→pinned upgrade path).
  const canonicalBareNames = new Set<string>()
  for (const c of canonical) {
    const at = c.lastIndexOf('@')
    if (at > 0) {
      canonicalBareNames.add(c.slice(0, at))
    }
  }
  // Glob entries in canonical (e.g. `@socketsecurity/*`) cover any name
  // that matches them. Pre-build a tester so the diff is O(n + g).
  const globRes = canonical
    .filter(e => e.includes('*'))
    .map(e => {
      const escaped = e
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
      return new RegExp(`^${escaped}$`)
    })
  const missing: string[] = []
  for (const entry of wheelhouse) {
    if (canonicalSet.has(entry)) {
      continue
    }
    if (globRes.some(re => re.test(entry))) {
      continue
    }
    // Bare wheelhouse entry whose canonical form is pinned (rolldown vs
    // rolldown@1.0.3). The cascade upgrades these.
    const entryAt = entry.lastIndexOf('@')
    if (entryAt <= 0 && canonicalBareNames.has(entry)) {
      continue
    }
    missing.push(entry)
  }
  return missing
}

/**
 * EXPECTED `name@version` soak-pins whose annotated `removable` date is
 * STRICTLY before `today` (ISO `YYYY-MM-DD`). These have cleared their 7-day
 * soak: the gate admits the version without a bypass, so the pin is dead weight
 * that the cascade re-pins (insert loop) and drops (prune loop) on every wave —
 * a tug-of-war. Globs and bare names have no version to soak and are skipped.
 * An entry with no annotation is skipped (can't date it offline; the parity
 * diff already requires versioned entries to be annotated for the synth
 * comment).
 *
 * Why STRICTLY before (`<`), not on-or-before (`<=`): pnpm's minimumReleaseAge
 * gate (config/version-policy createPublishConfig + npm-resolver
 * checkResolutionPolicy) compares the version's full publish TIMESTAMP against
 * a `now - minimumReleaseAge` cutoff — it rejects while `publishTs > now - 7d`.
 * `removable` is the publish DATE + 7d, but a package published at 14:39 on the
 * publish date does not clear the 7×24h window until 14:39 on the `removable`
 * date. So on `today === removable` pnpm may still reject the unpinned install
 * (the window clears later that same day). Retiring the pin then leaves a
 * lockfile pnpm refuses to install. `removable < today` is the first calendar
 * date by which the full 7×24h has elapsed regardless of publish time-of-day,
 * so it can never disagree with pnpm's timestamp comparison.
 */
export function expiredExpectedPins(
  expected: readonly string[],
  annotations: Readonly<
    Record<string, { removable?: string | undefined } | undefined>
  >,
  today: string,
): string[] {
  const expired: string[] = []
  for (const entry of expected) {
    if (entry.includes('*') || entry.lastIndexOf('@') <= 0) {
      continue
    }
    // Socket-owned packages are soak-EXEMPT — they ship through Socket's own
    // provenance pipeline as scope-glob excludes, never dated version pins, so
    // the soak never guards them and there is no removable date to expire.
    if (isSocketSourcedPackage(entry.slice(0, entry.lastIndexOf('@')))) {
      continue
    }
    const removable = annotations[entry]?.removable
    if (removable && removable < today) {
      expired.push(entry)
    }
  }
  return expired
}

export interface PublishDateMismatch {
  actual: string
  annotated: string
  entry: string
}

/**
 * Verify each STILL-SOAKING `name@version` annotation's `published` date
 * against the registry's REAL publish date. Only pins inside their window
 * (`removable >= today`) are checked — a cleared pin is already flagged by
 * `expiredExpectedPins`, so re-verifying it would double-report and spend a
 * needless request. Globs and bare names (no `@version`) are skipped.
 *
 * `fetchDate` is injected (the CLI passes `fetchPackagePublishDate`; tests pass
 * a stub) so this stays pure + offline-testable. Fetches run in PARALLEL, so an
 * offline run pays one timeout window rather than one per pin.
 *
 * FAIL-OPEN per pin: `fetchDate` returns undefined when the registry is
 * unreachable or the version is unknown, and undefined is treated as "couldn't
 * verify" (skipped), NEVER a mismatch. Only a date the registry definitively
 * reports that disagrees with the annotation is a mismatch.
 */
export async function mismatchedPublishDates(
  annotations: Readonly<
    Record<
      string,
      | { published?: string | undefined; removable?: string | undefined }
      | undefined
    >
  >,
  today: string,
  fetchDate: (name: string, version: string) => Promise<string | undefined>,
): Promise<PublishDateMismatch[]> {
  const candidates: Array<{
    annotated: string
    entry: string
    name: string
    version: string
  }> = []
  const entrys = Object.keys(annotations).toSorted()
  for (let i = 0, { length } = entrys; i < length; i += 1) {
    const entry = entrys[i]!
    const ann = annotations[entry]
    const annotated = ann?.published
    if (!annotated) {
      continue
    }
    // Soak-cleared pins are handled by expiredExpectedPins — don't double-flag.
    if (ann?.removable && ann.removable < today) {
      continue
    }
    const at = entry.lastIndexOf('@')
    if (at <= 0) {
      continue
    }
    const name = entry.slice(0, at)
    // Socket-owned packages are soak-EXEMPT (they ship through Socket's own
    // provenance pipeline), so the soak never guards them — never registry-
    // verify a Socket package's publish date here.
    if (isSocketSourcedPackage(name)) {
      continue
    }
    candidates.push({
      annotated,
      entry,
      name,
      version: entry.slice(at + 1),
    })
  }
  const actuals = await Promise.all(
    candidates.map(c => fetchDate(c.name, c.version)),
  )
  const mismatches: PublishDateMismatch[] = []
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const actual = actuals[i]
    const candidate = candidates[i]!
    // Fail-open: undefined = couldn't verify (offline / unknown version).
    if (actual && actual !== candidate.annotated) {
      mismatches.push({
        actual,
        annotated: candidate.annotated,
        entry: candidate.entry,
      })
    }
  }
  return mismatches
}

async function main(): Promise<void> {
  // Wheelhouse-only check. Fleet repos don't ship `EXPECTED_RELEASE_AGE_EXCLUDE`;
  // when the manifest file is absent, this check is a no-op so the canonical
  // `scripts/check.mts` step stays inert across the cascaded fleet.
  if (!existsSync(MANIFEST)) {
    return
  }
  let content: string
  try {
    content = readFileSync(WORKSPACE_YAML, 'utf8')
  } catch (e) {
    logger.fail(`[check-fleet-soak-exclude-parity] cannot read: ${e}`)
    process.exitCode = 1
    return
  }
  // Dynamic import keeps fleet repos (no manifest.mts) from failing at
  // module-resolution time — the existsSync gate above gives us safe-to-load.
  const { EXPECTED_RELEASE_AGE_EXCLUDE, RELEASE_AGE_EXCLUDE_ANNOTATIONS } =
    (await import(MANIFEST)) as {
      EXPECTED_RELEASE_AGE_EXCLUDE: readonly string[]
      RELEASE_AGE_EXCLUDE_ANNOTATIONS: Readonly<
        Record<
          string,
          | { published?: string | undefined; removable?: string | undefined }
          | undefined
        >
      >
    }

  // Second invariant: no EXPECTED soak-pin may have cleared its window.
  const today = new Date().toISOString().slice(0, 10)
  const expired = expiredExpectedPins(
    EXPECTED_RELEASE_AGE_EXCLUDE,
    RELEASE_AGE_EXCLUDE_ANNOTATIONS,
    today,
  )
  if (expired.length > 0) {
    logger.fail(
      [
        '[check-fleet-soak-exclude-parity] Stale soak-pin(s) in EXPECTED_RELEASE_AGE_EXCLUDE.',
        '',
        '  These `name@version` entries have soaked past their 7-day window',
        '  (annotated `removable` date is on/before today). A cleared pin is dead',
        '  weight: the cascade re-pins it (insert) AND drops it (prune) on every',
        '  wave, and the pre-push soak gate rejects the re-pin.',
        '',
        '  Soak-cleared (drop from the manifest):',
        ...expired.map(e => `    - '${e}'`),
        '',
        '  Fix: remove each from `EXPECTED_RELEASE_AGE_EXCLUDE` and its',
        '  `RELEASE_AGE_EXCLUDE_ANNOTATIONS` entry in',
        '  `scripts/repo/sync-scaffolding/manifest/workspace.mts`. The dep stays',
        '  in the catalog; it no longer needs a soak bypass.',
        '',
      ].join('\n'),
    )
    process.exitCode = 1
    return
  }

  // Third invariant: each soaking pin's annotated `published` matches the
  // registry's real publish date. Fail-open offline (see fn doc + @file).
  const mismatches = await mismatchedPublishDates(
    RELEASE_AGE_EXCLUDE_ANNOTATIONS,
    today,
    fetchPackagePublishDate,
  )
  if (mismatches.length > 0) {
    logger.fail(
      [
        '[check-fleet-soak-exclude-parity] Soak annotation `published` disagrees with the registry.',
        '',
        '  An EXPECTED soak-pin annotation claims a `published` date that does',
        '  not match what the npm registry recorded for that exact version, so',
        '  its soak window (removable = published + 7d) is wrong — it admits the',
        '  version too early (a trust hole) or too late (a stuck install).',
        '',
        '  Annotated vs. registry:',
        ...mismatches.map(
          m =>
            `    - ${m.entry}: annotated ${m.annotated}, registry ${m.actual}`,
        ),
        '',
        '  Fix: correct each `published` (and recompute `removable` = published',
        '  + 7d) in RELEASE_AGE_EXCLUDE_ANNOTATIONS',
        '  (scripts/repo/sync-scaffolding/manifest/workspace.mts). Re-run',
        '  `node scripts/fleet/soak-bypass.mts <pkg>@<version>` to fetch the',
        '  authoritative date rather than hand-typing it.',
        '',
      ].join('\n'),
    )
    process.exitCode = 1
    return
  }

  const wheelhouseEntries = parseSoakExcludeBlock(content)

  // Fourth invariant: every Socket-owned soak-bypass pattern must be PRESENT in
  // the live block. Socket scopes are permanent bypasses (they ship through
  // Socket's own provenance pipeline), so a missing one is never intentional —
  // it is cascade-staleness or a hand-trim, and it silently denies the bypass.
  const missingSocket = missingSocketPatterns(wheelhouseEntries)
  if (missingSocket.length > 0) {
    logger.fail(
      [
        '[check-fleet-soak-exclude-parity] Socket-owned soak-bypass pattern(s) missing from the live block.',
        '',
        '  `minimumReleaseAgeExclude:` in pnpm-workspace.yaml is missing Socket',
        '  scope pattern(s) that SOCKET_PACKAGE_PATTERNS marks as permanent',
        '  soak-bypasses. Socket packages ship through our own provenance',
        '  pipeline, so they are always excluded — a missing entry denies the',
        '  bypass and a fresh Socket publish then fails every `pnpm install`.',
        '',
        '  Missing (add to the block, or re-run the cascade which regenerates it):',
        ...missingSocket.map(e => `    - '${e}'`),
        '',
        '  Canonical source: scripts/fleet/constants/socket-scopes.mts',
        '  SOCKET_PACKAGE_PATTERNS (spread into EXPECTED_RELEASE_AGE_EXCLUDE by',
        '  scripts/repo/sync-scaffolding/manifest/workspace.mts). Fix:',
        '  `node scripts/repo/sync-scaffolding/cli.mts --target . --fix`.',
        '',
      ].join('\n'),
    )
    process.exitCode = 1
    return
  }

  const missing = diffSoakExclude(
    wheelhouseEntries,
    EXPECTED_RELEASE_AGE_EXCLUDE,
  )
  if (missing.length === 0) {
    return
  }
  logger.fail(
    [
      '[check-fleet-soak-exclude-parity] Drift detected.',
      '',
      '  Wheelhouse `pnpm-workspace.yaml` carries soak-exclude entries that',
      '  are NOT in `EXPECTED_RELEASE_AGE_EXCLUDE` (manifest.mts). Without',
      '  parity, the fleet cascade omits these entries from downstream repos,',
      '  so every fleet `pnpm install` will reject the transitive dep.',
      '',
      '  Missing from `EXPECTED_RELEASE_AGE_EXCLUDE`:',
      ...missing.map(e => `    - '${e}'`),
      '',
      '  Fix: add each entry to `EXPECTED_RELEASE_AGE_EXCLUDE` in',
      '  `scripts/sync-scaffolding/manifest.mts`. For dated entries, add a',
      '  matching `RELEASE_AGE_EXCLUDE_ANNOTATIONS` block so the synth emits',
      '  the canonical `# published: ... | removable: ...` comment.',
      '',
    ].join('\n'),
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(`[check-fleet-soak-exclude-parity] error: ${e}`)
    process.exitCode = 1
  })
}
