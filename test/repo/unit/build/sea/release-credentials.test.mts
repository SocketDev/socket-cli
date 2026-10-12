import crypto from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

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
vi.mock(
  import('../../../../../scripts/fleet/npm/publish/artifact/package.mts'),
  () => ({ inspectNpmArtifactPackage: mocks.inspectPackage }),
)
vi.mock(
  import('../../../../../scripts/fleet/registry/apple/ci/keychain.mts'),
  () => ({ withTemporaryAppleKeychain: mocks.withAppleKeychain }),
)
vi.mock(
  import('../../../../../scripts/fleet/registry/apple/identity.mts'),
  () => ({ getDeveloperIdIdentityLabel: mocks.getIdentityLabel }),
)
vi.mock(
  import('../../../../../scripts/fleet/npm/publish/artifact/receipt.mts'),
  async () => {
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
  },
)
vi.mock(
  import('../../../../../scripts/repo/build/sea/package/build.mts'),
  () => ({ buildNativePackageVerifier: mocks.buildVerifier }),
)
vi.mock(
  import('../../../../../scripts/repo/build/sea/package/check.mts'),
  () => ({ verifyNativePackage: mocks.verifyNativePackage }),
)
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

import { main } from '../../../../../scripts/repo/build/sea/release.mts'

const expected = {
  repository: 'SocketDev/socket-cli',
  runId: 34,
  runAttempt: 2,
  sourceSha: 'a'.repeat(40),
  packageName: 'socket',
  packageVersion: '1.0.0',
  appleTeamId: 'A1B2C3D4E5',
}
let tempRoot: string
let packageRoot: string
let originalProcess: NodeJS.Process
let originalArgv: string[]

beforeEach(async () => {
  vi.clearAllMocks()
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'socket-sea-credentials-'))
  packageRoot = path.join(tempRoot, 'package-root')
  mocks.packageRoot = packageRoot
  mocks.receiptPath = path.join(tempRoot, 'manifest.json')
  await mkdir(packageRoot)
  await writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: expected.packageName, version: expected.packageVersion }),
  )
  const binaries = {
    'darwin-arm64': Buffer.from('arm binary'),
    'darwin-x64': Buffer.from('x64 binary'),
  }
  const signing = (target: keyof typeof binaries, submissionId: string) => ({
    target,
    sha256: crypto.createHash('sha256').update(binaries[target]).digest('hex'),
    teamId: expected.appleTeamId,
    verified: true,
    hardenedRuntime: true,
    notarizationStatus: 'Accepted',
    submissionId,
  })
  await writeFile(
    mocks.receiptPath,
    JSON.stringify({
      darwinSigning: [
        signing('darwin-arm64', '550e8400-e29b-41d4-a716-446655440000'),
        signing('darwin-x64', '550e8400-e29b-41d4-a716-446655440001'),
      ],
    }),
  )
  mocks.runCapture.mockResolvedValue({ stdout: `${expected.sourceSha}\n`, code: 0 })
  mocks.pack.mockImplementation(async () => {
    const packedFile = path.join(tempRoot, 'packed.tgz')
    await writeFile(packedFile, 'package bytes')
    return packedFile
  })
  mocks.buildVerifier.mockImplementation(async ({ outputPath }) => {
    await writeFile(outputPath, 'verifier bytes')
    return outputPath
  })
  mocks.verifyNativePackage.mockResolvedValue(undefined)
  mocks.inspectPackage.mockImplementation(() => ({ darwinBinaries: binaries }))
  mocks.resolveTarget.mockReturnValue('darwin-arm64')
  mocks.withAppleKeychain.mockImplementation(
    async (
      config: unknown,
      callback: (identityHash: string) => Promise<unknown>,
    ) => {
      expect(config).toEqual({
        certificateBase64: Buffer.from('certificate fixture').toString('base64'),
        p12Password:
          process.env['APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS'] ?? '',
        identityLabel: 'Developer ID Application: Socket Inc. (A1B2C3D4E5)',
      })
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

function setNativeReleaseEnvironment(): void {
  vi.stubEnv('GITHUB_REPOSITORY', expected.repository)
  vi.stubEnv('GITHUB_RUN_ID', String(expected.runId))
  vi.stubEnv('GITHUB_RUN_ATTEMPT', String(expected.runAttempt))
  vi.stubEnv('APPLE_TEAM_ID', expected.appleTeamId)
  vi.stubEnv(
    'APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12',
    Buffer.from('certificate fixture').toString('base64'),
  )
  vi.stubEnv('APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS', 'fixture-pass')
  vi.stubEnv('APPLE_ASC_KEY_ID', 'fixture-key')
  vi.stubEnv('APPLE_ASC_ISSUER_ID', 'fixture-issuer')
  vi.stubEnv('APPLE_ASC_KEY_P8_B64', Buffer.from('private key').toString('base64'))
  process.argv = [
    process.execPath,
    'release.mts',
    '--source-sha',
    expected.sourceSha,
    '--package-version',
    expected.packageVersion,
    '--output-directory',
    path.join(tempRoot, 'main-release'),
  ]
}

it('accepts complete Apple ID notarization credentials', async () => {
  setNativeReleaseEnvironment()
  vi.stubEnv('APPLE_ASC_KEY_ID', '')
  vi.stubEnv('APPLE_ASC_ISSUER_ID', '')
  vi.stubEnv('APPLE_ASC_KEY_P8_B64', '')
  vi.stubEnv('APPLE_ID', 'release@example.test')
  vi.stubEnv('APPLE_APP_SPECIFIC_PASSWORD', 'fixture-password')
  const result = await main()
  expect(result.exitCode).toBe(0)
  expect(mocks.withAppleKeychain).toHaveBeenCalledTimes(1)
})

it.each([
  ['incomplete App Store Connect credentials', 'APPLE_ASC_KEY_P8_B64'],
  ['incomplete Apple ID credentials', 'APPLE_APP_SPECIFIC_PASSWORD'],
])('rejects %s when the other mode is incomplete', async (caseLabel, missing) => {
  expect(caseLabel).toBeTruthy()
  setNativeReleaseEnvironment()
  vi.stubEnv('APPLE_ID', '')
  vi.stubEnv('APPLE_APP_SPECIFIC_PASSWORD', '')
  if (missing === 'APPLE_APP_SPECIFIC_PASSWORD') {
    vi.stubEnv('APPLE_ASC_KEY_P8_B64', '')
    vi.stubEnv('APPLE_ID', 'release@example.test')
  }
  vi.stubEnv(missing, '')
  await expect(main()).rejects.toBeInstanceOf(Error)
  expect(mocks.getIdentityLabel).not.toHaveBeenCalled()
  expect(mocks.withAppleKeychain).not.toHaveBeenCalled()
})

it.each([
  ['certificate', 'APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12', ''],
])('still requires the %s', async (caseLabel, name, value) => {
  expect(caseLabel).toBeTruthy()
  setNativeReleaseEnvironment()
  vi.stubEnv(name, value)
  await expect(main()).rejects.toBeInstanceOf(Error)
  expect(mocks.getIdentityLabel).not.toHaveBeenCalled()
  expect(mocks.withAppleKeychain).not.toHaveBeenCalled()
})

it.each([
  ['absent', undefined],
  ['empty', ''],
])('imports the certificate when its password is %s', async (caseLabel, password) => {
  expect(caseLabel).toBeTruthy()
  setNativeReleaseEnvironment()
  if (password === undefined) {
    delete process.env['APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS']
  } else {
    vi.stubEnv('APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS', password)
  }
  const result = await main()
  expect(result.exitCode).toBe(0)
  expect(mocks.withAppleKeychain).toHaveBeenCalledTimes(1)
})

it('passes a configured certificate password to import without trimming', async () => {
  setNativeReleaseEnvironment()
  const password = '  fixture-pass  '
  vi.stubEnv('APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS', password)
  const result = await main()
  expect(result.exitCode).toBe(0)
  expect(mocks.withAppleKeychain).toHaveBeenCalledTimes(1)
})

it('builds under the imported signing identity and restores process state', async () => {
  setNativeReleaseEnvironment()
  vi.stubEnv('APPLE_DEVELOPER_ID_IDENTITY', 'original-identity')
  const result = await main()
  expect(mocks.withAppleKeychain).toHaveBeenCalledTimes(1)
  expect(mocks.runCapture).toHaveBeenCalledWith(
    'pnpm',
    ['run', 'build:native', '--mode=production', '--sign'],
    packageRoot,
  )
  expect(process.env['APPLE_DEVELOPER_ID_IDENTITY']).toBe('original-identity')
  expect(mocks.keychainCleanup).toHaveBeenCalledTimes(1)
  expect(result.exitCode).toBe(0)
})

it('cleans up the temporary keychain after a production build failure', async () => {
  setNativeReleaseEnvironment()
  mocks.runCapture.mockImplementation(async (...call) =>
    (call[1] as string[]).includes('build:native')
      ? { stdout: '', code: 1 }
      : { stdout: `${expected.sourceSha}\n`, code: 0 },
  )
  await expect(main()).rejects.toBeInstanceOf(Error)
  expect(mocks.keychainCleanup).toHaveBeenCalledTimes(1)
})
