import crypto from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import {
  getDefaultFormatting,
  stringifyWithFormatting,
} from '@socketsecurity/lib-stable/json/format'
import { hasNotarizeCredentialsInEnv } from '../../../fleet/apple-notarize.mts'
import { isMainModule } from '../../../fleet/process/is-main-module.mts'
import { runMain } from '../../../fleet/process/main/run.mts'
import {
  getScriptArgs,
  getScriptLogger,
} from '../../../fleet/process/script-output.mts'
import type { ScriptResult } from '../../../fleet/process/script-result.mts'
import {
  validateNpmArtifactReceipt,
  validateNpmArtifactReceiptExpectation,
} from '../../../fleet/npm/publish/artifact/receipt.mts'
import type { NpmArtifactReceiptExpectation } from '../../../fleet/npm/publish/artifact/receipt.mts'
import { inspectNpmArtifactPackage } from '../../../fleet/npm/publish/artifact/package.mts'
import { getDeveloperIdIdentityLabel } from '../../../fleet/registry/apple/identity.mts'
import { withTemporaryAppleKeychain } from '../../../fleet/registry/apple/ci/keychain.mts'
import { defaultPackTarball } from '../../../fleet/registry/npm/staged.mts'
import { runCapture } from '../../../fleet/registry/shared.mts'
import { PACKAGE_ROOT } from '../paths.mts'
import { buildNativePackageVerifier } from './package/build.mts'
import { verifyNativePackage } from './package/check.mts'
import { SEA_RECEIPT_PATH } from './paths.mts'
import { resolveSeaTarget } from './targets.mts'

const REPOSITORY = 'SocketDev/socket-cli'
const WORKFLOW_PATH = '.github/workflows/publish-native.yml'
const PACKAGE_NAME = 'socket'

export interface SeaReleaseConfig {
  expected: NpmArtifactReceiptExpectation
  outputDirectory: string
}

export interface SeaReleaseResult {
  packagePath: string
  verifierPath: string
  receiptPath: string
  packageSha256: string
  verifierSha256: string
}

function createSeaReleasePaths(
  outputDirectory: string,
): Omit<SeaReleaseResult, 'packageSha256' | 'verifierSha256'> {
  return {
    packagePath: path.join(outputDirectory, 'package.tgz'),
    verifierPath: path.join(outputDirectory, 'verifier.generated.mjs'),
    receiptPath: path.join(outputDirectory, 'receipt.json'),
  }
}

function getRequiredEnvironmentValue(name: string): string {
  const value = getEnvValue(name)
  if (!value || !value.trim()) {
    throw new Error(`Missing required Apple release credential ${name}.`)
  }
  return value
}

function hashSha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function parsePositiveInteger(
  value: string | undefined,
  label: string,
): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: expected a positive safe integer.`)
  }
  return parsed
}

function requireOption(value: string | undefined, flag: string): string {
  if (!value) {
    throw new Error(`Missing required option ${flag}.`)
  }
  return value
}

async function runPnpm(args: string[]): Promise<void> {
  const result = await runCapture('pnpm', args, PACKAGE_ROOT)
  if (result.code !== 0) {
    throw new Error(`Native release command failed: pnpm ${args.join(' ')}.`)
  }
}

function validateExpectedRelease(
  expected: NpmArtifactReceiptExpectation,
): void {
  validateNpmArtifactReceiptExpectation(expected)
  if (
    expected.repository !== REPOSITORY ||
    expected.workflowPath !== WORKFLOW_PATH ||
    expected.packageName !== PACKAGE_NAME
  ) {
    throw new Error('Native release identity does not match this repository.')
  }
}

async function verifySourceAndPackage(
  expected: NpmArtifactReceiptExpectation,
): Promise<void> {
  const source = await runCapture('git', ['rev-parse', 'HEAD'], PACKAGE_ROOT)
  if (source.code !== 0 || source.stdout.trim() !== expected.sourceSha) {
    throw new Error('Reserved source SHA does not match the current checkout.')
  }
  const packageJson = JSON.parse(
    await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  ) as { name?: unknown | undefined; version?: unknown | undefined }
  if (
    packageJson.name !== expected.packageName ||
    packageJson.version !== expected.packageVersion
  ) {
    throw new Error('Reserved package identity does not match package.json.')
  }
}

export function createSeaReleaseScriptResult(
  result: SeaReleaseResult,
): ScriptResult {
  return { exitCode: 0, data: result }
}

export async function produceSeaRelease(
  config: SeaReleaseConfig,
): Promise<SeaReleaseResult> {
  validateExpectedRelease(config.expected)
  const { expected, outputDirectory } = config
  const outputPaths = createSeaReleasePaths(outputDirectory)
  if (process.platform !== 'darwin') {
    throw new Error('Native release production requires a macOS host.')
  }
  await verifySourceAndPackage(expected)

  let ownsOutputDirectory = false
  try {
    await mkdir(outputDirectory)
    ownsOutputDirectory = true
    await runPnpm(['run', 'prepublish:check', '--reserved'])
    await runPnpm(['run', 'build:native', '--mode=production', '--sign'])
    await verifyNativePackage({
      packageRoot: PACKAGE_ROOT,
      target: resolveSeaTarget(process.platform, process.arch),
    })

    const packedPath = await defaultPackTarball(
      expected.packageName,
      expected.packageVersion,
      { root: PACKAGE_ROOT },
    )
    if (!packedPath) {
      throw new Error('Native release package packing returned no tarball.')
    }
    await copyFile(packedPath, outputPaths.packagePath)
    await buildNativePackageVerifier({
      outputPath: outputPaths.verifierPath,
    })

    const packageBytes = await readFile(outputPaths.packagePath)
    const verifierBytes = await readFile(outputPaths.verifierPath)
    const { darwinBinaries } = inspectNpmArtifactPackage(
      outputPaths.packagePath,
      expected,
    )
    const buildReceipt = JSON.parse(
      await readFile(SEA_RECEIPT_PATH, 'utf8'),
    ) as { darwinSigning?: unknown | undefined }
    const packageSha256 = hashSha256(packageBytes)
    const verifierSha256 = hashSha256(verifierBytes)
    const receipt = {
      __proto__: null,
      schemaVersion: 1,
      repository: expected.repository,
      workflowPath: expected.workflowPath,
      runId: expected.runId,
      runAttempt: expected.runAttempt,
      sourceSha: expected.sourceSha,
      packageName: expected.packageName,
      packageVersion: expected.packageVersion,
      appleTeamId: expected.appleTeamId,
      packageSha256,
      verifierSha256,
      darwinSigning: buildReceipt.darwinSigning,
    }
    validateNpmArtifactReceipt(receipt, expected, {
      package: packageBytes,
      verifier: verifierBytes,
      darwinBinaries,
    })
    await writeFile(
      outputPaths.receiptPath,
      stringifyWithFormatting(receipt, getDefaultFormatting()),
    )
    return { ...outputPaths, packageSha256, verifierSha256 }
  } catch (error) {
    if (ownsOutputDirectory) {
      await safeDelete(outputDirectory)
    }
    throw error
  }
}

const SCRIPT_META = {
  describe: 'build the signed Socket native release package and receipt',
  heavyJob: 'build' as const,
  help: 'Usage: pnpm run build:native:release --source-sha SHA --package-version VERSION --output-directory DIR',
  json: 'result' as const,
}

export async function main(): Promise<ScriptResult> {
  const options = parseArgs({
    args: getScriptArgs(),
    options: {
      'source-sha': { type: 'string' },
      'package-version': { type: 'string' },
      'output-directory': { type: 'string' },
      json: { type: 'boolean' },
    },
    strict: true,
    allowPositionals: false,
  }).values
  const sourceSha = requireOption(options['source-sha'], '--source-sha')
  const packageVersion = requireOption(
    options['package-version'],
    '--package-version',
  )
  const outputDirectory = requireOption(
    options['output-directory'],
    '--output-directory',
  )
  const expected: NpmArtifactReceiptExpectation = {
    repository: getEnvValue('GITHUB_REPOSITORY') ?? '',
    workflowPath: WORKFLOW_PATH,
    runId: parsePositiveInteger(
      getEnvValue('GITHUB_RUN_ID'),
      'workflow run ID',
    ),
    runAttempt: parsePositiveInteger(
      getEnvValue('GITHUB_RUN_ATTEMPT'),
      'workflow run attempt',
    ),
    sourceSha,
    packageName: PACKAGE_NAME,
    packageVersion,
    appleTeamId: getEnvValue('APPLE_TEAM_ID') ?? '',
  }
  validateNpmArtifactReceiptExpectation(expected)
  const certificateBase64 = getRequiredEnvironmentValue(
    'APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12',
  )
  const p12Password = getRequiredEnvironmentValue(
    'APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS',
  )
  if (!hasNotarizeCredentialsInEnv()) {
    throw new Error(
      'Native release requires complete Apple notarization credentials.',
    )
  }
  const result = await withTemporaryAppleKeychain(
    {
      certificateBase64,
      p12Password,
      identityLabel: getDeveloperIdIdentityLabel(),
    },
    async identityHash => {
      const previousIdentity = getEnvValue('APPLE_DEVELOPER_ID_IDENTITY')
      process.env['APPLE_DEVELOPER_ID_IDENTITY'] = identityHash
      try {
        return await produceSeaRelease({ expected, outputDirectory })
      } finally {
        if (previousIdentity === undefined) {
          delete process.env['APPLE_DEVELOPER_ID_IDENTITY']
        } else {
          process.env['APPLE_DEVELOPER_ID_IDENTITY'] = previousIdentity
        }
      }
    },
  )
  if (!process.argv.includes('--json')) {
    getScriptLogger().log(
      `Built signed native release files in ${outputDirectory}.`,
    )
  }
  return createSeaReleaseScriptResult(result)
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
