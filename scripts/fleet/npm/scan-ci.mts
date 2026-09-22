/**
 * @file Produce a CI-only Socket scan receipt for exact staged npm bytes.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { isMainModule } from '../process/is-main-module.mts'
import { runMain } from '../process/run-main.mts'
import type { ScriptMeta } from '../process/run-main.mts'
import type { ScriptResult } from '../process/script-result.mts'
import { resolveReleaseSubject } from '../release/subject.mts'
import { scanStagedEntryDetailed } from '../registry-infra/npm/scan.mts'
import type { StagedScanVerdict } from '../registry-infra/npm/scan.mts'
import { defaultPackTarball } from '../registry-infra/npm/staged.mts'
import { resolveNpmWorkspaceLayout } from '../registry-infra/npm/workspace.mts'
import { rootPath, runCapture } from '../registry-infra/shared.mts'
import {
  NPM_SCAN_RECEIPT_FILE,
  parseNpmRemoteScanReceipt,
} from './scan-receipt.mts'
import type { NpmRemoteScanReceipt } from './scan-receipt.mts'

const SHA_RE = /^[0-9a-f]{40}$/u
const STAGE_ID_RE = /^[0-9a-f-]{36}$/u
const RECEIPT_PATH = path.join(
  rootPath,
  '.cache/fleet/npm-scan-ci',
  NPM_SCAN_RECEIPT_FILE,
)

export interface ScanCiConfig {
  currentRunAttempt: number
  currentRunId: number
  originalPublishRunId: number
  packageName: string
  packageVersion: string
  repository: string
  sourceSha: string
  stageId: string
  stageSha1: string
}

interface ScanCiDeps {
  headSha: () => Promise<string>
  pack: typeof defaultPackTarball
  scan: typeof scanStagedEntryDetailed
  subject: (root: string) => { name: string; version: string }
  writeReceipt: (receipt: NpmRemoteScanReceipt) => Promise<void>
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `Missing CI scan input. Where: ${name}. Saw: empty; wanted a workflow-bound value. Fix: dispatch publish-npm.yml with every scan input.`,
    )
  }
  return value.trim()
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(
      `Invalid CI scan input. Where: ${name}. Saw: ${JSON.stringify(value)}; wanted a positive integer. Fix: use the GitHub Actions run value.`,
    )
  }
  return parsed
}

export function readScanCiConfig(env: NodeJS.ProcessEnv): ScanCiConfig {
  const sourceSha = requiredEnv(env, 'SCAN_SOURCE_SHA').toLowerCase()
  const stageSha1 = requiredEnv(env, 'SCAN_STAGE_SHA1').toLowerCase()
  const stageId = requiredEnv(env, 'SCAN_STAGE_ID')
  if (
    !SHA_RE.test(sourceSha) ||
    !SHA_RE.test(stageSha1) ||
    !STAGE_ID_RE.test(stageId)
  ) {
    throw new Error(
      'Invalid CI scan identity. Where: source SHA, stage SHA1, or stage ID. Saw: a malformed value; wanted full 40-hex digests and the npm stage UUID. Fix: copy exact values from the publish and stage receipts.',
    )
  }
  return {
    currentRunAttempt: positiveInteger(
      requiredEnv(env, 'GITHUB_RUN_ATTEMPT'),
      'GITHUB_RUN_ATTEMPT',
    ),
    currentRunId: positiveInteger(
      requiredEnv(env, 'GITHUB_RUN_ID'),
      'GITHUB_RUN_ID',
    ),
    originalPublishRunId: positiveInteger(
      requiredEnv(env, 'SCAN_PUBLISH_RUN_ID'),
      'SCAN_PUBLISH_RUN_ID',
    ),
    packageName: requiredEnv(env, 'SCAN_PACKAGE'),
    packageVersion: requiredEnv(env, 'SCAN_VERSION'),
    repository: requiredEnv(env, 'GITHUB_REPOSITORY'),
    sourceSha,
    stageId,
    stageSha1,
  }
}

async function currentHeadSha(): Promise<string> {
  const result = await runCapture('git', ['rev-parse', 'HEAD'], rootPath)
  return result.code === 0 ? result.stdout.trim() : ''
}

async function writeReceipt(receipt: NpmRemoteScanReceipt): Promise<void> {
  await fs.mkdir(path.dirname(RECEIPT_PATH), { recursive: true })
  await fs.writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
  })
  await fs.chmod(RECEIPT_PATH, 0o600)
}

function receiptFrom(
  config: ScanCiConfig,
  verdict: StagedScanVerdict,
): NpmRemoteScanReceipt {
  if (!verdict.ok || !verdict.scanId) {
    throw new Error(
      `Socket scan refused. Where: full-scan verdict. Saw: ${verdict.detail}; wanted a passing scan ID. Fix: resolve policy or API failures, then dispatch a new scan.`,
    )
  }
  return parseNpmRemoteScanReceipt({
    packageName: config.packageName,
    packageVersion: config.packageVersion,
    policy: {
      errorAlerts: verdict.errorAlerts.length,
      warnAlerts: verdict.warnAlerts.length,
    },
    publishRunId: config.originalPublishRunId,
    repository: config.repository,
    runAttempt: config.currentRunAttempt,
    runId: config.currentRunId,
    scanId: verdict.scanId,
    schemaVersion: 1,
    sourceSha: config.sourceSha,
    stageId: config.stageId,
    stageSha1: config.stageSha1,
    verdict: 'passed',
    workflow: 'publish-npm.yml',
  })
}

function runtimeDeps(packageName: string): ScanCiDeps {
  return {
    headSha: currentHeadSha,
    pack: defaultPackTarball,
    scan: scanStagedEntryDetailed,
    subject(root) {
      const layout = resolveNpmWorkspaceLayout(root)
      if (layout.kind === 'single') {
        return resolveReleaseSubject(root)
      }
      const member = layout.packages.find(pkg => pkg.name === packageName)
      if (!member) {
        throw new Error('Scan package is absent from the release workspace.')
      }
      return member
    },
    writeReceipt,
  }
}

export async function runScanCi(
  config: ScanCiConfig,
  options: { deps?: ScanCiDeps | undefined } = {},
): Promise<NpmRemoteScanReceipt> {
  const deps = options.deps ?? runtimeDeps(config.packageName)
  const headSha = await deps.headSha()
  if (headSha !== config.sourceSha) {
    throw new Error(
      `Source checkout mismatch. Where: git HEAD. Saw: ${headSha || '<unreadable>'}; wanted ${config.sourceSha}. Fix: check out the exact signed bump before scanning.`,
    )
  }
  const subject = deps.subject(rootPath)
  if (
    subject.name !== config.packageName ||
    subject.version !== config.packageVersion
  ) {
    throw new Error(
      `Package mismatch. Where: rebuilt publish subject. Saw: ${subject.name}@${subject.version}; wanted ${config.packageName}@${config.packageVersion}. Fix: use the exact signed bump SHA.`,
    )
  }
  const tarball = await deps.pack(
    config.packageName,
    config.packageVersion,
    rootPath,
  )
  if (!tarball) {
    throw new Error('Canonical npm pack produced no tarball.')
  }
  try {
    const verdict = await deps.scan(
      { name: config.packageName, version: config.packageVersion },
      {
        expectedShasum: config.stageSha1,
        packTarball: async () => tarball,
      },
    )
    const receipt = receiptFrom(config, verdict)
    await deps.writeReceipt(receipt)
    return receipt
  } finally {
    await safeDelete(tarball)
  }
}

export async function main(): Promise<ScriptResult> {
  const receipt = await runScanCi(readScanCiConfig(process.env))
  return { data: receipt, exitCode: 0 }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'rebuilds exact staged npm bytes in CI and records a Socket policy scan',
  help: `Usage: pnpm run npm:scan:ci [--json]\n\nCI only. Inputs come from the publish-npm workflow environment.`,
  json: 'result',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
