/**
 * Shared Vitest configuration for simple packages.
 * Used by packages with basic test needs (10s timeouts).
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
})
