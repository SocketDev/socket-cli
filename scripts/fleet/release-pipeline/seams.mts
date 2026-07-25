/**
 * @file Shared runner plumbing for the release pipeline: the StageOutcome
 *   shape every runner returns, the injectable process/registry seams
 *   (`options` bag, null-proto `opts` — the staged.mts idiom) that let unit
 *   tests drive every verdict path without real pnpm/git/gh/network, and the
 *   package.json reader for the release subject.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveReleaseSubject } from '../_shared/release-subject.mts'
import {
  ensureTagAndRelease,
  requireRegistryLive,
} from '../publish-infra/release.mts'
import { listStagedPackages } from '../publish-infra/npm/shared.mts'
import {
  fetchVersionTrustInfo,
  isAlreadyPublished,
} from '../publish-infra/npm/registry.mts'
import {
  compareExtractedTarballs,
  defaultPackTarball,
  verifyStagedEntry,
} from '../publish-infra/npm/staged.mts'
import { runCapture, runInherit } from '../publish-infra/shared.mts'

import type { StageListEntry } from '../publish-infra/npm/shared.mts'
import type { ReceiptStatus, ReleaseChecksums } from './state.mts'

/**
 * The per-version `dist` digests a public (unauthenticated) packument read
 * exposes — the registry-truth evidence the reconcile path compares a local
 * re-pack against.
 */
export interface RegistryDistInfo {
  integrity?: string | undefined
  shasum?: string | undefined
}

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
  compareTarballContents?:
    | ((
        tarA: string,
        tarB: string,
      ) => Promise<{ equal: boolean; detail: string }>)
    | undefined
  downloadRegistryTarball?:
    | ((name: string, version: string) => Promise<string | undefined>)
    | undefined
  ensureRelease?:
    | ((
        pkg: { name: string; version: string },
        options?:
          | { packAssets?: (() => Promise<string[]>) | undefined }
          | undefined,
      ) => Promise<void>)
    | undefined
  fetchRegistryDist?:
    | ((name: string) => Promise<Record<string, RegistryDistInfo>>)
    | undefined
  listStaged?: (() => Promise<StageListEntry[]>) | undefined
  packTarball?:
    | ((name: string, version: string) => Promise<string | undefined>)
    | undefined
  registryLive?:
    | ((name: string, version: string) => Promise<boolean>)
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
  compareTarballContents: (
    tarA: string,
    tarB: string,
  ) => Promise<{ equal: boolean; detail: string }>
  downloadRegistryTarball: (
    name: string,
    version: string,
  ) => Promise<string | undefined>
  ensureRelease: (
    pkg: { name: string; version: string },
    options?:
      | { packAssets?: (() => Promise<string[]>) | undefined }
      | undefined,
  ) => Promise<void>
  fetchRegistryDist: (name: string) => Promise<Record<string, RegistryDistInfo>>
  listStaged: () => Promise<StageListEntry[]>
  packTarball: (name: string, version: string) => Promise<string | undefined>
  registryLive: (name: string, version: string) => Promise<boolean>
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

// Public (unauthenticated) packument read: per-version dist digests. The
// abbreviated format is enough — it keeps dist.shasum + dist.integrity.
function defaultFetchRegistryDist(
  name: string,
): Promise<Record<string, RegistryDistInfo>> {
  return fetchVersionTrustInfo(name, 'abbreviated')
}

// Download the PUBLISHED tarball for a version into a fresh temp dir via
// `npm pack <name>@<version>` (an unauthenticated registry read; run from the
// temp dir because the repo's devEngines pins pnpm and vetoes bare npm
// invocations in-repo). Returns the tarball path, or undefined on failure.
async function defaultDownloadRegistryTarball(
  name: string,
  version: string,
): Promise<string | undefined> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-registry-dl-'))
  const dl = await runCapture('npm', ['pack', `${name}@${version}`], tmpDir)
  if (dl.code !== 0) {
    return undefined
  }
  const entries = await fs.readdir(tmpDir)
  const tgz = entries.find(e => e.endsWith('.tgz'))
  return tgz ? path.join(tmpDir, tgz) : undefined
}

// Default registry-liveness probe for the release stage: the version must be
// resolvable on npm (with the requireRegistryLive retry window for registry
// propagation) before the tag + immutable GH release may exist.
function defaultRegistryLive(name: string, version: string): Promise<boolean> {
  return requireRegistryLive({
    isLive: () => isAlreadyPublished(name, version),
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
    compareTarballContents:
      s.compareTarballContents ?? compareExtractedTarballs,
    downloadRegistryTarball:
      s.downloadRegistryTarball ?? defaultDownloadRegistryTarball,
    ensureRelease: s.ensureRelease ?? ensureTagAndRelease,
    fetchRegistryDist: s.fetchRegistryDist ?? defaultFetchRegistryDist,
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
 * Read the release subject's name + version: `<cwd>/package.json` for a plain
 * repo, the `publishConfig.directory` manifest for a redirected monorepo —
 * the version the pipeline bumps/verifies/releases is the SUBJECT's, never a
 * private root's.
 */
export function readPkg(cwd: string): { name: string; version: string } {
  const subject = resolveReleaseSubject(cwd)
  return { name: subject.name, version: subject.version }
}
