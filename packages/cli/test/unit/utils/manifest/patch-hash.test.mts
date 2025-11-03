import { describe, expect, it } from 'vitest'

import {
  computeSsri,
  convertToSsri,
  detectHashFormat,
  normalizeToSsri,
  validateGitSha,
  validateHash,
  validateSsri,
} from '../../../../src/utils/manifest/patch-hash.mts'

describe('detectHashFormat', () => {
  it('detects ssri sha256 format', () => {
    expect(detectHashFormat('sha256-abc123')).toBe('ssri')
    expect(
      detectHashFormat('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='),
    ).toBe('ssri')
  })

  it('detects ssri sha512 format', () => {
    expect(detectHashFormat('sha512-xyz789')).toBe('ssri')
    expect(
      detectHashFormat(
        'sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg==',
      ),
    ).toBe('ssri')
  })

  it('detects git-sha256 format (SHA-1 40 chars)', () => {
    expect(
      detectHashFormat('git-sha256-3b18e512dba79e4c8300dd08aeb37f8e728b8dad'),
    ).toBe('git-sha256')
  })

  it('detects git-sha256 format (SHA-256 64 chars)', () => {
    expect(
      detectHashFormat(
        'git-sha256-0bd69098bd9b9cc5934a610ab65da429b525361147faa7b5b922919e9a23143d',
      ),
    ).toBe('git-sha256')
  })

  it('returns unknown for invalid formats', () => {
    expect(detectHashFormat('abc123')).toBe('unknown')
    expect(detectHashFormat('sha256-')).toBe('unknown')
    expect(detectHashFormat('git-sha256-')).toBe('unknown')
    expect(detectHashFormat('git-sha256-invalid')).toBe('unknown')
    expect(detectHashFormat('')).toBe('unknown')
    expect(detectHashFormat(null as any)).toBe('unknown')
    expect(detectHashFormat(undefined as any)).toBe('unknown')
  })
})

describe('validateGitSha', () => {
  it('validates correct git-sha256 hash (empty)', () => {
    // Empty buffer
    const emptyContent = Buffer.from('')
    // Computed with: Buffer + "blob 0\0" prefix + SHA-256
    const emptyGitSha =
      'git-sha256-473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813'
    expect(validateGitSha(emptyContent, emptyGitSha)).toBe(true)
  })

  it('validates git-sha256 with actual content', () => {
    const content = Buffer.from('hello world\n')
    // Computed with: Buffer + "blob 12\0" prefix + SHA-256
    const gitSha =
      'git-sha256-0bd69098bd9b9cc5934a610ab65da429b525361147faa7b5b922919e9a23143d'
    expect(validateGitSha(content, gitSha)).toBe(true)
  })

  it('rejects incorrect git-sha256 hash', () => {
    const content = Buffer.from('test')
    const wrongGitSha =
      'git-sha256-0000000000000000000000000000000000000000000000000000000000000000'
    expect(validateGitSha(content, wrongGitSha)).toBe(false)
  })

  it('rejects malformed git-sha256 format', () => {
    const content = Buffer.from('test')
    expect(validateGitSha(content, 'git-sha256-invalid')).toBe(false)
    expect(validateGitSha(content, 'git-sha256-')).toBe(false)
    expect(validateGitSha(content, 'invalid')).toBe(false)
  })
})

describe('validateSsri', () => {
  it('validates correct sha256 ssri hash', () => {
    // Empty buffer
    const emptyContent = Buffer.from('')
    const emptySsri = 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='
    expect(validateSsri(emptyContent, emptySsri)).toBe(true)
  })

  it('validates sha256 ssri with actual content', () => {
    const content = Buffer.from('hello world\n')
    const ssri = 'sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc='
    expect(validateSsri(content, ssri)).toBe(true)
  })

  it('validates sha512 ssri hash', () => {
    const content = Buffer.from('test')
    const ssri =
      'sha512-7iaw3Ur350mqGo7jwQrpkj9hiYB3Lkc/iBml1JQODbJ6wYX4oOHV+E+IvIh/1nsUNzLDBMxfqa2Ob1f1ACio/w=='
    expect(validateSsri(content, ssri)).toBe(true)
  })

  it('rejects incorrect ssri hash', () => {
    const content = Buffer.from('test')
    const wrongSsri = 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    expect(validateSsri(content, wrongSsri)).toBe(false)
  })

  it('rejects malformed ssri format', () => {
    const content = Buffer.from('test')
    expect(validateSsri(content, 'sha256-')).toBe(false)
    expect(validateSsri(content, 'invalid')).toBe(false)
    expect(validateSsri(content, 'md5-abc')).toBe(false)
  })
})

describe('validateHash', () => {
  it('validates ssri format', () => {
    const content = Buffer.from('hello world\n')
    const ssri = 'sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc='
    expect(validateHash(content, ssri)).toBe(true)
  })

  it('validates git-sha256 format', () => {
    const content = Buffer.from('hello world\n')
    const gitSha =
      'git-sha256-0bd69098bd9b9cc5934a610ab65da429b525361147faa7b5b922919e9a23143d'
    expect(validateHash(content, gitSha)).toBe(true)
  })

  it('rejects unknown formats', () => {
    const content = Buffer.from('test')
    expect(validateHash(content, 'invalid')).toBe(false)
    expect(validateHash(content, '')).toBe(false)
  })
})

describe('computeSsri', () => {
  it('computes sha256 ssri hash', () => {
    const content = Buffer.from('hello world\n')
    const ssri = computeSsri(content)
    expect(ssri).toBe('sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc=')
  })

  it('computes sha512 ssri hash', () => {
    const content = Buffer.from('test')
    const ssri = computeSsri(content, 'sha512')
    expect(ssri).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/)
    expect(ssri.length).toBeGreaterThan(20)
  })

  it('computes empty content hash', () => {
    const emptyContent = Buffer.from('')
    const ssri = computeSsri(emptyContent)
    expect(ssri).toBe('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=')
  })
})

describe('convertToSsri', () => {
  it('converts valid git-sha256 to ssri', () => {
    const content = Buffer.from('hello world\n')
    const gitSha =
      'git-sha256-0bd69098bd9b9cc5934a610ab65da429b525361147faa7b5b922919e9a23143d'

    const ssri = convertToSsri(content, gitSha)
    expect(ssri).toBe('sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc=')

    // Verify the result is valid ssri
    expect(validateSsri(content, ssri)).toBe(true)
  })

  it('converts to sha512 when specified', () => {
    const content = Buffer.from('hello world\n')
    const gitSha =
      'git-sha256-0bd69098bd9b9cc5934a610ab65da429b525361147faa7b5b922919e9a23143d'
    const ssri = convertToSsri(content, gitSha, 'sha512')

    expect(ssri).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/)
    expect(validateSsri(content, ssri)).toBe(true)
  })

  it('throws error when git-sha256 does not match content', () => {
    const content = Buffer.from('test')
    const wrongGitSha =
      'git-sha256-0000000000000000000000000000000000000000000000000000000000000000'

    expect(() => convertToSsri(content, wrongGitSha)).toThrow(
      'Content does not match provided git-sha256 hash',
    )
  })
})

describe('normalizeToSsri', () => {
  it('returns ssri as-is when already in ssri format', () => {
    const content = Buffer.from('hello world\n')
    const ssri = 'sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc='

    const normalized = normalizeToSsri(content, ssri)
    expect(normalized).toBe(ssri)
  })

  it('converts git-sha256 to ssri', () => {
    const content = Buffer.from('hello world\n')
    const gitSha =
      'git-sha256-0bd69098bd9b9cc5934a610ab65da429b525361147faa7b5b922919e9a23143d'

    const normalized = normalizeToSsri(content, gitSha)
    expect(normalized).toBe(
      'sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc=',
    )
  })

  it('throws error for unknown hash format', () => {
    const content = Buffer.from('test')
    expect(() => normalizeToSsri(content, 'invalid')).toThrow(
      'Unknown or unsupported hash format',
    )
  })

  it('throws error when ssri hash does not match content', () => {
    const content = Buffer.from('test')
    const wrongSsri = 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

    expect(() => normalizeToSsri(content, wrongSsri)).toThrow(
      'Content does not match provided ssri hash',
    )
  })

  it('throws error when git-sha256 hash does not match content', () => {
    const content = Buffer.from('test')
    const wrongGitSha =
      'git-sha256-0000000000000000000000000000000000000000000000000000000000000000'

    expect(() => normalizeToSsri(content, wrongGitSha)).toThrow(
      'Content does not match provided git-sha256 hash',
    )
  })
})

describe('hash format compatibility', () => {
  it('demonstrates git SHA vs ssri differences', () => {
    const content = Buffer.from('hello world\n')

    // Git SHA includes "blob <size>\0" prefix
    const gitSha =
      'git-sha256-0bd69098bd9b9cc5934a610ab65da429b525361147faa7b5b922919e9a23143d'

    // ssri is pure content hash
    const ssri = 'sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc='

    // Both should validate the same content
    expect(validateGitSha(content, gitSha)).toBe(true)
    expect(validateSsri(content, ssri)).toBe(true)

    // But they produce different hashes due to git's prefix
    expect(gitSha).not.toContain(ssri.split('-')[1])
  })

  it('converts between formats correctly', () => {
    const content = Buffer.from('hello world\n')
    const gitSha =
      'git-sha256-0bd69098bd9b9cc5934a610ab65da429b525361147faa7b5b922919e9a23143d'

    // Convert git SHA to ssri
    const convertedSsri = convertToSsri(content, gitSha)

    // Compute fresh ssri
    const freshSsri = computeSsri(content)

    // They should match
    expect(convertedSsri).toBe(freshSsri)
  })
})
