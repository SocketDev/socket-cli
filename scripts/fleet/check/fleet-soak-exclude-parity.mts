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
 *   the synth.
 *
 *   Second invariant: no EXPECTED `name@version` pin may have soaked past its
 *   7-day window. A cleared pin is dead weight — the cascade's insert loop and
 *   prune loop disagree about it (insert wants the canonical pin present, prune
 *   drops a soak-cleared one), so it flip-flops on every wave and the pre-push
 *   soak gate rejects the re-add. Failing here keeps the manifest minimal: drop
 *   a pin the day its `removable` date passes (the dep stays in the catalog; it
 *   no longer needs a soak bypass). Pairs with the soak-fixer rule in
 *   checks/workspace-config.mts (expired target → drop, not re-pin).
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

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
 * EXPECTED `name@version` soak-pins whose annotated `removable` date is on or
 * before `today` (ISO `YYYY-MM-DD`). These have cleared their 7-day soak: the
 * gate admits the version without a bypass, so the pin is dead weight that the
 * cascade re-pins (insert loop) and drops (prune loop) on every wave — a
 * tug-of-war. Globs and bare names have no version to soak and are skipped. An
 * entry with no annotation is skipped (can't date it offline; the parity diff
 * already requires versioned entries to be annotated for the synth comment).
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
    const removable = annotations[entry]?.removable
    if (removable && removable <= today) {
      expired.push(entry)
    }
  }
  return expired
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
        Record<string, { published?: string | undefined; removable?: string | undefined } | undefined>
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

  const wheelhouseEntries = parseSoakExcludeBlock(content)
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(`[check-fleet-soak-exclude-parity] error: ${e}`)
    process.exitCode = 1
  })
}
