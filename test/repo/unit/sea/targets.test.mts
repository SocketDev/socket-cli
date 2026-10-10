import { describe, expect, it } from 'vitest'
import { resolveSeaTarget } from '../../../../scripts/repo/cli-build/sea/targets.mts'

describe('SEA targets', () => {
  it.each([
    ['darwin', 'arm64', undefined, 'darwin-arm64'],
    ['win32', 'x64', undefined, 'win32-x64'],
    ['linux', 'x64', '2.39', 'linux-x64'],
    ['linux', 'arm64', undefined, 'linux-arm64-musl'],
  ])('selects %s %s', (platform, arch, glibc, expected) => {
    expect(resolveSeaTarget(platform, arch, { glibc })).toBe(expected)
  })
  it('rejects unsupported architectures', () => {
    expect(() => resolveSeaTarget('linux', 'riscv64')).toThrow()
  })
})
