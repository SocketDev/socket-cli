import { beforeEach, describe, expect, it, vi } from 'vitest'

import { convertIdsToGhsas, handleFix } from './handle-fix.mts'

// Mock the dependencies.
vi.mock('@socketsecurity/registry/lib/arrays', () => ({
  joinAnd: vi.fn(arr => arr.join(' and ')),
}))
vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
}))
vi.mock('./coana-fix.mts', () => ({
  coanaFix: vi.fn(),
}))
vi.mock('./output-fix-result.mts', () => ({
  outputFixResult: vi.fn(),
}))
vi.mock('../../utils/cve-to-ghsa.mts', () => ({
  convertCveToGhsa: vi.fn(),
}))
vi.mock('../../utils/purl-to-ghsa.mts', () => ({
  convertPurlToGhsas: vi.fn(),
}))

describe('convertIdsToGhsas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves valid GHSA IDs', async () => {
    const ghsas = ['GHSA-1234-5678-9abc', 'GHSA-abcd-efgh-ijkl']
    const result = await convertIdsToGhsas(ghsas)

    expect(result).toEqual(ghsas)
  })

  it('converts CVE IDs to GHSA IDs', async () => {
    const { convertCveToGhsa } = await import('../../utils/cve-to-ghsa.mts')

    vi.mocked(convertCveToGhsa).mockResolvedValueOnce({
      ok: true,
      data: 'GHSA-1234-5678-9abc',
    })
    vi.mocked(convertCveToGhsa).mockResolvedValueOnce({
      ok: true,
      data: 'GHSA-abcd-efgh-ijkl',
    })

    const result = await convertIdsToGhsas(['CVE-2021-12345', 'CVE-2022-98765'])

    expect(convertCveToGhsa).toHaveBeenCalledWith('CVE-2021-12345')
    expect(convertCveToGhsa).toHaveBeenCalledWith('CVE-2022-98765')
    expect(result).toEqual(['GHSA-1234-5678-9abc', 'GHSA-abcd-efgh-ijkl'])
  })

  it('converts PURL IDs to GHSA IDs', async () => {
    const { convertPurlToGhsas } = await import('../../utils/purl-to-ghsa.mts')

    vi.mocked(convertPurlToGhsas).mockResolvedValue({
      ok: true,
      data: ['GHSA-test-purl-ghsa'],
    })

    const result = await convertIdsToGhsas(['pkg:npm/package@1.0.0'])

    expect(convertPurlToGhsas).toHaveBeenCalledWith('pkg:npm/package@1.0.0')
    expect(result).toEqual(['GHSA-test-purl-ghsa'])
  })

  it('handles invalid GHSA format', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')

    const result = await convertIdsToGhsas([
      'GHSA-invalid',
      'GHSA-1234-5678-9abc',
    ])

    expect(result).toEqual(['GHSA-1234-5678-9abc'])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipped 1 invalid IDs'),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid GHSA format: GHSA-invalid'),
    )
  })

  it('handles invalid CVE format', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const { convertCveToGhsa } = await import('../../utils/cve-to-ghsa.mts')

    vi.mocked(convertCveToGhsa).mockResolvedValue({
      ok: true,
      data: 'GHSA-1234-5678-9abc',
    })

    const result = await convertIdsToGhsas(['CVE-invalid', 'CVE-2021-12345'])

    expect(result).toEqual(['GHSA-1234-5678-9abc'])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipped 1 invalid IDs'),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid CVE format: CVE-invalid'),
    )
  })

  it('handles CVE conversion failure', async () => {
    const { convertCveToGhsa } = await import('../../utils/cve-to-ghsa.mts')
    const { logger } = await import('@socketsecurity/registry/lib/logger')

    vi.mocked(convertCveToGhsa).mockResolvedValue({
      ok: false,
      message: 'CVE not found',
      error: new Error('CVE not found'),
    })

    const result = await convertIdsToGhsas(['CVE-2021-99999'])

    expect(result).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipped 1 invalid IDs'),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('CVE-2021-99999: CVE not found'),
    )
  })

  it('handles PURL conversion failure', async () => {
    const { convertPurlToGhsas } = await import('../../utils/purl-to-ghsa.mts')
    const { logger } = await import('@socketsecurity/registry/lib/logger')

    vi.mocked(convertPurlToGhsas).mockResolvedValue({
      ok: false,
      message: 'Package not found',
      error: new Error('Package not found'),
    })

    const result = await convertIdsToGhsas(['pkg:npm/nonexistent@1.0.0'])

    expect(result).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipped 1 invalid IDs'),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('pkg:npm/nonexistent@1.0.0: Package not found'),
    )
  })

  it('handles empty PURL conversion result', async () => {
    const { convertPurlToGhsas } = await import('../../utils/purl-to-ghsa.mts')
    const { logger } = await import('@socketsecurity/registry/lib/logger')

    vi.mocked(convertPurlToGhsas).mockResolvedValue({
      ok: true,
      data: [],
    })

    const result = await convertIdsToGhsas(['pkg:npm/safe-package@1.0.0'])

    expect(result).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipped 1 invalid IDs'),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('pkg:npm/safe-package@1.0.0: No GHSAs found'),
    )
  })

  it('handles mixed ID types', async () => {
    const { convertCveToGhsa } = await import('../../utils/cve-to-ghsa.mts')
    const { convertPurlToGhsas } = await import('../../utils/purl-to-ghsa.mts')

    vi.mocked(convertCveToGhsa).mockResolvedValue({
      ok: true,
      data: 'GHSA-from-cve-test',
    })
    vi.mocked(convertPurlToGhsas).mockResolvedValue({
      ok: true,
      data: ['GHSA-from-purl-test'],
    })

    const result = await convertIdsToGhsas([
      'GHSA-1234-5678-9abc',
      'CVE-2021-12345',
      'pkg:npm/package@1.0.0',
    ])

    expect(result).toEqual([
      'GHSA-1234-5678-9abc',
      'GHSA-from-cve-test',
      'GHSA-from-purl-test',
    ])
  })

  it('trims whitespace from IDs', async () => {
    const result = await convertIdsToGhsas([
      '  GHSA-1234-5678-9abc  ',
      '\tGHSA-abcd-efgh-ijkl\n',
    ])

    expect(result).toEqual(['GHSA-1234-5678-9abc', 'GHSA-abcd-efgh-ijkl'])
  })
})
