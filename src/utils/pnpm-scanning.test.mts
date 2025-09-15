import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAlertsMapFromPnpmLockfile } from './alerts-map.mts'
import { extractPurlsFromPnpmLockfile, parsePnpmLockfile } from './pnpm.mts'

// Mock all dependencies with vi.hoisted for better type safety
const mockGetPublicApiToken = vi.hoisted(() => vi.fn())
const mockSetupSdk = vi.hoisted(() => vi.fn())
const mockFindSocketYmlSync = vi.hoisted(() => vi.fn())
const mockAddArtifactToAlertsMap = vi.hoisted(() => vi.fn())
const mockBatchPackageStream = vi.hoisted(() => vi.fn())

vi.mock('./sdk.mts', () => ({
  getPublicApiToken: mockGetPublicApiToken,
  setupSdk: mockSetupSdk,
}))

vi.mock('./config.mts', () => ({
  findSocketYmlSync: mockFindSocketYmlSync,
}))

vi.mock('./socket-package-alert.mts', () => ({
  addArtifactToAlertsMap: mockAddArtifactToAlertsMap,
}))

vi.mock('./filter-config.mts', () => ({
  toFilterConfig: vi.fn(filter => filter || {}),
}))

describe('PNPM Lockfile PURL Scanning', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Setup default mock implementations
    mockGetPublicApiToken.mockReturnValue('test-token')
    mockFindSocketYmlSync.mockReturnValue({ ok: false, data: undefined })
    mockAddArtifactToAlertsMap.mockResolvedValue(undefined)

    mockBatchPackageStream.mockImplementation(async function* () {
      yield {
        success: true,
        data: {
          purl: 'pkg:npm/lodash@4.17.21',
          name: 'lodash',
          version: '4.17.21',
          alerts: [],
        },
      }
    })

    mockSetupSdk.mockResolvedValue({
      ok: true,
      data: {
        batchPackageStream: mockBatchPackageStream,
      },
    })
  })
  it('should extract PURLs from simple pnpm lockfile', async () => {
    const lockfileContent = `lockfileVersion: '6.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

dependencies:
  lodash:
    specifier: ^4.17.21
    version: 4.17.21

packages:

  /lodash@4.17.21:
    resolution: {integrity: sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==}
    dev: false`

    const lockfile = parsePnpmLockfile(lockfileContent)
    expect(lockfile).toBeTruthy()

    const purls = await extractPurlsFromPnpmLockfile(lockfile!)
    expect(purls).toContain('pkg:npm/lodash@4.17.21')
  })

  it('should extract PURLs from lockfile with scoped packages', async () => {
    const lockfileContent = `lockfileVersion: '6.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

dependencies:
  '@types/node':
    specifier: ^20.0.0
    version: 20.11.19

packages:

  /@types/node@20.11.19:
    resolution: {integrity: sha512-7xMnVEcZFu0DikYjWOlRq7NtpXhPbzxYrZOVgou07X5wMeFWmEK8lgP5btmu+2IjuXlRQQzk3TgEDwVlaUaIZA==}
    dev: true`

    const lockfile = parsePnpmLockfile(lockfileContent)
    expect(lockfile).toBeTruthy()

    const purls = await extractPurlsFromPnpmLockfile(lockfile!)
    expect(purls).toContain('pkg:npm/@types/node@20.11.19')
  })

  it('should extract PURLs from lockfile with transitive dependencies', async () => {
    const lockfileContent = `lockfileVersion: '6.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

dependencies:
  express:
    specifier: ^4.18.0
    version: 4.18.2

packages:

  /express@4.18.2:
    resolution: {integrity: sha512-5/PsL6iGPdfQ/lKM1UuielYgv3BUoJfz1aUwU9vHZ+J7gyvwdQXFEBIEIaxeGf0GIcreATNyBExtalisDbuMqQ==}
    engines: {node: '>= 0.10.0'}
    dependencies:
      accepts: 1.3.8
      array-flatten: 1.1.1
    dev: false

  /accepts@1.3.8:
    resolution: {integrity: sha512-PYAthTa2m2VKxuvSD3DPC/Gy+U+sOA1LAuT8mkmRuvw+NACSaeXEQ+NHcVF7rONl6qcaxV3Uuemwawk+7+SJLw==}
    engines: {node: '>= 0.6'}
    dependencies:
      mime-types: 2.1.35
    dev: false

  /array-flatten@1.1.1:
    resolution: {integrity: sha512-PCVAQswWemu6UdxsDFFX/+gVeYqKAod3D3UVm91jHwynguOwAvYPhx8nNlM++NqRcK6CxxpUafjmhIdKiHibqg==}
    dev: false

  /mime-types@2.1.35:
    resolution: {integrity: sha512-ZDY+bPm5zTTF+YpCrAU9nK0UgICYPT0QtT1NZWFv4s++TNkcgVaT0g6+4R2uI4MjQjzysHB1zxuWL50hzaeXiw==}
    engines: {node: '>= 0.6'}
    dependencies:
      mime-db: 1.52.0
    dev: false

  /mime-db@1.52.0:
    resolution: {integrity: sha512-sPU4uV7dYlvtWJxwwxHD0PuihVNiE7TyAbQ5SWxDCB9mUYvOgroQOwYQQOKPJ8CIbE+1ETVlOoK1UC2nU3gYvg==}
    engines: {node: '>= 0.6'}
    dev: false`

    const lockfile = parsePnpmLockfile(lockfileContent)
    expect(lockfile).toBeTruthy()

    const purls = await extractPurlsFromPnpmLockfile(lockfile!)

    // Should include all packages, both direct and transitive
    expect(purls).toContain('pkg:npm/express@4.18.2')
    expect(purls).toContain('pkg:npm/accepts@1.3.8')
    expect(purls).toContain('pkg:npm/array-flatten@1.1.1')
    expect(purls).toContain('pkg:npm/mime-types@2.1.35')
    expect(purls).toContain('pkg:npm/mime-db@1.52.0')
  })

  it('should handle lockfile with peer dependencies', async () => {
    const lockfileContent = `lockfileVersion: '6.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

dependencies:
  react-dom:
    specifier: ^18.0.0
    version: 18.2.0(react@18.2.0)
  react:
    specifier: ^18.0.0
    version: 18.2.0

packages:

  /react@18.2.0:
    resolution: {integrity: sha512-/3IjMdb2L9QbBdWiW5e3P2/npwMBaU9mHCSCUzNln0ZCYbcfTsGbTJrU/kGemdH2IWmB2ioZ+zkxtmq6g09fGQ==}
    engines: {node: '>=0.10.0'}
    dependencies:
      loose-envify: 1.4.0
    dev: false

  /react-dom@18.2.0(react@18.2.0):
    resolution: {integrity: sha512-6IMTriUmvsjHUjNtEDudZfuDQUoWXVxKHhlEGSk81n4YFS+r/Kl99wXiwlVXtPBtJenozv2P+hxDsw9eA7Xo6g==}
    peerDependencies:
      react: ^18.2.0
    dependencies:
      loose-envify: 1.4.0
      react: 18.2.0
      scheduler: 0.23.0
    dev: false

  /loose-envify@1.4.0:
    resolution: {integrity: sha512-lyuxPGr/Wfhrlem2CL/UcnUc1zcqKAImBDzukY7Y5F/yQiNdko26NfpXKwULFDNYB9LKqcxUWkOiMccJDR0RAw==}
    hasBin: true
    dependencies:
      js-tokens: 4.0.0
    dev: false

  /js-tokens@4.0.0:
    resolution: {integrity: sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN4k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW/PKQ==}
    dev: false

  /scheduler@0.23.0:
    resolution: {integrity: sha512-CtuThmgHNg7zIZWAXi3AsyIzA3n4xx7aNyjwC2VJldO2LMVDhFK+63xGqq6CsJH4rTAt6/M+N4GhZiDYPx9eUw==}
    dependencies:
      loose-envify: 1.4.0
    dev: false`

    const lockfile = parsePnpmLockfile(lockfileContent)
    expect(lockfile).toBeTruthy()

    const purls = await extractPurlsFromPnpmLockfile(lockfile!)

    expect(purls).toContain('pkg:npm/react@18.2.0')
    expect(purls).toContain('pkg:npm/react-dom@18.2.0')
    expect(purls).toContain('pkg:npm/loose-envify@1.4.0')
    expect(purls).toContain('pkg:npm/js-tokens@4.0.0')
    expect(purls).toContain('pkg:npm/scheduler@0.23.0')
  })

  it('should successfully scan lockfile and return alerts map', async () => {
    const lockfile = {
      lockfileVersion: '6.0',
      packages: {
        '/lodash@4.17.21': {
          resolution: { integrity: 'sha512-test' },
          dependencies: {},
          dev: false,
        },
      },
    }

    const alertsMap = await getAlertsMapFromPnpmLockfile(lockfile, {
      nothrow: true,
      filter: { actions: ['error', 'monitor', 'warn'] },
    })

    expect(alertsMap).toBeInstanceOf(Map)
  })

  it('should handle empty lockfile gracefully', async () => {
    const lockfile = {
      lockfileVersion: '6.0',
      packages: {},
    }

    const purls = await extractPurlsFromPnpmLockfile(lockfile)
    expect(purls).toEqual([])

    const alertsMap = await getAlertsMapFromPnpmLockfile(lockfile, {
      nothrow: true,
    })

    expect(alertsMap).toBeInstanceOf(Map)
    expect(alertsMap.size).toBe(0)
  })
})
