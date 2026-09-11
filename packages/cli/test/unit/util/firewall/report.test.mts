import { describe, expect, it } from 'vitest'
import { createFirewallReport } from '../../../../src/util/firewall/report.mts'

describe('firewall report collection', () => {
  it('deduplicates requests and preserves a blocking decision', () => {
    const report = createFirewallReport()
    const purl = 'pkg:npm/example-package@1.0.0'
    report.record(purl, { blocked: false })
    report.record(purl, { blocked: true, reasons: ['error: malware'] })
    report.record(purl, { blocked: false })
    expect(report.snapshot()).toEqual({
      packages: [
        { purl, decision: { blocked: true, reasons: ['error: malware'] } },
      ],
      truncated: false,
    })
  })
  it('bounds package count while still updating an existing decision', () => {
    const report = createFirewallReport()
    for (let index = 0; index < 10_001; index += 1) {
      report.record(`pkg:npm/example-package-${index}@1.0.0`, {
        blocked: false,
      })
    }
    report.record('pkg:npm/example-package-0@1.0.0', { blocked: true })
    const snapshot = report.snapshot()
    expect(snapshot.packages).toHaveLength(10_000)
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.packages[0]?.decision.blocked).toBe(true)
  })
  it('bounds provider-supplied reason strings and reports truncation', () => {
    const report = createFirewallReport()
    report.record('pkg:npm/example-package@1.0.0', {
      blocked: true,
      reasons: Array.from({ length: 33 }, () => 'example reason'.repeat(100)),
    })
    const snapshot = report.snapshot()
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.packages[0]?.decision.reasons).toHaveLength(32)
    expect(
      snapshot.packages[0]?.decision.reasons?.every(
        reason => reason.length === 512,
      ),
    ).toBe(true)
  })
})
