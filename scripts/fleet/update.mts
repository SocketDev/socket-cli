/**
 * Update: two-pass taze to apply the fleet's maturity policy correctly.
 *
 * Pass 1: third-party deps — soak-gated, Socket scopes and the pinned dev
 * toolchain excluded.
 *
 * Pass 2: Socket-owned scopes only, no cooldown.
 *
 * The full policy rides CLI flags: taze only discovers a root-level
 * `taze.config.<ext>`, never `.config/fleet/taze.config.mts`, so the config
 * file documents the policy while the flag lists in
 * scripts/fleet/constants/taze-passes.mts enforce it — including
 * `--include-locked`, without which taze silently skips every exact catalog
 * pin. See that module for the per-flag rationale.
 *
 * Pass 3: pnpm install to refresh the lockfile against the updated
 * package.json.
 *
 * This is a reference script. Consuming repos can drop it into their own
 * scripts/ dir and wire it in via a `"update": "node scripts/fleet/update.mts"`
 * package.json entry.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { SOAK_DAYS } from './constants/soak.mts'
import {
  TAZE_PASS_SOCKET_ARGS,
  TAZE_PASS_THIRD_PARTY_ARGS,
} from './constants/taze-passes.mts'
import { FLEET_CATALOG_YAML, PNPM_WORKSPACE_YAML, REPO_ROOT } from './paths.mts'
import { applyStableAliasReconcile } from './lib/stable-alias.mts'
import { collectPackumentFailures } from './lib/taze-output.mts'
import { scanRepoForTelemetry } from './lib/telemetry-scan.mts'
import {
  applyFleetPinLockstep,
  applyOverridePinLockstep,
} from './update/fleet-pins.mts'
import {
  findStalePatchKeysInFile,
  formatStalePatchKeysError,
} from './update/patched-deps.mts'
import {
  parsePnpmPatchTempDir,
  reKeyStalePatches,
  runPatchPort,
} from './update/patch-rekey.mts'

// Canonical homes of the fleet-owned pins (wheelhouse-only; absent in member
// repos, where the lockstep appliers skip them): the fleet catalog template
// and the sync-scaffolding override-pin manifest.
const TEMPLATE_FLEET_CATALOG_YAML = path.join(
  REPO_ROOT,
  'template',
  'base',
  '.config',
  'fleet',
  'pnpm-workspace.fleet.yaml',
)
const OVERRIDE_PIN_MANIFEST = path.join(
  REPO_ROOT,
  'scripts',
  'repo',
  'sync-scaffolding',
  'manifest',
  'catalog-overrides.mts',
)

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
  // Pass 1 — third-party deps, soak-gated. The arg list lives in
  // constants/taze-passes.mts so the integration tests exercise the exact
  // invocation this script spawns; see that module for the per-flag rationale.
  {
    args: [...TAZE_PASS_THIRD_PARTY_ARGS],
    cmd: path.join(REPO_ROOT, 'node_modules', '.bin', 'taze'),
    tazePass: true,
  },
  // Pass 2 — Socket deps, no cooldown.
  {
    args: [...TAZE_PASS_SOCKET_ARGS],
    cmd: path.join(REPO_ROOT, 'node_modules', '.bin', 'taze'),
    tazePass: true,
  },
  // The lockfile resync (`pnpm install`) runs AFTER the `-stable` alias
  // reconcile below — a Socket bump in pass 2 moves the base version, and the
  // matching `<name>-stable` alias must track it before the lockfile is
  // regenerated, else the lockfile pins the alias to the stale build.
]

async function main(): Promise<void> {
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
      '  Where: taze version resolution (registry packument fetch via the single-registry patch, hard request timeout).',
    )
    logger.error(
      '  Saw: lookup timeouts/failures; wanted: every dependency checked against its latest soaked version.',
    )
    logger.error(
      '  Fix: check registry egress (and that the taze single-registry patch applied — `pnpm install`), then re-run `pnpm run update`.',
    )
    for (let i = 0, { length } = list; i < length; i += 1) {
      logger.error(`  ✗ ${list[i]!}`)
    }
    process.exitCode = 1
  }

  // Pass 3a.0 — fleet-pin lockstep. The taze passes bump the LIVE
  // pnpm-workspace.yaml, but a fleet-canonical pin's source of truth is the
  // wheelhouse template catalog + the sync-scaffolding override-pin manifest —
  // a live-only bump loses at the next cascade, which splices the old version
  // straight back (svgo, vite, iconv-lite, lru-cache, string-width all bounced
  // this way). Mirror every fleet-owned bump into the canonical files in the
  // same wave so the update engine and the cascade agree. Only newer versions
  // mirror (the template→live direction belongs to the cascade); differing
  // drift that can't be mirrored is warned, never silently dropped.
  if (process.exitCode !== 1) {
    const pinResults = applyFleetPinLockstep(PNPM_WORKSPACE_YAML, [
      FLEET_CATALOG_YAML,
      TEMPLATE_FLEET_CATALOG_YAML,
    ])
    const overrideResult = applyOverridePinLockstep(
      PNPM_WORKSPACE_YAML,
      OVERRIDE_PIN_MANIFEST,
    )
    if (overrideResult) {
      pinResults.push(overrideResult)
    }
    for (let i = 0, { length } = pinResults; i < length; i += 1) {
      const r = pinResults[i]!
      const rel = path.relative(REPO_ROOT, r.file)
      for (let j = 0, jl = r.mirrored.length; j < jl; j += 1) {
        const m = r.mirrored[j]!
        logger.info(
          `update: fleet-pin lockstep ${rel} '${m.name}' ${m.canonicalValue} → ${m.liveValue} (${m.blockKey})`,
        )
      }
      for (let j = 0, jl = r.skipped.length; j < jl; j += 1) {
        const s = r.skipped[j]!
        logger.warn(
          `update: fleet-pin drift NOT mirrored to ${rel} — '${s.name}' live ${s.liveValue} vs canonical ${s.canonicalValue} (${s.reason}); reconcile via the cascade.`,
        )
      }
    }
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
      TEMPLATE_FLEET_CATALOG_YAML,
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
    // Stale-patch gate: a bump that leaves a `patchedDependencies` key on the
    // old version strands the very install below (ERR_PNPM_UNUSED_PATCH) — and
    // a half-state referencing a nonexistent patch file once got committed.
    // Instead of stopping and asking a human to re-key by hand, auto re-key:
    // remove the stale key so an install can materialize NEW, `pnpm patch
    // <name>@<NEW>`, an AI port of the OLD patch's semantic intent onto the
    // possibly-refactored new code (HIGH tier — patches are often
    // security-critical), verify, then `pnpm patch-commit`. The re-key is a
    // HARD gate: only a verified, converged re-key lets the install proceed. A
    // failed/unverified port — or SKIP_AI_FIX=1 in CI/non-interactive runs —
    // restores the tree byte-identically and falls back to the exact loud
    // manual instructions, leaving the old patch in place. Never silently bump
    // past a keyed patch.
    const stalePatchKeys = findStalePatchKeysInFile(PNPM_WORKSPACE_YAML)
    if (stalePatchKeys.length > 0) {
      const outcome = await reKeyStalePatches(stalePatchKeys, {
        detectStaleAfter: () => findStalePatchKeysInFile(PNPM_WORKSPACE_YAML),
        log: message => logger.info(message),
        portPatch: context => runPatchPort(context),
        readFile: relPath =>
          readFileSync(path.join(REPO_ROOT, relPath), 'utf8'),
        removeFile: relPath => {
          safeDeleteSync(path.join(REPO_ROOT, relPath))
        },
        runPnpmInstall: async () => {
          const result = await run('pnpm', ['install'])
          return { ok: result.ok, output: result.output }
        },
        runPnpmPatch: async spec => {
          const result = await run('pnpm', ['patch', spec])
          return {
            ok: result.ok,
            output: result.output,
            tempDir: parsePnpmPatchTempDir(result.output),
          }
        },
        runPnpmPatchCommit: async tempDir => {
          const result = await run('pnpm', ['patch-commit', tempDir])
          return { ok: result.ok, output: result.output }
        },
        skipAi: process.env['SKIP_AI_FIX'] === '1',
        writeFile: (relPath, content) => {
          writeFileSync(path.join(REPO_ROOT, relPath), content)
        },
      })
      if (outcome.ok) {
        for (let i = 0, { length } = outcome.rekeyed; i < length; i += 1) {
          const r = outcome.rekeyed[i]!
          logger.success(
            `update: auto-re-keyed '${r.name}' patch ${r.oldVersion} → ${r.newVersion} (${r.newPatchPath}).`,
          )
        }
        const { ok } = await run('pnpm', ['install'])
        if (!ok) {
          process.exitCode = process.exitCode || 1
        }
      } else {
        // Re-key did not fully converge: fall back to the loud manual gate with
        // whatever keys are still stale as the source of truth.
        logger.fail(
          formatStalePatchKeysError(
            findStalePatchKeysInFile(PNPM_WORKSPACE_YAML),
          ),
        )
        process.exitCode = 1
      }
    } else {
      const { ok } = await run('pnpm', ['install'])
      if (!ok) {
        process.exitCode = process.exitCode || 1
      }
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

  // Pass 6 — refresh fleet scaffolding. After dependencies are updated, apply the
  // latest fleet GitHub-release bundle if one is available and lock-step allows.
  // Fail-open: a network/gh outage must not fail `pnpm run update`.
  if (process.exitCode !== 1) {
    const priorExit = process.exitCode
    const { ok } = await run(process.execPath, [
      'scripts/repo/bootstrap/fleet.mjs',
      '--update',
    ])
    if (!ok) {
      process.exitCode = priorExit
      logger.warn(
        'update: fleet:update reported a problem (non-fatal). Run `pnpm run fleet:update` manually when connectivity returns.',
      )
    }
  }
}

// The run's completion promise. The CLI process waits for it via the event
// loop; the exit-gating tests await it so assertions run after every pass.
export const updateRun = main().catch((e: unknown) => {
  logger.error(e)
  process.exitCode = 1
})
