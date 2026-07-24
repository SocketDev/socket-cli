import { LATEST } from '@socketsecurity/lib-stable/constants/packages'

import { getErrorCause } from '../error/errors.mts'
import { cacheFetch, getOctokit } from '../git/github.mts'
import { getPurlObject } from '../purl/parse.mts'

import type { CResult } from '../../types.mjs'

// The `ecosystem` union `listGlobalAdvisories` accepts, derived from the
// Octokit method so it tracks upstream instead of a hand-copied literal union.
export type GithubAdvisoryEcosystem = NonNullable<
  NonNullable<
    Parameters<
      ReturnType<
        typeof getOctokit
      >['rest']['securityAdvisories']['listGlobalAdvisories']
    >[0]
  >['ecosystem']
>

// GitHub Advisory Database supported ecosystems.
const PURL_TO_GITHUB_ECOSYSTEM_MAPPING = new Map<
  string,
  GithubAdvisoryEcosystem
>([
  ['cargo', 'rust'],
  ['composer', 'composer'],
  ['gem', 'rubygems'],
  ['go', 'go'],
  ['golang', 'go'],
  ['maven', 'maven'],
  ['npm', 'npm'],
  ['nuget', 'nuget'],
  ['pypi', 'pip'],
  ['swift', 'swift'],
])

/**
 * Converts PURL to GHSA IDs using GitHub API.
 */
export async function convertPurlToGhsas(
  purl: string,
): Promise<CResult<string[]>> {
  try {
    const purlObj = getPurlObject(purl, { throws: false })
    if (!purlObj) {
      return {
        ok: false,
        message: `Invalid PURL format: ${purl}`,
      }
    }

    const { name, type: ecosystem, version } = purlObj

    // Map PURL ecosystem to GitHub ecosystem.
    const githubEcosystem = PURL_TO_GITHUB_ECOSYSTEM_MAPPING.get(ecosystem)
    if (!githubEcosystem) {
      return {
        ok: false,
        message: `Unsupported PURL ecosystem: ${ecosystem}`,
      }
    }

    // Search for advisories affecting this package.
    // Use '::' delimiter to avoid collisions (package names can contain hyphens).
    const cacheKey = `purl-to-ghsa::${ecosystem}::${name}::${version || LATEST}`
    const octokit = getOctokit()
    const affects = version ? `${name}@${version}` : name

    const response = await cacheFetch(cacheKey, () =>
      octokit.rest.securityAdvisories.listGlobalAdvisories({
        ecosystem: githubEcosystem,
        ...(affects ? { affects } : {}),
      }),
    )

    return {
      ok: true,
      data: response.data.map(a => a.ghsa_id),
    }
  } catch (e) {
    return {
      ok: false,
      message: `Failed to convert PURL to GHSA: ${getErrorCause(e)}`,
    }
  }
}
