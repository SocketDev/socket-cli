/**
 * Vitest setup file.
 * Mocks Ink and related modules to avoid top-level await issues in tests.
 */

import { vi } from 'vitest'

// Mock ink to avoid top-level await in reconciler
vi.mock('ink', () => ({
  render: vi.fn(() => ({
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
    unmount: vi.fn(),
    clear: vi.fn(),
  })),
  Box: vi.fn(() => null),
  Text: vi.fn(() => null),
}))

// Mock ink-table to avoid importing ink
vi.mock('ink-table', () => ({
  default: vi.fn(() => null),
}))
