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

import { SOAK_DAYS } from './constants/soak.mts'
import { SOCKET_SCOPES } from './constants/socket-scopes.mts'
import { FLEET_CATALOG_YAML, PNPM_WORKSPACE_YAML, REPO_ROOT } from './paths.mts'
import { applyStableAliasReconcile } from './lib/stable-alias.mts'
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
  // The lockfile resync (`pnpm install`) runs AFTER the `-stable` alias
  // reconcile below — a Socket bump in pass 2 moves the base version, and the
  // matching `<name>-stable` alias must track it before the lockfile is
  // regenerated, else the lockfile pins the alias to the stale build.
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

// Pass 3a — reconcile `-stable` aliases, THEN resync the lockfile. A pass-2
// Socket bump moves the floating base (`@socketsecurity/lib: 6.0.10`); the
// pinned alias (`@socketsecurity/lib-stable: 'npm:@socketsecurity/lib@…'`) must
// track it or `-stable` imports resolve the stale build. Reconcile the live
// workspace + fleet catalog source (+ their template/base sources in the
// wheelhouse) before `pnpm install` regenerates the lockfile. Enforced by
// scripts/fleet/check/stable-aliases-match-base.mts.
if (process.exitCode !== 1) {
  const catalogFiles = [
    PNPM_WORKSPACE_YAML,
    FLEET_CATALOG_YAML,
    path.join(REPO_ROOT, 'template', 'base', 'pnpm-workspace.yaml'),
    path.join(
      REPO_ROOT,
      'template',
      'base',
      '.config',
      'fleet',
      'pnpm-workspace.fleet.yaml',
    ),
  ]
  const reconciled = applyStableAliasReconcile(catalogFiles)
  for (let i = 0, { length } = reconciled; i < length; i += 1) {
    const r = reconciled[i]!
    const rel = path.relative(REPO_ROOT, r.file)
    for (let j = 0, jl = r.changed.length; j < jl; j += 1) {
      const c = r.changed[j]!
      logger.info(
        `update: synced ${rel} '${c.alias}' ${c.aliasVersion} → ${c.baseVersion} (tracking base '${c.base}')`,
      )
    }
  }
  const { ok } = await run('pnpm', ['install'])
  if (!ok) {
    process.exitCode = process.exitCode || 1
  }
}

// Pass 4 — multi-ecosystem soak-aware plans. Beyond npm, a repo may carry Rust
// (Cargo.toml), Go (go.mod), Docker (Dockerfile) deps, pin a Node runtime
// version, or install tools via Homebrew — which has no soak of its own, so the
// brew runner adds one by discovering the repo's `brew install` sites (CI +
// scripts) and age-checking each formula/cask/tap against its tap-commit date.
// The node runner age-checks the pinned Node release against its published
// date the same way. Each runner self-detects
// its OWN manifests/sites (skipping vendored trees) and, in its default
// dry-plan mode, prints the soak-cleared updates it WOULD apply — no ecosystem
// toolchain is needed to plan. Applying stays a deliberate per-ecosystem step
// (`node scripts/fleet/update/<eco>.mts --soak-days N --apply|--fix`) because it
// needs that toolchain + network. A planner miss (blocked proxy/registry,
// absent manifest) is non-fatal to the npm update: it warns and moves on.
// SOAK_DAYS is the one fleet soak window — the same value taze's maturityPeriod
// and pnpm's minimumReleaseAge derive from. Network goes through tazeEnv() so it
// works behind the Socket Firewall, exactly like the taze passes above.
if (process.exitCode !== 1) {
  const ecosystems = ['brew', 'cargo', 'docker', 'go', 'node']
  for (let i = 0, { length } = ecosystems; i < length; i += 1) {
    const eco = ecosystems[i]!
    const runner = path.join(
      REPO_ROOT,
      'scripts',
      'fleet',
      'update',
      `${eco}.mts`,
    )
    logger.info(
      `update/${eco}: planning soak-cleared updates (soak ${SOAK_DAYS}d)…`,
    )
    const priorExit = process.exitCode
    const { ok } = await run(process.execPath, [
      runner,
      '--soak-days',
      String(SOAK_DAYS),
    ])
    if (!ok) {
      // Restore the pre-plan exit code: an ecosystem planner miss must not fail
      // the npm update. Applying is where a hard failure matters, not planning.
      process.exitCode = priorExit
      logger.warn(
        `update/${eco}: planner exited non-zero (non-fatal; see output above).`,
      )
    }
  }
}

// Pass 5 — fail-closed telemetry scan. An update may have pulled a telemetry /
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
