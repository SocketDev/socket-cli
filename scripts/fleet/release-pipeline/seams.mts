/**
 * @file Shared runner plumbing for the release pipeline: the StageOutcome
 *   shape every runner returns, the injectable process/registry seams
 *   (`options` bag, null-proto `opts` — the staged.mts idiom) that let unit
 *   tests drive every verdict path without real pnpm/git/gh/network, and the
 *   package.json reader for the release subject.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  ensureTagAndRelease,
  requireRegistryLive,
} from '../publish-infra/release.mts'
import { listStagedPackages } from '../publish-infra/npm/shared.mts'
import { isAlreadyPublished } from '../publish-infra/npm/registry.mts'
import {
  defaultPackTarball,
  verifyStagedEntry,
} from '../publish-infra/npm/staged.mts'
import { runCapture, runInherit } from '../publish-infra/shared.mts'

import type { StageListEntry } from '../publish-infra/npm/shared.mts'
import type { ReceiptStatus, ReleaseChecksums } from './state.mts'

/**
 * What a stage runner reports back; the CLI writes it into a receipt.
 * `releaseChecksums` rides on a passed verify outcome so the orchestrator can
 * stash it into state for the release stage (assets prepared before the
 * immutable release is created).
 */
export interface StageOutcome {
  detail: string
  releaseChecksums?: ReleaseChecksums | undefined
  status: ReceiptStatus
}

/**
 * Injectable process/registry seams. Defaults are the real publish-infra
 * helpers; tests inject fakes so no runner ever spawns for real.
 */
export interface RunnerSeams {
  ensureRelease?:
    | ((
        pkg: { name: string; version: string },
        options?:
          | { packAssets?: (() => Promise<string[]>) | undefined }
          | undefined,
      ) => Promise<void>)
    | undefined
  listStaged?: (() => Promise<StageListEntry[]>) | undefined
  packTarball?:
    | ((name: string, version: string) => Promise<string | undefined>)
    | undefined
  registryLive?:
    | ((name: string, version: string, cwd: string) => Promise<boolean>)
    | undefined
  runCapture?:
    | ((
        cmd: string,
        args: string[],
        cwd: string,
      ) => Promise<{ stdout: string; code: number }>)
    | undefined
  runInherit?:
    | ((cmd: string, args: string[], cwd: string) => Promise<number>)
    | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
  verifyEntry?: ((entry: StageListEntry) => Promise<boolean>) | undefined
}

export interface ResolvedSeams {
  ensureRelease: (
    pkg: { name: string; version: string },
    options?:
      | { packAssets?: (() => Promise<string[]>) | undefined }
      | undefined,
  ) => Promise<void>
  listStaged: () => Promise<StageListEntry[]>
  packTarball: (name: string, version: string) => Promise<string | undefined>
  registryLive: (name: string, version: string, cwd: string) => Promise<boolean>
  runCapture: (
    cmd: string,
    args: string[],
    cwd: string,
  ) => Promise<{ stdout: string; code: number }>
  runInherit: (cmd: string, args: string[], cwd: string) => Promise<number>
  sleep: (ms: number) => Promise<void>
  verifyEntry: (entry: StageListEntry) => Promise<boolean>
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

// Default registry-liveness probe for the release stage: the version must be
// resolvable on npm (with the requireRegistryLive retry window for registry
// propagation) before the tag + immutable GH release may exist.
function defaultRegistryLive(
  name: string,
  version: string,
  cwd: string,
): Promise<boolean> {
  return requireRegistryLive({
    isLive: () => isAlreadyPublished(name, version, cwd),
    registry: 'npm',
    subject: `${name}@${version}`,
  })
}

/**
 * Fill seam gaps with the real implementations.
 */
export function resolveSeams(seams: RunnerSeams | undefined): ResolvedSeams {
  const s = { __proto__: null, ...seams } as RunnerSeams
  return {
    ensureRelease: s.ensureRelease ?? ensureTagAndRelease,
    listStaged: s.listStaged ?? listStagedPackages,
    packTarball: s.packTarball ?? defaultPackTarball,
    registryLive: s.registryLive ?? defaultRegistryLive,
    runCapture: s.runCapture ?? runCapture,
    runInherit: s.runInherit ?? runInherit,
    sleep: s.sleep ?? defaultSleep,
    verifyEntry: s.verifyEntry ?? verifyStagedEntry,
  }
}

/**
 * Read `<cwd>/package.json` name + version (the release subject).
 */
export function readPkg(cwd: string): { name: string; version: string } {
  const raw = readFileSync(path.join(cwd, 'package.json'), 'utf8')
  const pkg = JSON.parse(raw) as {
    name?: string | undefined
    version?: string | undefined
  }
  return { name: pkg.name ?? '', version: pkg.version ?? '' }
}
