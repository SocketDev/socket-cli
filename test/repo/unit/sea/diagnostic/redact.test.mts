import { describe, expect, it } from 'vitest'
import { redactDiagnosticText } from '../../../../../scripts/repo/build/sea/diagnostic/redact.mts'

describe('diagnostic redaction', () => {
  it.each([
    ['TOKEN=value', 'TOKEN=[redacted]'],
    ['sk-proj-SYNTHETIC000000', '[redacted]'],
    ['ghp_SYNTHETIC00000000', '[redacted]'],
    ['npm_SYNTHETIC00000000', '[redacted]'],
    ['sktsec_SYNTHETIC00000000', '[redacted]'],
    [
      'Authorization: Bearer abcdefgh12345678',
      'Authorization: Bearer [redacted]',
    ],
    [
      'https://user:password@example.test/path',
      'https://[redacted]@example.test/path',
    ],
    [
      'https://example.test/?api_key=secret-value',
      'https://example.test/?api_key=[redacted]',
    ],
    [
      'https://example.test/%3Fapi_key%3Dsecret-value%26page%3D2',
      'https://example.test/%3Fapi_key%3D[redacted]%26page%3D2',
    ],
  ])('redacts %s', (input, expected) => {
    expect(redactDiagnosticText(input)).toBe(expected)
  })

  it('keeps plain diagnostic text', () => {
    expect(redactDiagnosticText('frame #0: native crash')).toBe(
      'frame #0: native crash',
    )
  })

  it('is idempotent', () => {
    const once = redactDiagnosticText('TOKEN=value')
    expect(redactDiagnosticText(once)).toBe(once)
  })
})
