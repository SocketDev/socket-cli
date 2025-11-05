/** @fileoverview Tests for file-upload error handling and edge cases. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createRequestBodyForFilepaths } from '../src/file-upload'

describe('createRequestBodyForFilepaths', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'socket-sdk-file-upload-test-'))
  })

  afterEach(async () => {
    // Allow time for any async operations to complete
    await new Promise(resolve => setTimeout(resolve, 10))
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('should create request body for valid file', () => {
    const testFile = path.join(tempDir, 'test.txt')
    writeFileSync(testFile, 'test content')

    const result = createRequestBodyForFilepaths([testFile], tempDir)

    expect(result).toHaveLength(1)
    const part = result[0]!
    expect(part).toHaveLength(3)
    const header1 = part[0] as string
    const header2 = part[1] as string
    expect(header1).toContain('Content-Disposition: form-data')
    expect(header1).toContain('name="test.txt"')
    expect(header1).toContain('filename="test.txt"')
    expect(header2).toBe('Content-Type: application/octet-stream\r\n\r\n')

    // Clean up stream
    const stream = part[2] as any
    if (stream && typeof stream.destroy === 'function') {
      stream.destroy()
    }
  })

  it('should create request body for multiple files', () => {
    const file1 = path.join(tempDir, 'file1.txt')
    const file2 = path.join(tempDir, 'file2.txt')
    writeFileSync(file1, 'content 1')
    writeFileSync(file2, 'content 2')

    const result = createRequestBodyForFilepaths([file1, file2], tempDir)

    expect(result).toHaveLength(2)
    const header1 = result[0]![0] as string
    const header2 = result[1]![0] as string
    expect(header1).toContain('name="file1.txt"')
    expect(header2).toContain('name="file2.txt"')

    // Clean up streams
    for (const part of result) {
      const stream = part[2] as any
      if (stream && typeof stream.destroy === 'function') {
        stream.destroy()
      }
    }
  })

  it('should handle nested file paths correctly', () => {
    const nestedDir = path.join(tempDir, 'nested', 'deep')
    mkdirSync(nestedDir, { recursive: true })
    const nestedFile = path.join(nestedDir, 'nested-file.txt')
    writeFileSync(nestedFile, 'nested content')

    const result = createRequestBodyForFilepaths([nestedFile], tempDir)

    expect(result).toHaveLength(1)
    const header = result[0]![0] as string
    expect(header).toContain('name="nested/deep/nested-file.txt"')
    expect(header).toContain('filename="nested-file.txt"')

    // Clean up stream
    const stream = result[0]![2] as any
    if (stream && typeof stream.destroy === 'function') {
      stream.destroy()
    }
  })
})
