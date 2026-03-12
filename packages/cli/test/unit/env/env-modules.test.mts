/**
 * Unit tests for environment variable modules.
 *
 * Purpose:
 * Tests the environment variable getter functions.
 *
 * Test Coverage:
 * - getCliVersion function
 * - getCoanaVersion function
 * - isPublishedBuild function
 * - CI constant
 * - VITEST constant
 * - HOME constant
 * - TEMP constant
 * - TERM constant
 *
 * Related Files:
 * - env/*.mts (implementations)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Test getCliVersion.
describe('env/cli-version', () => {
  let originalValue: string | undefined

  beforeEach(() => {
    originalValue = process.env['INLINED_SOCKET_CLI_VERSION']
  })

  afterEach(() => {
    if (originalValue !== undefined) {
      process.env['INLINED_SOCKET_CLI_VERSION'] = originalValue
    } else {
      delete process.env['INLINED_SOCKET_CLI_VERSION']
    }
  })

  it('returns version when env var is set', async () => {
    process.env['INLINED_SOCKET_CLI_VERSION'] = '1.2.3'
    const { getCliVersion } = await import('../../../src/env/cli-version.mts')
    expect(getCliVersion()).toBe('1.2.3')
  })
})

// Test getCoanaVersion.
describe('env/coana-version', () => {
  let originalValue: string | undefined

  beforeEach(() => {
    originalValue = process.env['INLINED_SOCKET_CLI_COANA_VERSION']
  })

  afterEach(() => {
    if (originalValue !== undefined) {
      process.env['INLINED_SOCKET_CLI_COANA_VERSION'] = originalValue
    } else {
      delete process.env['INLINED_SOCKET_CLI_COANA_VERSION']
    }
  })

  it('returns version when env var is set', async () => {
    process.env['INLINED_SOCKET_CLI_COANA_VERSION'] = '0.5.0'
    const { getCoanaVersion } = await import(
      '../../../src/env/coana-version.mts'
    )
    expect(getCoanaVersion()).toBe('0.5.0')
  })

  it('throws error when env var is not set', async () => {
    delete process.env['INLINED_SOCKET_CLI_COANA_VERSION']
    const { getCoanaVersion } = await import(
      '../../../src/env/coana-version.mts'
    )
    expect(() => getCoanaVersion()).toThrow('INLINED_SOCKET_CLI_COANA_VERSION')
  })
})

// Test isPublishedBuild.
describe('env/is-published-build', () => {
  let originalValue: string | undefined

  beforeEach(() => {
    originalValue = process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD']
  })

  afterEach(() => {
    if (originalValue !== undefined) {
      process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD'] = originalValue
    } else {
      delete process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD']
    }
  })

  it('returns true when env var is "true"', async () => {
    process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD'] = 'true'
    const { isPublishedBuild } = await import(
      '../../../src/env/is-published-build.mts'
    )
    expect(isPublishedBuild()).toBe(true)
  })

  it('returns true when env var is "1"', async () => {
    process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD'] = '1'
    const { isPublishedBuild } = await import(
      '../../../src/env/is-published-build.mts'
    )
    expect(isPublishedBuild()).toBe(true)
  })

  it('returns false when env var is "false"', async () => {
    process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD'] = 'false'
    const { isPublishedBuild } = await import(
      '../../../src/env/is-published-build.mts'
    )
    expect(isPublishedBuild()).toBe(false)
  })

  it('returns false when env var is not set', async () => {
    delete process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD']
    const { isPublishedBuild } = await import(
      '../../../src/env/is-published-build.mts'
    )
    expect(isPublishedBuild()).toBe(false)
  })
})

// Test CI constant.
describe('env/ci', () => {
  it('exports CI constant', async () => {
    const { CI } = await import('../../../src/env/ci.mts')
    expect(typeof CI).toBe('boolean')
  })
})

// Test VITEST constant.
describe('env/vitest', () => {
  it('exports VITEST constant as true in test environment', async () => {
    const { VITEST } = await import('../../../src/env/vitest.mts')
    // Should be true since we're running in Vitest.
    expect(VITEST).toBe(true)
  })
})

// Test HOME constant.
describe('env/home', () => {
  it('exports HOME constant', async () => {
    const { HOME } = await import('../../../src/env/home.mts')
    // HOME should be defined on most systems.
    expect(typeof HOME).toBe('string')
  })
})

// Test TEMP constant.
describe('env/temp', () => {
  it('exports TEMP constant', async () => {
    const { TEMP } = await import('../../../src/env/temp.mts')
    // TEMP is typically defined on Windows, may be undefined on Unix.
    expect(TEMP === undefined || typeof TEMP === 'string').toBe(true)
  })
})

// Test TERM constant.
describe('env/term', () => {
  it('exports TERM constant', async () => {
    const { TERM } = await import('../../../src/env/term.mts')
    // TERM is typically defined on Unix systems.
    expect(TERM === undefined || typeof TERM === 'string').toBe(true)
  })
})
