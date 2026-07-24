/**
 * @file Gap #2 engine — soak-window install failures.
 *   Pure functions, no FS reads, no network. The soak probe (run by doctor.mts
 *   when --fix or --probe-install is passed) pipes pnpm's stderr to
 *   parseSoakViolations; formatSoakFinding produces a report-only DoctorFinding
 *   with the exact annotated fix the operator needs to apply.
 *   The doctor NEVER auto-edits the soak block — that gate is wheelhouse-owned
 *   and review-gated. Promotion to auto-fix is blocked until the annotation
 *   source (manifest/release-age-annotations.mts) is a cascaded artifact.
 */

import type { DoctorFinding } from './catalog-gap.mts'

/**
 * Tolerant scan of pnpm install output for ERR_PNPM_NO_MATURE_MATCHING_VERSION
 * lines. Returns a deduplicated list of `<name>@<version>` spec strings that
 * failed the soak window check.
 */
export function parseSoakViolations(output: string): string[] {
  const specs = new Set<string>()

  // Pattern 1: ERR_PNPM_NO_MATURE_MATCHING_VERSION with a spec line nearby.
  // pnpm prints: "No matching version found for <spec>" on a following line.
  const lines = output.split('\n')
  let inSoakError = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const ln = lines[i]!
    if (ln.includes('ERR_PNPM_NO_MATURE_MATCHING_VERSION')) {
      inSoakError = true
      continue
    }
    if (inSoakError) {
      // Try to find `No matching version found for <spec>`.
      const mVer = /No matching version found for ([^\s,]+)/.exec(ln)
      if (mVer?.[1]) {
        specs.add(mVer[1])
      }
      // Also try `<spec> is not published yet` pattern.
      const mYet = /([^\s]+) is not published yet/.exec(ln)
      if (mYet?.[1]) {
        specs.add(mYet[1])
      }
      // Reset when encountering the next block separator.
      if (ln.trim() === '') {
        inSoakError = false
      }
    }

    // Pattern 2: inline `<spec> is not mature enough` — some pnpm versions emit
    // this without a separate ERR_ prefix line.
    const mMature = /([^\s]+) is not mature enough/.exec(ln)
    if (mMature?.[1]) {
      specs.add(mMature[1])
    }

    // Pattern 3: `No matching version found for <spec>` anywhere.
    const mAny = /No matching version found for ([^\s,]+)/.exec(ln)
    if (mAny?.[1]) {
      specs.add(mAny[1])
    }

    // Pattern 4: the real ERR_PNPM_NO_MATURE_MATCHING_VERSION detail line —
    // `  <name>@<version> was published at <date>, within the minimumReleaseAge
    // cutoff (...)`. This is what pnpm 11 actually emits (one line per spec).
    const mPub = /(\S+@\S+) was published at .*minimumReleaseAge/.exec(ln)
    if (mPub?.[1]) {
      specs.add(mPub[1])
    }
  }

  return [...specs].toSorted()
}

/**
 * Produce a report-only DoctorFinding for a single soak-window spec. The Fix
 * text shows the exact annotated `minimumReleaseAgeExclude:` bullet shape the
 * operator must add to pnpm-workspace.yaml, the `pnpm view` command to
 * determine the publish date, and a note that the durable fleet-wide fix is
 * the wheelhouse's canonical release-age annotation source + re-cascade.
 */
export function formatSoakFinding(spec: string): DoctorFinding {
  const atIdx = spec.lastIndexOf('@')
  const name = atIdx > 0 ? spec.slice(0, atIdx) : spec
  return {
    fix: [
      `Add an annotated exclude bullet to pnpm-workspace.yaml:`,
      ``,
      `  minimumReleaseAgeExclude:`,
      `    # published: YYYY-MM-DD | removable: YYYY-MM-DD`,
      `    - '${spec}'`,
      ``,
      `Get the publish date with:  pnpm view ${name} time --json`,
      ``,
      `For a fleet-wide transitive dep the durable fix is: update the`,
      `canonical release-age annotation source in the wheelhouse`,
      `(scripts/repo/sync-scaffolding/manifest/release-age-annotations.mts)`,
      `and re-cascade — that propagates the annotated exclude to every member.`,
      `The doctor does not auto-add soak excludes; the trust gate is`,
      `wheelhouse-owned and review-gated.`,
    ].join('\n'),
    fixable: false,
    saw: `pnpm install rejected '${spec}' — the package was published within the 7-day soak window`,
    wanted: `'${spec}' listed in pnpm-workspace.yaml minimumReleaseAgeExclude with published/removable annotation`,
    what: `Soak-window install failure: '${spec}' blocked by minimumReleaseAge`,
    where: 'pnpm-workspace.yaml minimumReleaseAgeExclude',
  }
}
