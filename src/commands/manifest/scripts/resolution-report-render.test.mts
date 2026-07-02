import { describe, expect, it } from 'vitest'

import { renderResolutionErrorReport } from './resolution-report-render.mts'

import type { ResolutionFailure } from './resolution-report.mts'

const f = (
  coord: string,
  detail: string,
  config = 'runtimeClasspath',
): ResolutionFailure => ({
  coord,
  detail,
  config,
})

describe('resolution failure classification', () => {
  it('classifies a Gradle registry miss as blocking not-found', () => {
    const r = renderResolutionErrorReport(
      [f('com.example:missing:1.0', 'Could not find com.example:missing:1.0.')],
      ['runtimeClasspath'],
      'gradle',
    )
    expect(r.hasBlockingFailures).toBe(true)
    expect(r.summary).toContain('Not found in any repository')
    expect(r.nonBlockingNotice).toBe('')
  })

  it('treats Gradle variant ambiguity as non-blocking (notice only, no summary)', () => {
    const r = renderResolutionErrorReport(
      [
        f(
          'com.example:amb:1.0',
          'Cannot choose between the following variants of com.example:amb:1.0',
        ),
      ],
      ['runtimeClasspath'],
      'gradle',
    )
    expect(r.hasBlockingFailures).toBe(false)
    expect(r.summary).toBe('')
    expect(r.nonBlockingNotice).toContain('ambiguous variant')
  })

  it("classifies Gradle's 'unable to find a matching variant' phrasing as blocking no-matching-variant", () => {
    const r = renderResolutionErrorReport(
      [
        f(
          'com.example:lib:1.0',
          "Unable to find a matching variant of com.example:lib:1.0:\n  - Variant 'apiElements'",
        ),
      ],
      ['runtimeClasspath'],
      'gradle',
    )
    expect(r.hasBlockingFailures).toBe(true)
    expect(r.summary).toContain('No compatible variant')
    expect(r.nonBlockingNotice).toBe('')
  })

  it('classifies a Gradle capability conflict as blocking', () => {
    const r = renderResolutionErrorReport(
      [
        f(
          'com.google.collections:google-collections:1.0',
          'Conflict on capability com.google.collections:google-collections',
        ),
      ],
      ['runtimeClasspath'],
      'gradle',
    )
    expect(r.hasBlockingFailures).toBe(true)
    expect(r.summary).toContain('Capability conflict')
  })

  it('surfaces both a blocking failure and a non-blocking notice together', () => {
    const r = renderResolutionErrorReport(
      [
        f('com.example:missing:1.0', 'Could not find com.example:missing:1.0.'),
        f(
          'com.example:amb:1.0',
          'Cannot choose between the following variants',
          'testRuntime',
        ),
      ],
      ['runtimeClasspath', 'testRuntime'],
      'gradle',
    )
    expect(r.hasBlockingFailures).toBe(true)
    expect(r.summary).toContain('Not found in any repository')
    expect(r.nonBlockingNotice).toContain('ambiguous variant')
  })

  it('classifies an sbt/Ivy unresolved dependency as blocking not-found', () => {
    const r = renderResolutionErrorReport(
      [
        f(
          'com.example:missing:1.0',
          'unresolved dependency: com.example#missing;1.0: not found',
        ),
      ],
      ['compile'],
      'sbt',
    )
    expect(r.hasBlockingFailures).toBe(true)
    expect(r.summary).toContain('Not found in any repository')
    // Ivy has no variant categories.
    expect(r.nonBlockingNotice).toBe('')
  })

  it('classifies a Maven artifact miss as blocking not-found', () => {
    const r = renderResolutionErrorReport(
      [
        f(
          'com.example:missing:jar:1.0',
          'Could not find artifact com.example:missing:jar:1.0',
          'compile',
        ),
      ],
      ['compile'],
      'maven',
    )
    expect(r.hasBlockingFailures).toBe(true)
    expect(r.summary).toContain('Not found in any repository')
  })

  it('reports blocking failures as ignored (not fatal) under ignoreUnresolved', () => {
    const r = renderResolutionErrorReport(
      [f('com.example:missing:1.0', 'Could not find com.example:missing:1.0.')],
      ['runtimeClasspath'],
      'gradle',
      { ignoreUnresolved: true },
    )
    // hasBlockingFailures still reflects the classification; the caller decides.
    expect(r.hasBlockingFailures).toBe(true)
    expect(r.summary).toContain('Ignored')
    expect(r.summary).not.toContain('To proceed, re-run')
  })

  it('returns an empty report when there are no failures', () => {
    const r = renderResolutionErrorReport([], ['runtimeClasspath'], 'gradle')
    expect(r.hasBlockingFailures).toBe(false)
    expect(r.summary).toBe('')
    expect(r.nonBlockingNotice).toBe('')
  })

  it('treats an ambiguity-driven config throw as a non-blocking notice', () => {
    const r = renderResolutionErrorReport(
      [],
      ['debugAndroidTestCompileClasspath'],
      'gradle',
      {
        unscannable: [
          {
            config: 'debugAndroidTestCompileClasspath',
            detail:
              'Cannot choose between the following variants of com.example:foo:1.0',
          },
        ],
      },
    )
    expect(r.hasBlockingFailures).toBe(false)
    expect(r.summary).toBe('')
    expect(r.nonBlockingNotice).toContain('Could not scan 1 configuration(s)')
    expect(r.details).toContain('debugAndroidTestCompileClasspath')
  })

  it('treats a non-ambiguity config throw as a blocking failure', () => {
    const r = renderResolutionErrorReport([], ['runtimeClasspath'], 'gradle', {
      unscannable: [
        {
          config: 'runtimeClasspath',
          detail:
            'Could not GET https://repo.example/foo. Received status code 401',
        },
      ],
    })
    expect(r.hasBlockingFailures).toBe(true)
    expect(r.summary).toContain('Could not scan 1 configuration(s)')
    expect(r.summary).toContain('runtimeClasspath')
    expect(r.nonBlockingNotice).toBe('')
    // With no per-dep failures the summary must not lead with a blank line
    // (which would render as a dangling ✗ under logger.fail).
    expect(r.summary.startsWith('\n')).toBe(false)
  })
})
