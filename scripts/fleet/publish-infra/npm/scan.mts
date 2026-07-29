/**
 * @file Pre-approve Socket full-scan gate, CLI-free: everything runs through
 *   `@socketsecurity/sdk` against the Socket API directly — no `socket`
 *   binary. The shasum gate has already proven the staged bytes are identical
 *   to the local `pnpm pack`, so scanning the local artifact's extract IS
 *   scanning the staged upload. Each verified entry is packed, extracted to a
 *   temp dir, submitted as a `tmp` full scan (hidden from the dashboard scan
 *   list — a promotion gate, not a tracked branch scan), and gated on the
 *   org's OWN security policy: any alert whose policy action is `error` fails
 *   the entry, mirroring the report-level:error semantics. Fail-closed by
 *   design: promotion includes a full scan unless `--no-scan` skips it
 *   explicitly. Auth is verified ONCE up front (`preflightSocketScanAuth`)
 *   with a cheap quota read; an interactive run with no token in the
 *   environment opens the Socket dashboard in the browser and prompts for a
 *   pasted key (masked — the token never echoes).
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { SocketSdk } from '@socketsecurity/sdk-stable'

import { logger, rootPath, runCapture } from '../shared.mts'
import { defaultPackTarball } from './staged.mts'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { password } from '@socketsecurity/lib-stable/stdio/prompts'

// The canonical fleet env name for the Socket API token — bootstrap hooks
// normalize the legacy aliases into it, so only this one is read.
export const SOCKET_TOKEN_ENV_VAR = 'SOCKET_API_TOKEN'

// Where a human mints a token when none is in the environment: dashboard →
// org settings → API tokens. The gate needs `full-scans` + `report` scopes.
export const SOCKET_TOKEN_MINT_URL = 'https://socket.dev/dashboard'

/**
 * Everything a gate run needs: an authenticated SDK bound to one org.
 */
export interface SocketScanContext {
  orgSlug: string
  sdk: SocketSdk
}

/**
 * Read the Socket API token from the environment.
 */
export function resolveSocketApiToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env[SOCKET_TOKEN_ENV_VAR]
  return typeof value === 'string' && value !== '' ? value : undefined
}

// Best-effort platform browser opener (`open` / `xdg-open` / `start`),
// fire-and-forget so the gate never waits on the browser process. A failure
// to open is non-fatal — the URL is printed and the human opens it by hand.
function openInBrowser(url: string): void {
  const win32 = process.platform === 'win32'
  const opener =
    process.platform === 'darwin' ? 'open' : win32 ? 'start' : 'xdg-open'
  try {
    const child = spawn(opener, [url], {
      detached: true,
      shell: win32,
      stdio: 'ignore',
    })
    child.catch(() => {
      // Non-fatal: the printed URL is the fallback.
    })
  } catch {
    // Non-fatal: the printed URL is the fallback.
  }
}

/**
 * One-shot pre-gate auth setup, SDK-only. Resolves the API token from the
 * environment — or, on an interactive terminal, opens the Socket dashboard
 * and prompts for a pasted key (masked input; the token is never echoed) —
 * verifies it with a cheap `getQuota()` call, and resolves the org slug the
 * full scans run under (`SOCKET_ORG_SLUG` override, else the token's single
 * org). Run ONCE before the per-entry loop so a missing/expired token
 * surfaces before any human selection, not mid-gate. Every dependency is an
 * injectable seam so tests drive the flow with no network, browser, or TTY.
 */
export async function preflightSocketScanAuth(
  options?:
    | {
        env?: NodeJS.ProcessEnv | undefined
        interactive?: boolean | undefined
        openUrl?: ((url: string) => void) | undefined
        promptForToken?: (() => Promise<string>) | undefined
        sdkFactory?: ((token: string) => SocketSdk) | undefined
      }
    | undefined,
): Promise<SocketScanContext | undefined> {
  const {
    env = process.env,
    interactive = Boolean(process.stdout.isTTY),
    openUrl = openInBrowser,
    promptForToken,
    sdkFactory = token => new SocketSdk(token),
  } = { __proto__: null, ...options } as NonNullable<typeof options>

  let token = resolveSocketApiToken(env)
  if (!token && interactive) {
    logger.log(
      `Scan gate: no Socket API token in the environment — opening ${SOCKET_TOKEN_MINT_URL} ` +
        '(org settings → API tokens; the gate needs full-scans + report scopes).',
    )
    openUrl(SOCKET_TOKEN_MINT_URL)
    const prompt =
      promptForToken ??
      (async () =>
        String(
          (await password({ message: 'Paste the Socket API token:' })) ?? '',
        ))
    const pasted = (await prompt()).trim()
    if (pasted) {
      token = pasted
    }
  }
  if (!token) {
    logger.fail(
      'Scan gate: no Socket API token.\n' +
        `  Where: env (${SOCKET_TOKEN_ENV_VAR})\n` +
        '  Saw: none set; wanted a token the Socket SDK can scan with.\n' +
        `  Fix: mint one at ${SOCKET_TOKEN_MINT_URL} (org settings → API ` +
        'tokens) and export it, or load it from sockeye Touch-ID credential ' +
        'storage; --no-scan skips the gate explicitly.',
    )
    return undefined
  }

  const sdk = sdkFactory(token)
  let quotaOk = false
  try {
    const quota = await sdk.getQuota()
    quotaOk = Boolean((quota as { success?: boolean | undefined }).success)
  } catch (e) {
    logger.fail(
      'Scan gate: the Socket API is unreachable.\n' +
        `  Where: getQuota() (${errorMessage(e)})\n` +
        '  Saw: no API response; wanted a cheap authenticated read.\n' +
        '  Fix: check network/proxy and retry; --no-scan skips the gate explicitly.',
    )
    return undefined
  }
  if (!quotaOk) {
    logger.fail(
      'Scan gate: the Socket API token was rejected.\n' +
        '  Where: getQuota()\n' +
        '  Saw: an unauthenticated response; wanted a valid token.\n' +
        `  Fix: re-mint at ${SOCKET_TOKEN_MINT_URL} and export it; ` +
        '--no-scan skips the gate explicitly.',
    )
    return undefined
  }

  const orgOverride = env['SOCKET_ORG_SLUG']
  if (typeof orgOverride === 'string' && orgOverride !== '') {
    return { orgSlug: orgOverride, sdk }
  }
  let slugs: string[] = []
  try {
    const orgs = await sdk.listOrganizations()
    if (orgs.success) {
      slugs = Object.values(orgs.data.organizations)
        .map(o => (o as { slug?: string | undefined }).slug ?? '')
        .filter(Boolean)
    }
  } catch (e) {
    logger.fail(`Scan gate: could not list organizations (${errorMessage(e)}).`)
    return undefined
  }
  if (slugs.length !== 1) {
    logger.fail(
      'Scan gate: could not resolve the org to scan under.\n' +
        '  Where: listOrganizations()\n' +
        `  Saw: ${slugs.length === 0 ? 'no orgs on this token' : `multiple orgs (${slugs.join(', ')})`}; wanted exactly one.\n` +
        '  Fix: export SOCKET_ORG_SLUG=<slug> to pick one explicitly.',
    )
    return undefined
  }
  return { orgSlug: slugs[0]!, sdk }
}

/**
 * One policy-failing alert, for the gate's failure report.
 */
export interface PolicyFailingAlert {
  artifact: string
  severity: string
  type: string
}

/**
 * Pure policy evaluation: collect every alert whose org security-policy
 * action is `error`. This is the report-level:error gate semantic — the org's
 * own policy decides what blocks, not a hardcoded severity floor.
 */
export function collectPolicyFailingAlerts(
  artifacts: ReadonlyArray<{
    alerts?:
      | ReadonlyArray<{ severity?: string | undefined; type: string }>
      | undefined
    name?: string | undefined
    version?: string | undefined
  }>,
  policyRules: Readonly<Record<string, { action?: string | undefined }>>,
): PolicyFailingAlert[] {
  const failing: PolicyFailingAlert[] = []
  for (let i = 0, { length } = artifacts; i < length; i += 1) {
    const artifact = artifacts[i]!
    const alerts = artifact.alerts ?? []
    for (const alert of alerts) {
      if (policyRules[alert.type]?.action === 'error') {
        failing.push({
          artifact: `${artifact.name ?? '<unnamed>'}@${artifact.version ?? '?'}`,
          severity: alert.severity ?? 'unknown',
          type: alert.type,
        })
      }
    }
  }
  return failing
}

// Full-scan payload shapes vary by endpoint version (a bare artifact array vs
// an `{ artifacts: [...] }` wrapper); normalize to the artifact array the
// policy evaluation consumes.
function normalizeFullScanArtifacts(data: unknown): Array<{
  alerts?: Array<{ severity?: string | undefined; type: string }> | undefined
  name?: string | undefined
  version?: string | undefined
}> {
  if (Array.isArray(data)) {
    return data as ReturnType<typeof normalizeFullScanArtifacts>
  }
  if (data && typeof data === 'object') {
    const maybe = (data as { artifacts?: unknown | undefined }).artifacts
    if (Array.isArray(maybe)) {
      return maybe as ReturnType<typeof normalizeFullScanArtifacts>
    }
  }
  return []
}

/**
 * Scan one staged entry's artifact through the Socket API. Packs the local
 * tree (byte-identical to the staged upload once the shasum gate has passed),
 * extracts the tarball's `package/` root into a temp dir, submits its
 * manifests as a `tmp` full scan, and gates on the org security policy: any
 * `error`-action alert fails the entry. `options.packTarball` swaps the
 * artifact source: a generated platform package's payload is CI-built with no
 * local twin, so the approve flow passes a provider that downloads the STAGED
 * tarball, whose structure the platform verify gate has already checked,
 * instead of packing locally. `options.context` carries the preflighted
 * SDK+org; when absent the entry runs its own preflight (self-contained use).
 */
export async function scanStagedEntry(
  entry: {
    name: string
    version: string
  },
  options?:
    | {
        context?: SocketScanContext | undefined
        packTarball?:
          | ((name: string, version: string) => Promise<string | undefined>)
          | undefined
      }
    | undefined,
): Promise<boolean> {
  const { context, packTarball = defaultPackTarball } = {
    __proto__: null,
    ...options,
  } as {
    context?: SocketScanContext | undefined
    packTarball?:
      | ((name: string, version: string) => Promise<string | undefined>)
      | undefined
  }
  const scanContext = context ?? (await preflightSocketScanAuth())
  if (!scanContext) {
    return false
  }
  const { orgSlug, sdk } = scanContext
  const { name, version } = entry
  const tarballPath = await packTarball(name, version)
  if (!tarballPath) {
    logger.fail(
      `Scan gate: could not pack ${name}@${version} locally; refusing to approve unscanned bytes.`,
    )
    return false
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-scan-gate-'))
  try {
    const untar = await runCapture(
      'tar',
      ['-xzf', tarballPath, '-C', tmpDir],
      rootPath,
    )
    if (untar.code !== 0) {
      logger.fail(
        `Scan gate: extracting ${tarballPath} failed (tar exited ${untar.code}).`,
      )
      return false
    }
    // npm tarballs root their contents at `package/`.
    const packageDir = path.join(tmpDir, 'package')
    logger.log(
      `Scan gate: Socket full scan (tmp) on ${name}@${version} via the API…`,
    )
    let scanId: string | undefined
    try {
      const created = await sdk.createFullScan(orgSlug, ['package.json'], {
        pathsRelativeTo: packageDir,
        repo: 'staged-publish-gate',
        tmp: true,
      })
      if (created.success) {
        scanId = (created.data as { id?: string | undefined }).id
      } else {
        logger.fail(
          `Scan gate: full-scan create failed for ${name}@${version} ` +
            `(status ${created.status}${created.error ? `: ${String(created.error)}` : ''}).`,
        )
        return false
      }
    } catch (e) {
      logger.fail(
        `Scan gate: full-scan create threw for ${name}@${version} (${errorMessage(e)}).`,
      )
      return false
    }
    if (!scanId) {
      logger.fail(
        `Scan gate: full-scan create returned no scan id for ${name}@${version}; not approving.`,
      )
      return false
    }
    let artifacts: ReturnType<typeof normalizeFullScanArtifacts>
    let policyRules: Record<string, { action?: string | undefined }>
    try {
      const [scan, policy] = await Promise.all([
        sdk.getFullScan(orgSlug, scanId),
        sdk.getOrgSecurityPolicy(orgSlug),
      ])
      if (!scan.success || !policy.success) {
        logger.fail(
          `Scan gate: could not read the scan or the org security policy for ${name}@${version}; not approving.`,
        )
        return false
      }
      artifacts = normalizeFullScanArtifacts(scan.data)
      policyRules =
        ((policy.data as { securityPolicyRules?: unknown | undefined })
          .securityPolicyRules as typeof policyRules | undefined) ?? {}
    } catch (e) {
      logger.fail(
        `Scan gate: reading scan results threw for ${name}@${version} (${errorMessage(e)}).`,
      )
      return false
    }
    const failing = collectPolicyFailingAlerts(artifacts, policyRules)
    if (failing.length > 0) {
      logger.fail(
        `Scan gate: ${failing.length} policy-failing alert(s) for ${name}@${version}; not approving.`,
      )
      for (let i = 0, { length } = failing; i < length; i += 1) {
        const f = failing[i]!
        logger.fail(`  - ${f.type} (${f.severity}) in ${f.artifact}`)
      }
      return false
    }
    return true
  } finally {
    await safeDelete(tmpDir)
    // Clean the tarball too when a packTarball provider downloaded it into a
    // temp dir (the registry-API `stage download` and the browser-read
    // passback both mkdtemp under os.tmpdir()). A repo-local `pnpm pack`
    // output lands in the package dir, NOT under tmpdir, so it is never
    // touched — pnpm/repo hygiene owns that one.
    const tmpRoot = os.tmpdir()
    if (tarballPath.startsWith(tmpRoot + path.sep)) {
      await safeDelete(path.dirname(tarballPath))
    }
  }
}
