/**
 * Unit tests for the (now-exported) private helpers in generate-report.
 *
 * Covers isStricterPolicy strictness ladder:
 * error > warn > monitor > ignore > defer > {unknown}.
 *
 * Related Files:
 * - src/commands/scan/generate-report.mts
 */

import { describe, expect, it } from 'vitest'

import {
  REPORT_LEVEL_DEFER,
  REPORT_LEVEL_ERROR,
  REPORT_LEVEL_IGNORE,
  REPORT_LEVEL_MONITOR,
  REPORT_LEVEL_WARN,
} from '../../../../src/constants/reporting.mts'
import { isStricterPolicy } from '../../../../src/commands/scan/generate-report.mts'

describe('isStricterPolicy', () => {
  it('error is the most strict — never overridden', () => {
    expect(isStricterPolicy(REPORT_LEVEL_ERROR, REPORT_LEVEL_WARN)).toBe(false)
    expect(isStricterPolicy(REPORT_LEVEL_ERROR, REPORT_LEVEL_MONITOR)).toBe(false)
    expect(isStricterPolicy(REPORT_LEVEL_ERROR, REPORT_LEVEL_IGNORE)).toBe(false)
    expect(isStricterPolicy(REPORT_LEVEL_ERROR, REPORT_LEVEL_DEFER)).toBe(false)
  })

  it('error overrides anything below it', () => {
    expect(isStricterPolicy(REPORT_LEVEL_WARN, REPORT_LEVEL_ERROR)).toBe(true)
    expect(isStricterPolicy(REPORT_LEVEL_MONITOR, REPORT_LEVEL_ERROR)).toBe(true)
    expect(isStricterPolicy(REPORT_LEVEL_IGNORE, REPORT_LEVEL_ERROR)).toBe(true)
    expect(isStricterPolicy(REPORT_LEVEL_DEFER, REPORT_LEVEL_ERROR)).toBe(true)
  })

  it('warn is second strictest — overridden only by error', () => {
    expect(isStricterPolicy(REPORT_LEVEL_WARN, REPORT_LEVEL_MONITOR)).toBe(false)
    expect(isStricterPolicy(REPORT_LEVEL_WARN, REPORT_LEVEL_IGNORE)).toBe(false)
    expect(isStricterPolicy(REPORT_LEVEL_WARN, REPORT_LEVEL_DEFER)).toBe(false)
    expect(isStricterPolicy(REPORT_LEVEL_MONITOR, REPORT_LEVEL_WARN)).toBe(true)
    expect(isStricterPolicy(REPORT_LEVEL_IGNORE, REPORT_LEVEL_WARN)).toBe(true)
    expect(isStricterPolicy(REPORT_LEVEL_DEFER, REPORT_LEVEL_WARN)).toBe(true)
  })

  it('monitor is third — overridden by error/warn', () => {
    expect(isStricterPolicy(REPORT_LEVEL_MONITOR, REPORT_LEVEL_IGNORE)).toBe(false)
    expect(isStricterPolicy(REPORT_LEVEL_MONITOR, REPORT_LEVEL_DEFER)).toBe(false)
    expect(isStricterPolicy(REPORT_LEVEL_IGNORE, REPORT_LEVEL_MONITOR)).toBe(true)
    expect(isStricterPolicy(REPORT_LEVEL_DEFER, REPORT_LEVEL_MONITOR)).toBe(true)
  })

  it('ignore overrides only defer', () => {
    expect(isStricterPolicy(REPORT_LEVEL_IGNORE, REPORT_LEVEL_DEFER)).toBe(false)
    expect(isStricterPolicy(REPORT_LEVEL_DEFER, REPORT_LEVEL_IGNORE)).toBe(true)
  })

  it('defer never overrides anything', () => {
    expect(isStricterPolicy(REPORT_LEVEL_DEFER, REPORT_LEVEL_DEFER)).toBe(false)
  })

  it('returns false for entirely unknown levels (final fallthrough)', () => {
    expect(isStricterPolicy('???' as any, '???' as any)).toBe(false)
  })

  it('returns false when is is defer and was is unknown (line 354-355)', () => {
    // is = DEFER but was = unknown level → exits via the L354 if-block.
    expect(isStricterPolicy('???' as any, REPORT_LEVEL_DEFER)).toBe(false)
  })
})
