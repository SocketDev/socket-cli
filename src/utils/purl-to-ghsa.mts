import { cacheFetch, getOctokit } from './github.mts'
import { getPurlObject } from './purl.mts'
import { LATEST, UNKNOWN_ERROR } from '../constants.mts'

import type { CResult } from '../types.mts'

const PURL_TO_GITHUB_ECOSYSTEM_MAPPING = {
  __proto__: null,
  // GitHub Advisory Database supported ecosystems
  cargo: 'rust',
  composer: 'composer',
  gem: 'rubygems',
  go: 'go',
  golang: 'go',
  maven: 'maven',
  npm: 'npm',
  nuget: 'nuget',
  pypi: 'pip',
  swift: 'swift',
} as unknown as Record<string, string>

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
    const githubEcosystem = PURL_TO_GITHUB_ECOSYSTEM_MAPPING[ecosystem]
    if (!githubEcosystem) {
      return {
        ok: false,
        message: `Unsupported PURL ecosystem: ${ecosystem}`,
      }
    }

    // Search for advisories affecting this package.
    const cacheKey = `purl-to-ghsa-${ecosystem}-${name}-${version || LATEST}`
    const octokit = getOctokit()
    const affects = version ? `${name}@${version}` : name

    const response = await cacheFetch(cacheKey, () =>
      octokit.rest.securityAdvisories.listGlobalAdvisories({
        ecosystem: githubEcosystem as any,
        affects,
      }),
    )

    return {
      ok: true,
      data: response.data.map(a => a.ghsa_id),
    }
  } catch (e) {
    return {
      ok: false,
      message: `Failed to convert PURL to GHSA: ${e instanceof Error ? e.message : UNKNOWN_ERROR}`,
    }
  }
}
