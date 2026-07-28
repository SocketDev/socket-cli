/*
 * @file Fleet doctor — worktree hygiene probes. Two checks that need FS + a
 *   possible reinstall, kept out of doctor.mts's dispatcher so it stays under
 *   the file-size cap:
 *
 *   - GAP 13: worktree node_modules is a FOREIGN symlink, into another repo.
 *     lstat the entry; only a symlink is readlink'd + resolved and judged by
 *     the pure isForeignNodeModulesSymlink. --fix removes the LINK only
 *     (safeDelete, never the target) then reinstalls with a frozen lockfile in
 *     repoRoot.
 *   - Quiescence advisory (report-only): is the repo safe for an EXTERNAL agent
 *     to land into right now? A non-quiescent tree — tracked-dirty or a held
 *     index.lock — means a co-session may be mid-edit, so cross-session landing
 *     should hold. Consumes readQuiescenceSignal + isRepoQuiescent, gated on an
 *     actual git checkout so fixture runs never spawn git. Also hosts the
 *     --await-quiescent gate (readyToLand), the production consumer of
 *     awaitQuiescence: block until the repo settles before diagnosing.
 */

import { existsSync, lstatSync, readlinkSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { isSpawnError } from '@socketsecurity/lib-stable/process/spawn/errors'

import type { DoctorFinding } from './lib/doctor/catalog-gap.mts'
import {
  formatForeignNodeModulesFinding,
  formatReinstallFailedFinding,
  isForeignNodeModulesSymlink,
} from './lib/doctor/node-modules-symlink-gap.mts'
import {
  awaitQuiescence,
  isRepoQuiescent,
  readQuiescenceSignal,
} from './_shared/quiescence.mts'

const logger = getDefaultLogger()

// The resolved absolute target of `node_modules` when it is a symlink,
// undefined when it is a real dir, absent, or unreadable. Resolves relative to
// the containing dir (cwd) so a relative link target lands correctly.
function nodeModulesSymlinkTarget(cwd: string): string | undefined {
  const nodeModulesPath = path.join(cwd, 'node_modules')
  try {
    if (!lstatSync(nodeModulesPath).isSymbolicLink()) {
      return undefined
    }
    return path.resolve(cwd, readlinkSync(nodeModulesPath))
  } catch {
    return undefined
  }
}

/**
 * GAP 13 + quiescence advisory. Returns the findings for both; may reinstall
 * under `doFix` when a foreign node_modules symlink is found.
 */
export async function runWorktreeProbes(config: {
  cwd: string
  doFix: boolean
}): Promise<DoctorFinding[]> {
  const cfg = Object.assign(Object.create(null), config) as typeof config
  const { cwd, doFix } = cfg
  const findings: DoctorFinding[] = []

  const nodeModulesPath = path.join(cwd, 'node_modules')
  const target = nodeModulesSymlinkTarget(cwd)
  if (isForeignNodeModulesSymlink(cwd, target) && target) {
    if (doFix) {
      // Delete the LINK only — safeDelete unlinks the symlink entry and never
      // follows it into the target repo's node_modules.
      await safeDelete(nodeModulesPath)
      logger.info(
        `doctor --fix: removed foreign node_modules symlink (→ ${target}); reinstalling with --frozen-lockfile…`,
      )
      try {
        await spawn('pnpm', ['install', '--frozen-lockfile'], {
          cwd,
          shell: process.platform === 'win32',
          stdioString: true,
        })
      } catch (e: unknown) {
        const detail = isSpawnError(e)
          ? `pnpm exited non-zero:\n${`${e.stderr ?? ''}\n${e.stdout ?? ''}`.trim()}`
          : errorMessage(e)
        findings.push(formatReinstallFailedFinding(cwd, detail))
      }
    } else {
      findings.push(formatForeignNodeModulesFinding(nodeModulesPath, target))
    }
  }

  // Quiescence advisory — only inside a git checkout so fixture runs (no .git)
  // never spawn git.
  if (existsSync(path.join(cwd, '.git'))) {
    const sig = readQuiescenceSignal(cwd)
    if (!isRepoQuiescent(sig)) {
      const lockNote = sig.indexLocked ? ' / index.lock held' : ''
      findings.push({
        fix: [
          'Hold cross-session landing until the primary session settles — it commits',
          'or clears its uncommitted WIP and releases .git/index.lock. Re-run the',
          'doctor to re-check, or gate a landing on `--await-quiescent`.',
          '',
          'The lander mutex in scripts/fleet/_shared/git-mutex.mts serializes fleet',
          'landers; this advisory catches ANY actor (fleet or not) mid-flight.',
        ].join('\n'),
        fixable: false,
        saw: `repo not quiescent (${sig.trackedDirty} tracked-dirty${lockNote})`,
        wanted:
          'a sustained tracked-clean tree with no held index.lock before cross-session landing',
        what: 'Repo not quiescent — a co-session may be active; hold cross-session landing',
        where: cwd,
      })
    }
  }

  return findings
}

/**
 * The --await-quiescent gate: when the flag is present, block until the repo
 * has been SUSTAINEDLY tracked-clean + index.lock-free + HEAD/origin-stable
 * before the doctor diagnoses a moving tree. Returns whether the doctor may
 * proceed: true when the flag is absent or the repo settled, false on timeout
 * the caller bails. The production consumer of awaitQuiescence.
 */
export async function readyToLand(
  argv: readonly string[],
  cwd: string,
): Promise<boolean> {
  if (!argv.includes('--await-quiescent')) {
    return true
  }
  const settled = await awaitQuiescence(cwd)
  if (settled) {
    logger.info(
      `doctor --await-quiescent: repo settled (0 tracked-dirty, no index.lock, stable HEAD ${settled.head.slice(0, 12) || '<none>'}).`,
    )
    return true
  }
  logger.warn(
    'doctor --await-quiescent: repo did not reach a stable, quiescent state before timeout — a co-session may still be active. Holding.',
  )
  return false
}
