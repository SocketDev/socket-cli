import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { verifySeaAsset } from '../../../../scripts/repo/cli-build/sea/assets.mts'

describe('SEA assets', () => {
  it('verifies download bytes before execution', () => {
    const bytes = Buffer.from('example executable')
    const digest = createHash('sha256').update(bytes).digest('hex')
    expect(verifySeaAsset(bytes, digest)).toBe(true)
    expect(verifySeaAsset(Buffer.from('modified executable'), digest)).toBe(
      false,
    )
  })
})
