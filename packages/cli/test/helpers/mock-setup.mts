/**
 * @fileoverview Mock setup utilities for Socket CLI tests.
 *
 * IMPORTANT: Mock setup helper functions DO NOT WORK with Vitest.
 *
 * Vitest requires vi.mock() to be called at the top level of test files for proper hoisting.
 * When vi.mock() is called from within a function, the mock declarations are not hoisted
 * correctly, resulting in "No export defined on mock" errors.
 *
 * Instead of using helper functions, explicitly declare mocks at the top of each test file.
 *
 * @example Correct pattern for mocking
 * ```typescript
 * import { beforeEach, describe, expect, it, vi } from 'vitest'
 *
 * // Mock declarations MUST be at top level
 * vi.mock('@socketsecurity/lib/logger', () => ({
 *   logger: {
 *     fail: vi.fn(),
 *     log: vi.fn(),
 *   },
 * }))
 *
 * vi.mock('../../utils/socket/api.mjs', () => ({
 *   queryApiSafeJson: vi.fn(),
 * }))
 *
 * describe('myTest', () => {
 *   beforeEach(() => {
 *     vi.clearAllMocks()
 *   })
 *
 *   it('test name', async () => {
 *     // Use dynamic imports for function under test
 *     const { functionUnderTest } = await import('./module-under-test.mts')
 *
 *     // Use vi.importMock for mocked dependencies
 *     const { logger } = await vi.importMock('@socketsecurity/lib/logger')
 *     const { queryApiSafeJson } = await vi.importMock('../../utils/socket/api.mjs')
 *
 *     const mockLog = vi.mocked(logger.log)
 *     const mockQueryApi = vi.mocked(queryApiSafeJson)
 *
 *     // ... test code
 *   })
 * })
 * ```
 *
 * @see https://vitest.dev/api/vi.html#vi-mock
 */

// This file intentionally left empty.
// All previous mock setup helper functions have been removed because they don't work with Vitest.
// See the file-level documentation above for the correct pattern.
