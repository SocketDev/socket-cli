/**
 * Update: two-pass taze to apply the fleet's maturity policy correctly.
 *
 * Pass 1: default config (.config/fleet/taze.config.mts) — non-Socket deps
 * respect maturityPeriod: 7.
 *
 * Pass 2: CLI-flag override — Socket-owned scopes only, maturityPeriod: 0.
 * taze's config auto-discovery is path-based and doesn't support a --config
 * override, so the second pass uses `--include <scopes> --maturity- period 0`
 * flags instead of a second config file.
 *
 * Pass 3: pnpm install to refresh the lockfile against the updated
 * package.json.
 *
 * SOCKET_SCOPES is the single shared constant (scripts/fleet/constants/
 * socket-scopes.mts) — the same one .config/fleet/taze.config.mts imports, so
 * the two can't drift (was previously hand-copied in both, "MUST match").
 *
 * This is a reference script. Consuming repos can drop it into their own
 * scripts/ dir and wire it in via a `"update": "node scripts/fleet/update.mts"`
 * package.json entry.
 */
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { SOCKET_SCOPES } from './constants/socket-scopes.mts'
import { REPO_ROOT } from './paths.mts'
import { collectPackumentFailures } from './lib/taze-output.mts'
import { scanRepoForTelemetry } from './lib/telemetry-scan.mts'

const logger = getDefaultLogger()

export interface RunResult {
  readonly ok: boolean
  readonly output: string
}

// taze's version lookups use Node's fetch, which ignores the HTTP(S)_PROXY
// env the Socket Firewall wrapper injects — while the firewall blocks direct
// egress, so every lookup dies. NODE_USE_ENV_PROXY routes fetch through the
// proxy (Node >= 24) and NODE_EXTRA_CA_CERTS trusts the firewall's CA (sfw
// already exports it for git). No-ops when no firewall is active.
function tazeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_USE_ENV_PROXY: '1' }
  const firewallCa = process.env['GIT_PROXY_SSL_CAINFO']
  if (firewallCa && !env['NODE_EXTRA_CA_CERTS']) {
    env['NODE_EXTRA_CA_CERTS'] = firewallCa
  }
  return env
}

async function run(cmd: string, args: string[]): Promise<RunResult> {
  try {
    const result = await spawn(cmd, args, {
      env: tazeEnv(),
      stdio: ['inherit', 'pipe', 'pipe'],
      stdioString: true,
    })
    process.stdout.write(String(result.stdout ?? ''))
    process.stderr.write(String(result.stderr ?? ''))
    return {
      ok: true,
      output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    }
  } catch (e) {
    const err = e as {
      code?: number | undefined
      stderr?: string | undefined
      stdout?: string | undefined
    }
    process.stdout.write(String(err.stdout ?? ''))
    process.stderr.write(String(err.stderr ?? ''))
    process.exitCode = err.code ?? 1
    return { ok: false, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}` }
  }
}

interface Step {
  readonly args: string[]
  readonly cmd: string
  readonly tazePass: boolean
}

const steps: Step[] = [
  /* Pass 1 — third-party deps, respects the 7-day cooldown.
   *
   * `--maturity-period 7` MUST be passed on the CLI even though
   * the config file (.config/fleet/taze.config.mts) sets the same
   * value. Taze's CLI default for this flag is 0, and CLI
   * defaults override config — without this flag, the cooldown
   * is silently disabled. */
  {
    args: ['--maturity-period', '7', '--write'],
    cmd: path.join(REPO_ROOT, 'node_modules', '.bin', 'taze'),
    tazePass: true,
  },
  /* Pass 2 — Socket deps, no cooldown. --include is comma-separated. */
  {
    args: [
      '--include',
      SOCKET_SCOPES.join(','),
      '--maturity-period',
      '0',
      '--write',
    ],
    cmd: path.join(REPO_ROOT, 'node_modules', '.bin', 'taze'),
    tazePass: true,
  },
  /* Pass 3 — resync lockfile against the updated package.json. */
  { args: ['install'], cmd: 'pnpm', tazePass: false },
]

const uncheckedPackages = new Set<string>()
for (let i = 0, { length } = steps; i < length; i += 1) {
  const step = steps[i]!
  let { ok, output } = await run(step.cmd, step.args)
  if (ok && step.tazePass && collectPackumentFailures(output).length > 0) {
    // One retry absorbs a transient blip; a persistent failure set is a real
    // outage (or a blocked endpoint) and must not pass silently.
    logger.warn(
      'update: taze reported version-lookup failures; retrying the pass once…',
    )
    ;({ ok, output } = await run(step.cmd, step.args))
  }
  if (!ok) {
    break
  }
  if (step.tazePass) {
    for (const pkg of collectPackumentFailures(output)) {
      uncheckedPackages.add(pkg)
    }
  }
}

// Fail-loud gate: taze exits 0 even when version lookups fail, which reads as
// "everything is current" while those packages were never checked at all.
if (process.exitCode !== 1 && uncheckedPackages.size > 0) {
  const list = [...uncheckedPackages].toSorted()
  logger.fail(
    `update: taze could not check ${list.length} package(s) for updates ` +
      '(version lookups failed after a retry).',
  )
  logger.error(
    '  Where: taze version resolution (fast-npm-meta endpoint npm.antfu.dev, 5s hard timeout).',
  )
  logger.error(
    '  Saw: lookup timeouts/failures; wanted: every dependency checked against its latest soaked version.',
  )
  logger.error(
    '  Fix: check egress to npm.antfu.dev (or the network), then re-run `pnpm run update`.',
  )
  for (let i = 0, { length } = list; i < length; i += 1) {
    logger.error(`  ✗ ${list[i]!}`)
  }
  process.exitCode = 1
}

// Pass 4 — fail-closed telemetry scan. An update may have pulled a telemetry /
// analytics SDK (Sentry/PostHog/Segment/Datadog/OTEL-SDK/langfuse/…) into the
// refreshed lockfile. Scan the post-update dep surface; if anything unreviewed
// appears, FAIL loudly so it can't land silently — the operator's "never
// silently phone home; run the check on every software update" rule, as law.
// (Same scan as check/telemetry-deps-are-reviewed.mts.)
if (process.exitCode !== 1) {
  const unreviewed = scanRepoForTelemetry(REPO_ROOT)
  if (unreviewed.length) {
    logger.fail(
      'update: NEW telemetry / analytics SDK(s) pulled in by this update:',
    )
    for (let i = 0, { length } = unreviewed; i < length; i += 1) {
      logger.error(`  ✗ ${unreviewed[i]!}`)
    }
    logger.error(
      '  Audit + neutralize (pnpm override / env opt-out / drop the dep), or add',
    )
    logger.error(
      '  to REVIEWED_TELEMETRY in scripts/fleet/lib/telemetry-scan.mts with a reason.',
    )
    process.exitCode = 1
  } else {
    logger.success('update: telemetry scan clean (no unreviewed phone-home).')
  }
}
