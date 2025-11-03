import { beforeEach, describe, expect, it, vi } from 'vitest'

import { convertIdsToGhsas } from '../../../../src/src/commands/fix/handle-fix.mts'

// Mock the dependencies.
const mockJoinAnd = vi.hoisted(() => vi.fn(arr => arr.join(' and '))
const mockCoanaFix = vi.hoisted(() => vi.fn())
const mockOutputFixResult = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/arrays', () => ({
  joinAnd: mockJoinAnd),
}))

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const mockConvertCveToGhsa = vi.hoisted(() => vi.fn())
const mockConvertPurlToGhsas = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))
vi.mock('../../../../src/commands/fix/coana-fix.mts', () => ({
  coanaFix: mockCoanaFix,
}))
vi.mock('../../../../src/commands/fix/output-fix-result.mts', () => ({
  outputFixResult: mockOutputFixResult,
}))
vi.mock('../../../../src/utils/cve-to-ghsa.mts', () => ({
  convertCveToGhsa: mockConvertCveToGhsa,
}))
vi.mock('../../../../src/utils/purl/to-ghsa.mts', () => ({
  convertPurlToGhsas: mockConvertPurlToGhsas,
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
    mockConvertCveToGhsa.mockResolvedValueOnce({
      ok: true,
      data: 'GHSA-1234-5678-9abc',
    })
    mockConvertCveToGhsa.mockResolvedValueOnce({
      ok: true,
      data: 'GHSA-abcd-efgh-ijkl',
    })

    const result = await convertIdsToGhsas(['CVE-2021-12345', 'CVE-2022-98765'])

    expect(mockConvertCveToGhsa).toHaveBeenCalledWith('CVE-2021-12345')
    expect(mockConvertCveToGhsa).toHaveBeenCalledWith('CVE-2022-98765')
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Converted CVE-2021-12345 to GHSA-1234-5678-9abc',
    )
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Converted CVE-2022-98765 to GHSA-abcd-efgh-ijkl',
    )
    expect(result).toEqual(['GHSA-1234-5678-9abc', 'GHSA-abcd-efgh-ijkl'])
  })

  it('converts PURL IDs to GHSA IDs', async () => {
    mockConvertPurlToGhsas.mockResolvedValue({
      ok: true,
      data: ['GHSA-test-purl-ghsa'],
    })

    const result = await convertIdsToGhsas(['pkg:npm/package@1.0.0'])

    expect(mockConvertPurlToGhsas).toHaveBeenCalledWith('pkg:npm/package@1.0.0')
    expect(result).toEqual(['GHSA-test-purl-ghsa'])
  })

  it('handles invalid GHSA format', async () => {
    const result = await convertIdsToGhsas([
      'GHSA-invalid',
      'GHSA-1234-5678-9abc',
    ])

    expect(result).toEqual(['GHSA-1234-5678-9abc'])
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /Skipped 1 invalid IDs.*Invalid GHSA format: GHSA-invalid/s,
      ),
    )
  })

  it('handles invalid CVE format', async () => {
    mockConvertCveToGhsa.mockResolvedValue({
      ok: true,
      data: 'GHSA-1234-5678-9abc',
    })

    const result = await convertIdsToGhsas(['CVE-invalid', 'CVE-2021-12345'])

    expect(result).toEqual(['GHSA-1234-5678-9abc'])
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /Skipped 1 invalid IDs.*Invalid CVE format: CVE-invalid/s,
      ),
    )
  })

  it('handles CVE conversion failure', async () => {
    mockConvertCveToGhsa.mockResolvedValue({
      ok: false,
      message: 'No GHSA found for CVE CVE-2021-99999',
      error: new Error('CVE not found'),
    })

    const result = await convertIdsToGhsas(['CVE-2021-99999'])

    expect(result).toEqual([])
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipped 1 invalid IDs:'),
    )
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'CVE-2021-99999: No GHSA found for CVE CVE-2021-99999',
      ),
    )
  })

  it('handles PURL conversion failure', async () => {
    mockConvertPurlToGhsas.mockResolvedValue({
      ok: false,
      message: 'Package not found',
      error: new Error('Package not found'),
    })

    const result = await convertIdsToGhsas(['pkg:npm/nonexistent@1.0.0'])

    expect(result).toEqual([])
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /Skipped 1 invalid IDs.*pkg:npm\/nonexistent@1\.0\.0.*Package not found/s,
      ),
    )
  })

  it('handles empty PURL conversion result', async () => {
    mockConvertPurlToGhsas.mockResolvedValue({
      ok: true,
      data: [],
    })

    const result = await convertIdsToGhsas(['pkg:npm/safe-package@1.0.0'])

    expect(result).toEqual([])
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /Skipped 1 invalid IDs.*pkg:npm\/safe-package@1\.0\.0.*No GHSAs found/s,
      ),
    )
  })

  it('handles mixed ID types', async () => {
    mockConvertCveToGhsa.mockResolvedValue({
      ok: true,
      data: 'GHSA-from-cve-test',
    })
    mockConvertPurlToGhsas.mockResolvedValue({
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
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Converted CVE-2021-12345 to GHSA-from-cve-test',
    )
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Converted pkg:npm/package@1.0.0 to 1 GHSA(s)'),
    )
  })

  it('trims whitespace from IDs', async () => {
    const result = await convertIdsToGhsas([
      '  GHSA-1234-5678-9abc  ',
      '\tGHSA-abcd-efgh-ijkl\n',
    ])

    expect(result).toEqual(['GHSA-1234-5678-9abc', 'GHSA-abcd-efgh-ijkl'])
  })
})
