import crypto from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runCapture: vi.fn(),
  pack: vi.fn(),
  buildVerifier: vi.fn(),
  verifyNativePackage: vi.fn(),
  inspectPackage: vi.fn(),
  validateExpectation: vi.fn(),
  validateReceipt: vi.fn(),
  withAppleKeychain: vi.fn(),
  getIdentityLabel: vi.fn(),
  keychainCleanup: vi.fn(),
  resolveTarget: vi.fn(),
  packageRoot: '',
  receiptPath: '',
}))

vi.mock(import('../../../../../scripts/fleet/registry/shared.mts'), () => ({
  runCapture: mocks.runCapture,
}))
vi.mock(import('../../../../../scripts/fleet/registry/npm/staged.mts'), () => ({
  defaultPackTarball: mocks.pack,
}))
vi.mock(import('../../../../../scripts/fleet/npm/publish/artifact/package.mts'), () => ({
  inspectNpmArtifactPackage: mocks.inspectPackage,
}))
vi.mock(import('../../../../../scripts/fleet/registry/apple/ci/keychain.mts'), () => ({
  withTemporaryAppleKeychain: mocks.withAppleKeychain,
}))
vi.mock(import('../../../../../scripts/fleet/registry/apple/identity.mts'), () => ({
  getDeveloperIdIdentityLabel: mocks.getIdentityLabel,
}))
vi.mock(import('../../../../../scripts/fleet/npm/publish/artifact/receipt.mts'), async () => {
  const actual = await vi.importActual<
    typeof import('../../../../../scripts/fleet/npm/publish/artifact/receipt.mts')
  >('../../../../../scripts/fleet/npm/publish/artifact/receipt.mts')
  mocks.validateExpectation.mockImplementation(
    actual.validateNpmArtifactReceiptExpectation,
  )
  mocks.validateReceipt.mockImplementation(actual.validateNpmArtifactReceipt)
  return {
    ...actual,
    validateNpmArtifactReceiptExpectation: mocks.validateExpectation,
    validateNpmArtifactReceipt: mocks.validateReceipt,
  }
})
vi.mock(import('../../../../../scripts/repo/build/sea/package/build.mts'), () => ({
  buildNativePackageVerifier: mocks.buildVerifier,
}))
vi.mock(import('../../../../../scripts/repo/build/sea/package/check.mts'), () => ({
  verifyNativePackage: mocks.verifyNativePackage,
}))
vi.mock(import('../../../../../scripts/repo/build/sea/targets.mts'), () => ({
  resolveSeaTarget: mocks.resolveTarget,
}))
vi.mock(import('../../../../../scripts/repo/build/paths.mts'), () => ({
  get PACKAGE_ROOT() {
    return mocks.packageRoot
  },
}))
vi.mock(import('../../../../../scripts/repo/build/sea/paths.mts'), () => ({
  get SEA_RECEIPT_PATH() {
    return mocks.receiptPath
  },
}))

import {
  createSeaReleaseScriptResult,
  produceSeaRelease,
} from '../../../../../scripts/repo/build/sea/release.mts'
import { renderScriptResult } from '../../../../../scripts/fleet/process/script-result.mts'

const EXPECTED = {
  repository: 'SocketDev/socket-cli',
  workflowPath: '.github/workflows/publish-native.yml',
  runId: 34,
  runAttempt: 2,
  sourceSha: 'a'.repeat(40),
  packageName: 'socket',
  packageVersion: '1.0.0',
  appleTeamId: 'A1B2C3D4E5',
}
let tempRoot: string
let packageRoot: string
let packFile: string
let darwinBinaries: Record<'darwin-arm64' | 'darwin-x64', Buffer>
let originalProcess: NodeJS.Process
let originalArgv: string[]

beforeEach(async () => {
  vi.clearAllMocks()
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'socket-sea-release-'))
  packageRoot = path.join(tempRoot, 'package-root')
  mocks.packageRoot = packageRoot
  mocks.receiptPath = path.join(tempRoot, 'manifest.json')
  await mkdir(packageRoot)
  await writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: EXPECTED.packageName, version: EXPECTED.packageVersion }),
  )
  darwinBinaries = {
    'darwin-arm64': Buffer.from('arm binary'),
    'darwin-x64': Buffer.from('x64 binary'),
  }
  await writeFile(
    mocks.receiptPath,
    JSON.stringify({ darwinSigning: createSigningEvidence(darwinBinaries) }),
  )
  packFile = path.join(tempRoot, 'packed.tgz')
  await writeFile(packFile, 'package bytes')
  mocks.runCapture.mockResolvedValue({ stdout: `${EXPECTED.sourceSha}\n`, code: 0 })
  mocks.pack.mockResolvedValue(packFile)
  mocks.buildVerifier.mockImplementation(async ({ outputPath }) => {
    await writeFile(outputPath, 'verifier bytes')
    return outputPath
  })
  mocks.verifyNativePackage.mockResolvedValue(undefined)
  mocks.inspectPackage.mockImplementation(() => ({ darwinBinaries }))
  mocks.resolveTarget.mockReturnValue('darwin-arm64')
  mocks.withAppleKeychain.mockImplementation(
    async (
      config: unknown,
      callback: (identityHash: string) => Promise<unknown>,
    ) => {
      expect(config).toBeDefined()
      try {
        return await callback('d'.repeat(40))
      } finally {
        mocks.keychainCleanup()
      }
    },
  )
  mocks.getIdentityLabel.mockReturnValue(
    'Developer ID Application: Socket Inc. (A1B2C3D4E5)',
  )
  originalProcess = process
  originalArgv = process.argv
  vi.stubGlobal('process', { ...process, platform: 'darwin', arch: 'arm64' })
})

afterEach(async () => {
  process.argv = originalArgv
  vi.unstubAllEnvs()
  vi.stubGlobal('process', originalProcess)
  await rm(tempRoot, { recursive: true, force: true })
})

function hash(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function createSigningEvidence(
  binaries: Record<'darwin-arm64' | 'darwin-x64', Buffer>,
): Array<{
  target: string
  sha256: string
  teamId: string
  verified: boolean
  hardenedRuntime: boolean
  notarizationStatus: string
  submissionId: string
}> {
  return [
    {
      target: 'darwin-arm64',
      sha256: hash(binaries['darwin-arm64']),
      teamId: EXPECTED.appleTeamId,
      verified: true,
      hardenedRuntime: true,
      notarizationStatus: 'Accepted',
      submissionId: '550e8400-e29b-41d4-a716-446655440000',
    },
    {
      target: 'darwin-x64',
      sha256: hash(binaries['darwin-x64']),
      teamId: EXPECTED.appleTeamId,
      verified: true,
      hardenedRuntime: true,
      notarizationStatus: 'Accepted',
      submissionId: '550e8400-e29b-41d4-a716-446655440001',
    },
  ]
}

function releaseConfig(outputDirectory = path.join(tempRoot, 'artifact')) {
  return { expected: EXPECTED, outputDirectory }
}

describe('produceSeaRelease', () => {
  it('runs one signed production build, packs once, and writes the receipt last', async () => {
    const result = await produceSeaRelease(releaseConfig())
    expect(mocks.runCapture.mock.calls).toEqual([
      ['git', ['rev-parse', 'HEAD'], expect.any(String)],
      ['pnpm', ['run', 'prepublish:check', '--reserved'], expect.any(String)],
      ['pnpm', ['run', 'build:native', '--mode=production', '--sign'], expect.any(String)],
    ])
    expect(mocks.pack).toHaveBeenCalledTimes(1)
    expect(mocks.pack).toHaveBeenCalledWith(
      EXPECTED.packageName,
      EXPECTED.packageVersion,
      { root: expect.any(String) },
    )
    expect(mocks.buildVerifier).toHaveBeenCalledTimes(1)
    expect(mocks.verifyNativePackage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pack.mock.invocationCallOrder[0]!,
    )
    expect(mocks.pack.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.buildVerifier.mock.invocationCallOrder[0]!,
    )
    expect(mocks.verifyNativePackage).toHaveBeenCalledWith({
      packageRoot: expect.any(String),
      target: 'darwin-arm64',
    })
    expect(await readdir(path.dirname(result.receiptPath))).toEqual([
      'package.tgz',
      'receipt.json',
      'verifier.generated.mjs',
    ])
    const packageBytes = await readFile(result.packagePath)
    const verifierBytes = await readFile(result.verifierPath)
    expect(result.packageSha256).toBe(
      crypto.createHash('sha256').update(packageBytes).digest('hex'),
    )
    expect(result.verifierSha256).toBe(
      crypto.createHash('sha256').update(verifierBytes).digest('hex'),
    )
    expect(mocks.validateReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        packageSha256: result.packageSha256,
        verifierSha256: result.verifierSha256,
      }),
      EXPECTED,
      expect.objectContaining({ package: packageBytes, verifier: verifierBytes }),
    )
    const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8')) as {
      [key: string]: unknown
      darwinSigning: Array<Record<string, unknown>>
    }
    expect(Object.keys(receipt).toSorted()).toEqual(
      [
        'schemaVersion',
        'repository',
        'workflowPath',
        'runId',
        'runAttempt',
        'sourceSha',
        'packageName',
        'packageVersion',
        'appleTeamId',
        'packageSha256',
        'verifierSha256',
        'darwinSigning',
      ].toSorted(),
    )
    expect(receipt.darwinSigning).toHaveLength(2)
    expect(Object.keys(receipt.darwinSigning[0]!).toSorted()).toEqual(
      [
        'target',
        'sha256',
        'teamId',
        'verified',
        'hardenedRuntime',
        'notarizationStatus',
        'submissionId',
      ].toSorted(),
    )
  })

  it('serializes one standard JSON result object with paths and digests', () => {
    const data = {
      packagePath: '/release/package.tgz',
      verifierPath: '/release/verifier.generated.mjs',
      receiptPath: '/release/receipt.json',
      packageSha256: 'a'.repeat(64),
      verifierSha256: 'b'.repeat(64),
    }
    const output = renderScriptResult(createSeaReleaseScriptResult(data))
    expect(JSON.parse(output)).toEqual({ ok: true, exitCode: 0, data })
  })

  it.each([
    ['repository', { repository: 'Other/repo' }],
    ['workflow', { workflowPath: '.github/workflows/other.yml' }],
    ['package name', { packageName: 'other' }],
  ])('rejects an invalid %s before source lookup', async (caseLabel, changes) => {
    expect(caseLabel).toBeTruthy()
    await expect(
      produceSeaRelease({
        ...releaseConfig(),
        expected: { ...EXPECTED, ...changes },
      }),
    ).rejects.toBeInstanceOf(Error)
    expect(mocks.runCapture).not.toHaveBeenCalled()
    expect(mocks.pack).not.toHaveBeenCalled()
  })

  it('checks a reserved package version against package.json before building', async () => {
    await expect(
      produceSeaRelease({
        ...releaseConfig(),
        expected: { ...EXPECTED, packageVersion: '9.9.9' },
      }),
    ).rejects.toBeInstanceOf(Error)
    expect(mocks.runCapture).toHaveBeenCalledTimes(1)
    expect(mocks.runCapture).toHaveBeenCalledWith(
      'git',
      ['rev-parse', 'HEAD'],
      packageRoot,
    )
    expect(mocks.pack).not.toHaveBeenCalled()
    expect(mocks.verifyNativePackage).not.toHaveBeenCalled()
  })

  it('rejects a source SHA mismatch before build commands', async () => {
    mocks.runCapture.mockResolvedValueOnce({ stdout: 'b'.repeat(40), code: 0 })
    await expect(produceSeaRelease(releaseConfig())).rejects.toBeInstanceOf(Error)
    expect(mocks.pack).not.toHaveBeenCalled()
  })

  it('rejects a non-Darwin host before build commands', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux', arch: 'x64' })
    await expect(produceSeaRelease(releaseConfig())).rejects.toBeInstanceOf(Error)
    expect(mocks.runCapture).not.toHaveBeenCalled()
  })

  it('writes no receipt and cleans its new directory after a native build failure', async () => {
    mocks.runCapture.mockImplementation(async (command, args) => {
      if (command === 'git') {
        return { stdout: `${EXPECTED.sourceSha}\n`, code: 0 }
      }
      expect(command).toBe('pnpm')
      return args.includes('build:native')
        ? { stdout: '', code: 1 }
        : { stdout: '', code: 0 }
    })
    const config = releaseConfig()
    await expect(produceSeaRelease(config)).rejects.toBeInstanceOf(Error)
    expect(mocks.runCapture).toHaveBeenCalledWith(
      'pnpm',
      ['run', 'build:native', '--mode=production', '--sign'],
      packageRoot,
    )
    expect(mocks.pack).not.toHaveBeenCalled()
    await expect(readdir(config.outputDirectory)).rejects.toBeInstanceOf(Error)
  })

  it('does not write a receipt when native package verification fails', async () => {
    mocks.verifyNativePackage.mockRejectedValue(new Error('native check failed'))
    const config = releaseConfig()
    await expect(produceSeaRelease(config)).rejects.toBeInstanceOf(Error)
    expect(mocks.verifyNativePackage).toHaveBeenCalledWith({
      packageRoot: expect.any(String),
      target: 'darwin-arm64',
    })
    expect(mocks.pack).not.toHaveBeenCalled()
    await expect(readdir(config.outputDirectory)).rejects.toBeInstanceOf(Error)
  })

  it('rejects a missing package tarball and removes the owned directory', async () => {
    mocks.pack.mockResolvedValue(undefined)
    const config = releaseConfig()
    await expect(produceSeaRelease(config)).rejects.toBeInstanceOf(Error)
    expect(mocks.pack).toHaveBeenCalledWith(
      EXPECTED.packageName,
      EXPECTED.packageVersion,
      { root: expect.any(String) },
    )
    expect(mocks.verifyNativePackage).toHaveBeenCalled()
    await expect(readdir(config.outputDirectory)).rejects.toBeInstanceOf(Error)
  })

  it('rejects packed identity mismatch through package inspection', async () => {
    mocks.inspectPackage.mockImplementation(() => {
      throw new Error('packed identity mismatch')
    })
    const config = releaseConfig()
    await expect(produceSeaRelease(config)).rejects.toBeInstanceOf(Error)
    expect(mocks.pack).toHaveBeenCalledTimes(1)
    expect(mocks.inspectPackage).toHaveBeenCalled()
    await expect(readdir(config.outputDirectory)).rejects.toBeInstanceOf(Error)
  })

  it.each(['missing', 'duplicate', 'wrong team', 'unaccepted', 'changed digest'])(
    'rejects %s signing evidence through the canonical receipt validator',
    async label => {
      const evidence = createSigningEvidence(darwinBinaries)
      if (label === 'missing') {
        evidence.splice(0, evidence.length)
      } else if (label === 'duplicate') {
        evidence.splice(1, 1, { ...evidence[0]! })
      } else if (label === 'wrong team') {
        evidence[1]!.teamId = 'ZZZZZZZZZZ'
      } else if (label === 'unaccepted') {
        evidence[1]!.notarizationStatus = 'Pending'
      } else {
        evidence[1]!.sha256 = '3'.repeat(64)
      }
      await writeFile(mocks.receiptPath, JSON.stringify({ darwinSigning: evidence }))
      const config = releaseConfig()
      await expect(produceSeaRelease(config)).rejects.toBeInstanceOf(Error)
      expect(mocks.validateReceipt).toHaveBeenCalled()
      await expect(readdir(config.outputDirectory)).rejects.toBeInstanceOf(Error)
    },
  )

  it('rejects changed packed Darwin bytes through the canonical receipt validator', async () => {
    darwinBinaries = {
      ...darwinBinaries,
      'darwin-arm64': Buffer.from('changed packed binary'),
    }
    const config = releaseConfig()
    await expect(produceSeaRelease(config)).rejects.toBeInstanceOf(Error)
    expect(mocks.validateReceipt).toHaveBeenCalled()
    await expect(readdir(config.outputDirectory)).rejects.toBeInstanceOf(Error)
  })

  it('preserves a pre-existing output directory on refusal', async () => {
    const config = releaseConfig()
    await mkdir(config.outputDirectory)
    await writeFile(path.join(config.outputDirectory, 'keep.txt'), 'keep')
    await expect(produceSeaRelease(config)).rejects.toBeInstanceOf(Error)
    expect(await readFile(path.join(config.outputDirectory, 'keep.txt'), 'utf8')).toBe('keep')
  })
})

