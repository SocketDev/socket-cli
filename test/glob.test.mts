import { describe, expect, it } from 'vitest'

import {
  filterBySupportedScanFiles,
  isReportSupportedFile,
} from '../src/utils/glob.mts'

import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

describe('glob', () => {
  const mockSupportedFiles: SocketSdkSuccessResult<'getReportSupportedFiles'>['data'] =
    {
      npm: {
        'package.json': { pattern: 'package.json' },
        'poetry.lock': { pattern: 'poetry.lock' },
      },
    }

  describe('filterBySupportedScanFiles', () => {
    it('should match files in dot directories', () => {
      const filepaths = [
        '.mcp-servers/neo4j/poetry.lock',
        '.hidden/package.json',
        'regular/poetry.lock',
        'node_modules/package.json',
      ]

      const result = filterBySupportedScanFiles(filepaths, mockSupportedFiles)

      expect(result).toEqual([
        '.mcp-servers/neo4j/poetry.lock',
        '.hidden/package.json',
        'regular/poetry.lock',
        'node_modules/package.json',
      ])
    })

    it('should filter out non-matching files', () => {
      const filepaths = [
        '.mcp-servers/neo4j/poetry.lock',
        '.hidden/random.txt',
        'package.json',
        'src/index.ts',
      ]

      const result = filterBySupportedScanFiles(filepaths, mockSupportedFiles)

      expect(result).toEqual(['.mcp-servers/neo4j/poetry.lock', 'package.json'])
    })
  })

  describe('isReportSupportedFile', () => {
    it('should return true for files in dot directories', () => {
      expect(
        isReportSupportedFile(
          '.mcp-servers/neo4j/poetry.lock',
          mockSupportedFiles,
        ),
      ).toBe(true)
      expect(
        isReportSupportedFile('.hidden/package.json', mockSupportedFiles),
      ).toBe(true)
    })

    it('should return true for regular files', () => {
      expect(
        isReportSupportedFile('regular/poetry.lock', mockSupportedFiles),
      ).toBe(true)
      expect(isReportSupportedFile('package.json', mockSupportedFiles)).toBe(
        true,
      )
    })

    it('should return false for non-matching files', () => {
      expect(
        isReportSupportedFile('.hidden/random.txt', mockSupportedFiles),
      ).toBe(false)
      expect(isReportSupportedFile('src/index.ts', mockSupportedFiles)).toBe(
        false,
      )
    })
  })
})
