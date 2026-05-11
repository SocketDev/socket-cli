/**
 * Unit tests for the SDK API wrapper.
 *
 * Verifies the generic apiCall helper (SDK setup failure / success) and
 * each of the convenience namespaces (repoApi, orgApi, packageApi,
 * scanApi). All SDK methods are mocked.
 *
 * Related Files:
 * - src/utils/socket/api-wrapper.mts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHandleApiCall = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, data: 'response' }),
)
const mockSetupSdk = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/socket/api.mts', () => ({
  handleApiCall: mockHandleApiCall,
}))
vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  setupSdk: mockSetupSdk,
}))

import {
  apiCall,
  orgApi,
  packageApi,
  repoApi,
  scanApi,
} from '../../../../src/utils/socket/api-wrapper.mts'

const mkSdk = () => {
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    listRepositories: vi.fn().mockResolvedValue('list-repos'),
    createRepository: vi.fn().mockResolvedValue('create-repo'),
    deleteRepository: vi.fn().mockResolvedValue('delete-repo'),
    updateRepository: vi.fn().mockResolvedValue('update-repo'),
    getRepository: vi.fn().mockResolvedValue('get-repo'),
    listOrganizations: vi.fn().mockResolvedValue('list-orgs'),
    searchDependencies: vi.fn().mockResolvedValue('search-deps'),
    getQuota: vi.fn().mockResolvedValue('quota'),
    getOrgSecurityPolicy: vi.fn().mockResolvedValue('sec-policy'),
    getOrgLicensePolicy: vi.fn().mockResolvedValue('lic-policy'),
    getScoreByNpmPackage: vi.fn().mockResolvedValue('score'),
    getIssuesByNpmPackage: vi.fn().mockResolvedValue('issues'),
    createFullScan: vi.fn().mockResolvedValue('create-scan'),
    listFullScans: vi.fn().mockResolvedValue('list-scans'),
    deleteFullScan: vi.fn().mockResolvedValue('delete-scan'),
    getFullScan: vi.fn().mockResolvedValue('get-scan'),
  }
  return fns
}

describe('apiCall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSetupSdk.mockResolvedValue({ ok: true, data: mkSdk() })
  })

  it('returns the SDK setup error when setupSdk fails', async () => {
    mockSetupSdk.mockResolvedValueOnce({ ok: false, message: 'no token' })

    const result = await apiCall(
      'listRepositories' as any,
      ['org', {}] as any,
      'list of repositories',
    )

    expect(result.ok).toBe(false)
    expect(mockHandleApiCall).not.toHaveBeenCalled()
  })

  it('forwards the SDK call through handleApiCall', async () => {
    await apiCall(
      'listRepositories' as any,
      ['org-slug', { page: 1 }] as any,
      'list of repositories',
    )

    expect(mockHandleApiCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ description: 'list of repositories' }),
    )
  })

  it('threads sdkOpts through to setupSdk', async () => {
    await apiCall('listRepositories' as any, ['org', {}] as any, 'desc', {
      sdkOpts: { apiBaseUrl: 'https://api.example.com' },
    } as any)

    expect(mockSetupSdk).toHaveBeenCalledWith({
      apiBaseUrl: 'https://api.example.com',
    })
  })
})

describe('repoApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSetupSdk.mockResolvedValue({ ok: true, data: mkSdk() })
  })

  it.each([
    ['list', 'list of repositories'],
    ['create', 'to create a repository'],
    ['view', 'repository'],
  ] as const)('%s sets the description correctly', async (op, desc) => {
    if (op === 'create' || op === 'list') {
      await repoApi[op]('org', {})
    } else {
      await repoApi[op]('org', 'repo')
    }
    expect(mockHandleApiCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ description: desc }),
    )
  })

  it('delete + update set their descriptions', async () => {
    await repoApi.delete('org', 'repo')
    expect(mockHandleApiCall).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ description: 'to delete a repository' }),
    )

    await repoApi.update('org', 'repo', {})
    expect(mockHandleApiCall).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ description: 'to update a repository' }),
    )
  })
})

describe('orgApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSetupSdk.mockResolvedValue({ ok: true, data: mkSdk() })
  })

  it.each([
    ['list', 'list of organizations'],
    ['quota', 'organization quota'],
    ['securityPolicy', 'security policy'],
    ['licensePolicy', 'license policy'],
  ] as const)('%s sets the description correctly', async (op, desc) => {
    if (op === 'list') {
      await orgApi[op]()
    } else {
      await (orgApi as any)[op]('org')
    }
    expect(mockHandleApiCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ description: desc }),
    )
  })

  it('dependencies sets the description', async () => {
    await orgApi.dependencies('org', { foo: 'bar' })
    expect(mockHandleApiCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ description: 'dependencies' }),
    )
  })
})

describe('packageApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSetupSdk.mockResolvedValue({ ok: true, data: mkSdk() })
  })

  it('score returns the SDK response', async () => {
    await packageApi.score('npm', 'lodash', '4.17.21')
    expect(mockHandleApiCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ description: 'package score' }),
    )
  })

  it('issues returns the SDK response', async () => {
    await packageApi.issues('npm', 'lodash', '4.17.21')
    expect(mockHandleApiCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ description: 'package issues' }),
    )
  })
})

describe('scanApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSetupSdk.mockResolvedValue({ ok: true, data: mkSdk() })
  })

  it.each([
    ['list', 'list of scans'],
    ['create', 'to create a scan'],
  ] as const)('%s sets the description', async (op, desc) => {
    await scanApi[op]('org', {})
    expect(mockHandleApiCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ description: desc }),
    )
  })

  it('delete + view set their descriptions', async () => {
    await scanApi.delete('org', 'scan-id')
    expect(mockHandleApiCall).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ description: 'to delete a scan' }),
    )

    await scanApi.view('org', 'scan-id')
    expect(mockHandleApiCall).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ description: 'scan details' }),
    )
  })
})
