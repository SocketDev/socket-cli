/**
 * @file Shared helpers for fleet-canonical publish scripts. Used by
 *   `publish.mts` (npm + staged) and `publish-release.mts` (GitHub Release +
 *   checksums). Helpers below cover process spawning, git introspection, and
 *   npm-registry queries. Lives in `scripts/` (not `scripts/lib/`) because the
 *   fleet's convention puts thin helpers next to the scripts that consume them.
 *   `scripts/lib/` is reserved for substantial libraries that warrant their own
 *   directory (none exist today).
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- streaming
// stdio required to forward `pnpm stage approve` 2FA prompts +
// `gh release create` upload progress. lib/spawn returns a Promise
// that resolves only on exit; here we need the live ChildProcess
// stream.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'

const WIN32 = process.platform === 'win32'

/**
 * Spawn a command and forward stdio (interactive). Returns the exit code. Used
 * when the user needs to see / interact with the live output stream
 * (publish/approve prompts, gh upload progress).
 */
export function runInherit(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const { process: child } = spawn(cmd, args, {
      cwd,
      shell: WIN32,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', code => {
      resolve(code ?? 0)
    })
  })
}

/**
 * Spawn a command and capture stdout. Stderr goes to the parent process's
 * stderr so error messages stay visible. Returns the collected stdout + exit
 * code. Used for one-shot queries (git, npm view, pnpm stage list --json).
 */
export function runCapture(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const childPromise = spawn(cmd, args, {
      cwd,
      shell: WIN32,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    // v6 lib-stable spawn returns an enriched Promise that rejects on
    // non-zero exit. We resolve on exit-code below regardless, so swallow
    // the Promise rejection to avoid a process-killing unhandled rejection
    // when the spawned binary exits non-zero (e.g. `npm view <unpublished>`
    // returning 404 → exit 1, which is the documented signal for
    // `isAlreadyPublished` to return false).
    void childPromise.catch(() => undefined)
    const child = childPromise.process
    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('exit', code => {
      resolve({ stdout, code: code ?? 0 })
    })
  })
}

/**
 * Resolve `git rev-parse --short HEAD`. Returns the literal string `unknown`
 * when git fails (detached worktree, missing git, etc.) — callers that need a
 * guaranteed-valid SHA should check for that.
 */
export async function gitShortSha(cwd: string): Promise<string> {
  const { stdout, code } = await runCapture(
    'git',
    ['rev-parse', '--short', 'HEAD'],
    cwd,
  )
  if (code !== 0) {
    return 'unknown'
  }
  return stdout.trim()
}

/**
 * `npm view <name>@<version> version` exits 0 iff the version exists on the
 * registry. Faster than fetching the full packument for a yes/no check.
 */
export async function isAlreadyPublished(
  name: string,
  version: string,
  cwd: string,
): Promise<boolean> {
  const { code } = await runCapture(
    'npm',
    ['view', `${name}@${version}`, 'version'],
    cwd,
  )
  return code === 0
}

/**
 * Extract the first balanced top-level `{ … }` JSON object from a
 * possibly-noisy stdout stream (pnpm wraps JSON output in progress lines that
 * aren't valid JSON themselves). Returns undefined if no balanced object
 * found.
 *
 * Used by publish.mts to parse `pnpm stage list --json`.
 */
export function extractFirstJson(text: string): string | undefined {
  const startIdx = text.indexOf('{')
  if (startIdx === -1) {
    return undefined
  }
  let depth = 0
  let inString = false
  let escape = false
  for (let i = startIdx, { length } = text; i < length; i += 1) {
    const ch = text[i]!
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) {
      continue
    }
    if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        return text.slice(startIdx, i + 1)
      }
    }
  }
  return undefined
}

/**
 * Subset of `https://registry.npmjs.org/<name>` packument fields the fleet's
 * publish scripts care about. The full shape is much larger; we project to what
 * we use so callers don't have to know the rest.
 */
export interface RegistryVersionInfo {
  /**
   * `_npmUser.trustedPublisher` — set when the version was uploaded via OIDC
   * trusted publisher (GitHub Actions). Omit when classic token was used.
   */
  trustedPublisher?:
    | { id: string; oidcConfigId?: string | undefined }
    | undefined
  /**
   * `dist.attestations` — present when the upload included npm provenance
   * (`--provenance` flag). The URL fetches the SLSA provenance bundle.
   */
  attestations?:
    | {
        url: string
        provenance: { predicateType: string }
      }
    | undefined
  /**
   * `_npmUser.approver` — set when the version landed through pnpm's staged-
   * publish flow (a human approver clicked through 2FA). Used by
   * `publish.mts:isStagingExpected` to refuse a --direct downgrade when any
   * prior version of the package chose the staged path.
   */
  approver?: string | undefined
}

/**
 * Fetch a package's registry packument and return the per-version trust
 * metadata. Returns `{}` for any package that isn't on the registry (or that
 * the fetch itself failed for).
 *
 * The npm registry exposes two packument formats:
 *
 * - Full (~100KB+): includes per-version `_npmUser.trustedPublisher` (OIDC
 *   trusted-publisher attribution) AND `dist.attestations` (SLSA provenance
 *   bundle URL).
 * - Abbreviated (~10-20KB, Accept: application/vnd.npm.install-v1+json): drops
 *   `_npmUser` but keeps `dist.attestations`.
 *
 * Callers pick: `'abbreviated'` for cheap attestation-only checks (Stop-hook,
 * approve-flow enrich), `'full'` for audits that need to confirm
 * trusted-publisher attribution (check/provenance-is-attested.mts).
 *
 * Use this from `check/provenance-is-attested.mts` (CLI audit), the approve flow (show
 * prior-version status), and the Stop-hook (verify a freshly- bumped version
 * landed with provenance).
 */
export async function fetchVersionTrustInfo(
  name: string,
  variant: 'abbreviated' | 'full' = 'abbreviated',
): Promise<Record<string, RegistryVersionInfo>> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}`
  let json: {
    versions?:
      | Record<
          string,
          {
            dist?:
              | {
                  attestations?:
                    | {
                        url: string
                        provenance: { predicateType: string }
                      }
                    | undefined
                }
              | undefined
            _npmUser?:
              | {
                  approver?: string | undefined
                  trustedPublisher?:
                    | { id: string; oidcConfigId?: string | undefined }
                    | undefined
                }
              | undefined
          }
        >
      | undefined
  }
  try {
    const headers: Record<string, string> =
      variant === 'abbreviated'
        ? { accept: 'application/vnd.npm.install-v1+json' }
        : { accept: 'application/json' }
    // socket-lint: allow global-fetch -- publish tooling probes the npm registry directly; the lib http-request helper isn't a dependency here.
    const response = await fetch(url, { headers })
    if (!response.ok) {
      return {}
    }
    json = (await response.json()) as typeof json
  } catch {
    return {}
  }
  const result: Record<string, RegistryVersionInfo> = {}
  for (const [version, info] of Object.entries(json.versions ?? {})) {
    result[version] = {
      ...(info._npmUser?.approver !== undefined
        ? { approver: info._npmUser.approver }
        : {}),
      ...(info._npmUser?.trustedPublisher
        ? { trustedPublisher: info._npmUser.trustedPublisher }
        : {}),
      ...(info.dist?.attestations
        ? { attestations: info.dist.attestations }
        : {}),
    }
  }
  return result
}
