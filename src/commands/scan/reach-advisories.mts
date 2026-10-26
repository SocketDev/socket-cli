import { arrayUnique } from '@socketsecurity/registry/lib/arrays'

import { resolveAdvisoryIds } from '../../utils/advisory-ids.mts'
import {
  CVE_FORMAT_REGEXP,
  GHSA_FORMAT_REGEXP,
} from '../../utils/cve-to-ghsa.mts'
import { InputError } from '../../utils/errors.mts'

// GitHub publishes GHSA IDs with a lowercase body and CVE IDs uppercase.
function normalizeAdvisoryId(id: string): string {
  const trimmed = id.trim()
  return /^ghsa-/i.test(trimmed)
    ? `GHSA-${trimmed.slice(5).toLowerCase()}`
    : trimmed.toUpperCase()
}

/**
 * Resolves the --reach-advisories IDs to GHSA IDs, converting CVE IDs through
 * the GitHub API. Any ID that cannot be resolved fails the command, since
 * dropping it would leave that advisory without reachability analysis.
 */
export async function resolveReachAdvisories(
  ids: readonly string[],
): Promise<string[]> {
  const normalizedIds = arrayUnique(ids.map(normalizeAdvisoryId))
  // Checked up front so PURLs never reach resolveAdvisoryIds and a typo fails
  // before any GitHub lookup.
  const invalidIds = normalizedIds.filter(
    id => !GHSA_FORMAT_REGEXP.test(id) && !CVE_FORMAT_REGEXP.test(id),
  )
  if (invalidIds.length) {
    throw new InputError(
      `Invalid --reach-advisories IDs: ${invalidIds.join(', ')}. Use GHSA IDs (GHSA-xxxx-xxxx-xxxx) or CVE IDs (CVE-YYYY-NNNN).`,
    )
  }
  const { errors, ghsas } = await resolveAdvisoryIds(normalizedIds, {
    silence: true,
  })
  if (errors.length) {
    throw new InputError(
      `Could not resolve --reach-advisories IDs to GHSA IDs:\n${errors.map(e => `  - ${e}`).join('\n')}`,
    )
  }
  return arrayUnique(ghsas)
}
