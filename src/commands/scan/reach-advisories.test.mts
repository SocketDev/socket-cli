import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveReachAdvisories } from './reach-advisories.mts'

const { mockConvertCveToGhsa } = vi.hoisted(() => ({
  mockConvertCveToGhsa: vi.fn(),
}))

vi.mock('../../utils/cve-to-ghsa.mts', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/cve-to-ghsa.mts')>()),
  convertCveToGhsa: mockConvertCveToGhsa,
}))

describe('resolveReachAdvisories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns no advisories for no IDs', async () => {
    expect(await resolveReachAdvisories([])).toEqual([])
    expect(mockConvertCveToGhsa).not.toHaveBeenCalled()
  })

  it('normalizes GHSA IDs without calling the GitHub API', async () => {
    expect(
      await resolveReachAdvisories([
        'GHSA-35jh-r3h4-6jhm',
        ' ghsa-R5FR-RJXR-66JC ',
        'GHSA-35JH-R3H4-6JHM',
      ]),
    ).toEqual(['GHSA-35jh-r3h4-6jhm', 'GHSA-r5fr-rjxr-66jc'])
    expect(mockConvertCveToGhsa).not.toHaveBeenCalled()
  })

  it('converts CVE IDs to GHSA IDs and drops duplicates', async () => {
    mockConvertCveToGhsa.mockResolvedValue({
      ok: true,
      data: 'GHSA-35jh-r3h4-6jhm',
    })
    expect(
      await resolveReachAdvisories(['cve-2021-23337', 'GHSA-35jh-r3h4-6jhm']),
    ).toEqual(['GHSA-35jh-r3h4-6jhm'])
    expect(mockConvertCveToGhsa).toHaveBeenCalledWith('CVE-2021-23337')
  })

  it('rejects IDs that are neither GHSA nor CVE IDs', async () => {
    await expect(
      resolveReachAdvisories(['GHSA-35jh-r3h4-6jhm', 'pkg:npm/lodash']),
    ).rejects.toThrow('Invalid --reach-advisories IDs: PKG:NPM/LODASH.')
    expect(mockConvertCveToGhsa).not.toHaveBeenCalled()
  })

  it('fails when a CVE ID has no GHSA', async () => {
    mockConvertCveToGhsa.mockResolvedValue({
      ok: false,
      message: 'No GHSA found for CVE CVE-2099-0001',
    })
    await expect(resolveReachAdvisories(['CVE-2099-0001'])).rejects.toThrow(
      'CVE-2099-0001: No GHSA found for CVE CVE-2099-0001',
    )
  })
})
