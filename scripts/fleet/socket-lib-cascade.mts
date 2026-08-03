#!/usr/bin/env node
/*
 * @file Claude-driveable orchestrator for the socket-lib DOWNSTREAM RELEASE
 *   CASCADE. When `@socketsecurity/lib` publishes a new version, a fixed train
 *   of downstream repos must absorb it and re-release in strict order. This
 *   orchestrator SEQUENCES that train as explicit, resumable, receipt-producing
 *   stages — the same shape as release-pipeline.mts — but it NEVER hand-rolls a
 *   release and NEVER picks a version or approves a staged package. Those are
 *   USER GATES the orchestrator stops at; every release defers to the owning
 *   repo's own `release-pipeline.mts` + `publish-pipeline.mts`.
 *
 *   The cascade, in strict order — each downstream stage HARD-GATES on the
 *   upstream version being actually PUBLISHED on npm before it proceeds, since
 *   `pnpm run update` pulls the published version:
 *
 *   1. wheelhouse-catalog — bump the @socketsecurity/lib catalog pin to the
 *      target, reconcile the -stable alias, dogfood, `pnpm install
 *      --lockfile-only`, assert the catalog checks, land to wheelhouse main.
 *      The target is the ALREADY-PUBLISHED @socketsecurity/lib version, read
 *      from the registry or pinned with `--version`; this orchestrator never
 *      releases socket-lib itself.
 *   2. packageurl-js — `pnpm run update` then release @socketregistry/packageurl-js
 *      via its release-pipeline. STOPS at that repo's bump-stop where the USER
 *      names the version and at staged-approve where the USER approves in the
 *      npm web UI. Gates the next stage on packageurl-js publishing.
 *   3. socket-registry — update socket-lib + packageurl-js, refresh
 *      registry/manifest.json, release @socketsecurity/registry via its
 *      release-pipeline. USER version + staged approve. Gates next on the
 *      published registry version.
 *   4. socket-sdk-js — update socket-lib + packageurl-js, release
 *      @socketsecurity/sdk via its release-pipeline. USER version + staged
 *      approve. Gates next on the published sdk version.
 *   5. socket-cli — for BOTH the v1.x and main branches, `pnpm run update` to
 *      pull the new @socketsecurity/sdk, then push each branch. Push-only, no
 *      release, no user gate.
 *
 *   The downstream DEPENDENCY GRAPH is not redefined here: this driver consumes
 *   RELEASE_CASCADE_GRAPH from lib/release-cascade.mts — flattenObligations for
 *   the per-repo manifest obligation, renderOwedAfterRelease for what a landed
 *   release owes downstream, and computeOwedFollowUps for the settle verdict —
 *   and layers only the resumable release TRAIN on top: the strict stage order,
 *   the published-version gates, and the USER-gate stops.
 *
 *   Receipts live in a state file under
 *   .cache/fleet/socket-lib-cascade/ — never the tracked tree — so
 *   a re-run resumes at the first incomplete stage. It coordinates rather than
 *   races: when another session is mid-release on a downstream repo the
 *   orchestrator detects the in-flight state from that repo's release-pipeline
 *   receipts and does not double-drive.
 *
 *   This file is the CLI shell only. The orchestrator's parts live in
 *   `socket-lib-cascade/`:
 *   - `stages.mts` — the stage table and the pure lookups over it.
 *   - `state.mts` — the receipt model, the state file, and the resume plan.
 *   - `gates.mts` — the published-version and downstream-activity decisions.
 *   - `render.mts` — every banner and table the run prints.
 *   - `commands.mts` — the deferred command sequences and their runner.
 *   - `drive.mts` — the registry, spawn, and filesystem edges plus the run
 *     loop.
 *   - `target.mts` — which published socket-lib version cascades, and the
 *     state file that carries it.
 *
 *   Usage: node scripts/fleet/socket-lib-cascade.mts [--version X.Y.Z]
 *     [--status] [--reset] [--dry-run]
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'
import { nowIso, readLatest, runCascade } from './socket-lib-cascade/drive.mts'
import { renderStatus } from './socket-lib-cascade/render.mts'
import { LIB_PKG, producedPackages } from './socket-lib-cascade/stages.mts'
import {
  loadState,
  resetState,
  statePath,
} from './socket-lib-cascade/state.mts'
import {
  ensureCascadeState,
  resolveTargetVersion,
} from './socket-lib-cascade/target.mts'
import { isMainModule } from './_shared/is-main-module.mts'

import type { CliFlags } from './socket-lib-cascade/drive.mts'
import type { RegistryReader } from './socket-lib-cascade/target.mts'

const logger = getDefaultLogger()

export const USAGE = `Usage: node scripts/fleet/socket-lib-cascade.mts [options]

  (no flags)        run/resume the cascade; stop at the first upstream-publish
                    gate or downstream USER release gate
  --version X.Y.Z   pin the ALREADY-PUBLISHED @socketsecurity/lib target
                    (default: the registry latest). This never releases
                    socket-lib; it only names which published version cascades.
  --status          print the receipt table and exit; a pure read — it never
                    writes state and never consults the registry
  --reset           discard cascade state and exit
  --dry-run         walk stages without mutations; registry reads still run
  --help            print this help and exit`

/**
 * The edges the CLI shell touches, injected so the argument wiring, the
 * read-only `--status` path, and the fatal target-resolution paths are testable
 * without a registry, a spawn, or a write into the operator's real cache tree.
 */
export interface CascadeCliIo {
  /**
   * The argv slice to parse. undefined reads `process.argv`, the production
   * path.
   */
  args: readonly string[] | undefined
  readLatest: RegistryReader
  runCascade: typeof runCascade
  stateFile: string
}

export function defaultCascadeCliIo(): CascadeCliIo {
  return {
    args: undefined,
    readLatest,
    runCascade,
    stateFile: statePath(REPO_ROOT),
  }
}

export async function main(
  io?: Partial<CascadeCliIo> | undefined,
): Promise<void> {
  const cfg = {
    __proto__: null,
    ...defaultCascadeCliIo(),
    ...io,
  } as CascadeCliIo
  const { values } = parseArgs({
    args: cfg.args,
    options: {
      'dry-run': { default: false, type: 'boolean' },
      help: { default: false, type: 'boolean' },
      reset: { default: false, type: 'boolean' },
      status: { default: false, type: 'boolean' },
      version: { type: 'string' },
    },
    allowPositionals: false,
    strict: false,
  })
  if (values['help']) {
    logger.log(USAGE)
    return
  }
  const file = cfg.stateFile
  if (values['reset']) {
    resetState(file)
    logger.success(`Cascade state cleared (${file}).`)
    return
  }
  // --status is a pure READ, so it is answered before any target resolution.
  // Resolving first would make a status query on a fresh machine perform four
  // registry reads and WRITE a state file, and with the registry unreachable it
  // would exit 1 without ever printing the table a status query asked for.
  if (values['status']) {
    const existing = loadState(file)
    logger.log(
      existing
        ? renderStatus(existing)
        : `No cascade state yet (${file}) — run without --status to start one.`,
    )
    return
  }
  const cli: CliFlags = {
    dryRun: !!values['dry-run'],
    namedVersion:
      typeof values['version'] === 'string' ? values['version'] : undefined,
  }
  const resolved = await resolveTargetVersion({
    namedVersion: cli.namedVersion,
    readLatest: cfg.readLatest,
  })
  if (resolved.status !== 'resolved') {
    logger.fail(resolved.message)
    process.exitCode = 1
    return
  }
  const target = resolved.version
  const setup = await ensureCascadeState({
    file,
    now: nowIso(),
    producedPkgs: producedPackages(),
    readLatest: cfg.readLatest,
    target,
  })
  if (setup.driftedFrom !== undefined) {
    logger.warn(
      `Target changed ${setup.driftedFrom} → ${target}; starting a fresh cascade.`,
    )
  }
  // A backfilled target keeps the receipts an earlier run wrote while no target
  // was known, and resume only reads a receipt's status — so those receipts now
  // count toward a cascade they never saw. Say so rather than let it pass
  // silently; `--reset` is the way out.
  if (setup.targetBackfilled) {
    logger.warn(
      `Stamped ${LIB_PKG}@${target} onto an existing cascade that had no target; its earlier receipts count toward this run. Re-run with --reset to start clean.`,
    )
  }
  logger.log(`Driving the ${LIB_PKG}@${target} downstream cascade.`)
  await cfg.runCascade(setup.state, cli)
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
