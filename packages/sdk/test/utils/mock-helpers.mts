/** @fileoverview Mock utilities for test setup. */
import { Readable } from 'node:stream'

import { vi } from 'vitest'

// Mock fs.createReadStream to prevent test-package.json from being created.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    createReadStream: vi.fn((path: string) => {
      // Return a mock readable stream for test-package.json.
      if (path.includes('test-package.json')) {
        const stream = new Readable()
        stream.push('{"name": "test-package", "version": "1.0.0"}')
        stream.push(null)
        return stream
      }
      // For other files, use the actual createReadStream.
      return actual.createReadStream(path)
    }),
  }
})
