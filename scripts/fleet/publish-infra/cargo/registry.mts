/**
 * @file Crates.io registry reads for the cargo-publish flow: the
 *   already-published probe, the latest-published-version lookup, and the
 *   crate-name availability status. Reads need no auth. crates.io REQUIRES a
 *   descriptive `User-Agent` header (it 403s requests without one), so every
 *   GET carries one. The cargo analog of npm/registry.mts.
 */

import { logger, rootPath, runCapture } from '../shared.mts'

const CRATES_IO_API = 'https://crates.io/api/v1'

// crates.io rejects requests without a descriptive User-Agent (HTTP 403); this
// identifies the fleet publish tooling per their crawler policy.
const USER_AGENT_HEADER =
  'User-Agent: socket-wheelhouse-publish (github.com/SocketDev/socket-wheelhouse)'

/**
 * GET a crates.io API path with the required User-Agent, a 20s timeout, and no
 * fail-on-http-error (so a 404 body is still returned for shape inspection).
 * Returns the raw stdout + curl exit code.
 */
async function cratesIoGet(
  apiPath: string,
): Promise<{ code: number; stdout: string }> {
  return await runCapture(
    'curl',
    ['-sS', '-m', '20', '-H', USER_AGENT_HEADER, `${CRATES_IO_API}${apiPath}`],
    rootPath,
  )
}

/**
 * Whether `name@version` already exists on crates.io. crates.io NEVER allows
 * re-publishing a version (a version can only be yanked, never overwritten), so
 * this must be surfaced before any publish attempt. HTTP 200 returns a
 * `version` object; a 404 returns an `errors` array. Network / parse failure is
 * treated as "unknown" ⇒ false (mirrors npm's isAlreadyPublished tolerance) but
 * logs a warning so a false-green is visible.
 */
export async function isAlreadyPublished(
  name: string,
  version: string,
): Promise<boolean> {
  const { code, stdout } = await cratesIoGet(`/crates/${name}/${version}`)
  if (code !== 0) {
    logger.warn(
      `[cargo] crates.io check for ${name}@${version} failed (curl exit ` +
        `${code}); treating as not-published.`,
    )
    return false
  }
  try {
    const parsed = JSON.parse(stdout) as {
      version?: { num?: unknown } | undefined
    }
    return !!parsed.version && typeof parsed.version === 'object'
  } catch {
    logger.warn(
      `[cargo] could not parse crates.io response for ${name}@${version}; ` +
        'treating as not-published.',
    )
    return false
  }
}

/**
 * The latest published version of `name` on crates.io:
 * `crate.max_stable_version` (preferred) or `crate.newest_version`. Returns
 * undefined when the crate is unpublished or the lookup failed.
 */
export async function fetchPublishedVersion(
  name: string,
): Promise<string | undefined> {
  const { code, stdout } = await cratesIoGet(`/crates/${name}`)
  if (code !== 0) {
    return undefined
  }
  try {
    const parsed = JSON.parse(stdout) as {
      crate?:
        | { max_stable_version?: unknown; newest_version?: unknown }
        | undefined
    }
    const crate = parsed.crate
    if (!crate) {
      return undefined
    }
    if (
      typeof crate.max_stable_version === 'string' &&
      crate.max_stable_version
    ) {
      return crate.max_stable_version
    }
    if (typeof crate.newest_version === 'string' && crate.newest_version) {
      return crate.newest_version
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Whether the crate `name` is `'available'` (404 — free to claim),
 * `'published'` (200 — already on crates.io, presumably ours), or `'unknown'`
 * (network / parse failure). Used to warn before a first publish that the name
 * is free or ours.
 */
export async function crateNameStatus(
  name: string,
): Promise<'available' | 'published' | 'unknown'> {
  const { code, stdout } = await cratesIoGet(`/crates/${name}`)
  if (code !== 0) {
    return 'unknown'
  }
  try {
    const parsed = JSON.parse(stdout) as {
      crate?: unknown
      errors?: unknown
    }
    if (parsed.crate && typeof parsed.crate === 'object') {
      return 'published'
    }
    if (parsed.errors) {
      return 'available'
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}
