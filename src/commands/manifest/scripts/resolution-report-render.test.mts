import { describe, expect, it } from 'vitest'

import {
  DSI_SETUP_COMMAND,
  REACH_CONTINUE_ON_INSTALL_ERRORS_FLAG,
  renderResolutionErrorReport,
} from './resolution-report-render.mts'

import type { BuildOptionHints } from './resolution-report-render.mts'
import type { ResolutionFailure } from './resolution-report.mts'

const f = (
  coord: string,
  detail: string,
  config = 'runtimeClasspath',
  project = ':',
): ResolutionFailure => ({
  coord,
  detail,
  config,
  project,
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
            project: ':',
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
          project: ':',
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

describe('resolution failure remedies', () => {
  const dsiCommand: BuildOptionHints = {
    flags: new Set(['ignoreUnresolved', 'verbose']),
    setupCommand: DSI_SETUP_COMMAND,
    socketJson: 'socket.json',
  }
  const socketJsonOnly: BuildOptionHints = {
    flags: new Set(),
    setupCommand: DSI_SETUP_COMMAND,
    socketJson: 'socket.json',
  }
  const mavenMiss = f(
    'com.example:missing:jar:1.0',
    'Could not find artifact com.example:missing:jar:1.0',
    'compile',
  )
  // A dependency that failed while collecting the graph and is absent from
  // it, so no scope holds it.
  const mavenGraphFailure = f(
    'com.example:lib:1.0',
    'Could not transfer artifact com.example:lib-parent:pom:1.0 from/to internal: status code: 401',
    '',
    'com.example:app:1.0',
  )

  it('suggests the flags for a single-build manifest command', () => {
    const r = renderResolutionErrorReport([mavenMiss], ['compile'], 'maven')
    expect(r.summary).toContain('To proceed, re-run with either:')
    expect(r.summary).toContain('    --ignore-unresolved')
    expect(r.summary).toContain("    --exclude-configs 'compile'")
    expect(r.summary).toContain(
      "Re-run with --verbose for Maven's full messages.",
    )
  })

  it('reports a failure outside any configuration by its artifact and project', () => {
    const r = renderResolutionErrorReport(
      [mavenGraphFailure],
      ['compile', 'test'],
      'maven',
    )
    expect(r.summary).toContain('Could not resolve 1 dependency(ies):')
    expect(r.summary).toContain(
      '    - com.example:lib:1.0 (in `com.example:app:1.0`)',
    )
    // Its project's graph is incomplete, so no scope resolved fully.
    expect(r.summary).not.toContain('Resolution succeeded in')
    expect(r.summary).not.toContain('Resolution failed in')
    expect(r.summary).toContain('To proceed, re-run with --ignore-unresolved.')
    expect(r.summary).not.toContain('--exclude-configs')
  })

  it('offers no configuration exclusion when a failure outside any configuration also blocks', () => {
    const r = renderResolutionErrorReport(
      [mavenMiss, mavenGraphFailure],
      ['compile', 'test'],
      'maven',
    )
    expect(r.summary).toContain('Resolution failed in: compile')
    expect(r.summary).toContain('To proceed, re-run with --ignore-unresolved.')
    expect(r.summary).not.toContain('--exclude-configs')
  })

  it('reports a project whose dependencies could not be resolved at all', () => {
    const r = renderResolutionErrorReport([], ['compile'], 'maven', {
      unscannable: [
        {
          config: '',
          detail:
            'Could not resolve dependencies for project com.example:app:1.0',
          project: 'com.example:app:1.0',
        },
      ],
    })
    expect(r.hasBlockingFailures).toBe(true)
    expect(r.summary).toContain(
      'Could not resolve the dependencies of 1 project(s) (reason from Maven):',
    )
    expect(r.summary).toContain('    - `com.example:app:1.0`')
    expect(r.summary).not.toContain('Resolution succeeded in')
    expect(r.summary).toContain('To proceed, re-run with --ignore-unresolved.')
  })

  it('names the subproject of a per-configuration failure', () => {
    const r = renderResolutionErrorReport(
      [
        f(
          'com.example:missing:1.0',
          'Could not find com.example:missing:1.0.',
          'runtimeClasspath',
          ':app',
        ),
      ],
      ['runtimeClasspath'],
      'gradle',
    )
    expect(r.summary).toContain('    - com.example:missing:1.0 (in `:app`)')
    expect(r.summary).toContain('Resolution failed in: runtimeClasspath')
  })

  it('points dynamic-sbom-inference at its flag and socket.json excludeConfigs', () => {
    const r = renderResolutionErrorReport([mavenMiss], ['compile'], 'maven', {
      hints: dsiCommand,
    })
    expect(r.summary).toContain('    re-run with --ignore-unresolved')
    expect(r.summary).toContain(
      'set defaults.manifest.maven.excludeConfigs to "compile" in socket.json (`socket manifest setup --dynamic-sbom-inference`)',
    )
    expect(r.summary).not.toContain('--exclude-configs')
    expect(r.summary).toContain(
      "Re-run with --verbose for Maven's full messages.",
    )
  })

  it('points commands without these flags at socket.json and the dedicated command', () => {
    const r = renderResolutionErrorReport([mavenMiss], ['compile'], 'maven', {
      hints: socketJsonOnly,
    })
    expect(r.summary).toContain(
      'To proceed, set either of these under defaults.manifest.maven in socket.json (`socket manifest setup --dynamic-sbom-inference` walks you through it):',
    )
    expect(r.summary).toContain('    "ignoreUnresolved": true')
    expect(r.summary).toContain('    "excludeConfigs": "compile"')
    expect(r.summary).toContain(
      "For Maven's full messages, set defaults.manifest.maven.verbose to true in socket.json.",
    )
    expect(r.summary).not.toMatch(/--ignore-unresolved|--exclude-configs/)
  })

  it('tells a reachability scan to also continue on install errors', () => {
    const r = renderResolutionErrorReport([mavenMiss], ['compile'], 'maven', {
      hints: {
        ...socketJsonOnly,
        continueOnInstallErrorsFlag: REACH_CONTINUE_ON_INSTALL_ERRORS_FLAG,
      },
    })
    expect(r.summary).toContain('    "ignoreUnresolved": true')
    expect(r.summary).toContain(
      'If you ignore unresolved dependencies, also pass --reach-continue-on-install-errors: reachability analysis cannot install them.',
    )
  })

  it('does not mention install errors outside a reachability scan', () => {
    const r = renderResolutionErrorReport([mavenMiss], ['compile'], 'maven', {
      hints: socketJsonOnly,
    })
    expect(r.summary).not.toContain('install')
  })

  it("names the failing build root's own socket.json", () => {
    const r = renderResolutionErrorReport([mavenMiss], ['compile'], 'maven', {
      hints: { ...socketJsonOnly, socketJson: 'tools/codegen/socket.json' },
    })
    expect(r.summary).toContain(
      'under defaults.manifest.maven in tools/codegen/socket.json',
    )
    expect(r.summary).toContain(
      'set defaults.manifest.maven.verbose to true in tools/codegen/socket.json',
    )
  })

  it('uses the singular socket.json remedy when only ignoreUnresolved applies', () => {
    const r = renderResolutionErrorReport(
      [mavenGraphFailure],
      ['compile'],
      'maven',
      { hints: socketJsonOnly },
    )
    expect(r.summary).toContain(
      'To proceed, set this under defaults.manifest.maven',
    )
    expect(r.summary).not.toContain('excludeConfigs')
  })

  it('points the non-blocking notice at socket.json when there is no --verbose flag', () => {
    const r = renderResolutionErrorReport(
      [],
      ['debugCompileClasspath'],
      'gradle',
      {
        hints: socketJsonOnly,
        unscannable: [
          {
            config: 'debugCompileClasspath',
            detail:
              'Cannot choose between the following variants of com.example:foo:1.0',
            project: ':',
          },
        ],
      },
    )
    expect(r.nonBlockingNotice).toContain(
      'set defaults.manifest.gradle.verbose to true in socket.json',
    )
    expect(r.nonBlockingNotice).not.toContain('re-run with --verbose')
  })
})

describe('failures checked against what resolved', () => {
  const ambiguous = f(
    'com.example:amb:1.0',
    'Cannot choose between the following variants of com.example:amb:1.0',
    'runtimeClasspath',
    ':app',
  )

  it('keeps variant ambiguity lenient when the module resolved in its project', () => {
    const r = renderResolutionErrorReport(
      [ambiguous],
      ['runtimeClasspath'],
      'gradle',
      { resolvedModules: new Set([':app\tcom.example:amb']) },
    )
    expect(r.hasBlockingFailures).toBe(false)
    expect(r.nonBlockingNotice).toContain('ambiguous variant selection')
  })

  it('blocks on variant ambiguity when the module resolved nowhere in its project', () => {
    const r = renderResolutionErrorReport(
      [ambiguous],
      ['runtimeClasspath'],
      'gradle',
      { resolvedModules: new Set([':lib\tcom.example:amb']) },
    )
    expect(r.hasBlockingFailures).toBe(true)
    expect(r.summary).toContain('Ambiguous variant')
    expect(r.summary).toContain('    - com.example:amb:1.0 (in `:app`)')
    expect(r.nonBlockingNotice).toBe('')
  })

  it('keeps a bare module failure from another project than its versioned form', () => {
    const r = renderResolutionErrorReport(
      [
        f('com.example:x', 'Could not find com.example:x.', 'compile', ':a'),
        f(
          'com.example:x:1.0',
          'Could not find com.example:x:1.0.',
          'compile',
          ':b',
        ),
      ],
      ['compile'],
      'gradle',
    )
    expect(r.summary).toContain('    - com.example:x (in `:a`)')
    expect(r.summary).toContain('    - com.example:x:1.0 (in `:b`)')
  })

  it('still reminds a reachability scan of install errors once failures are ignored', () => {
    const r = renderResolutionErrorReport(
      [f('com.example:missing:1.0', 'Could not find com.example:missing:1.0.')],
      ['runtimeClasspath'],
      'gradle',
      {
        hints: {
          continueOnInstallErrorsFlag: REACH_CONTINUE_ON_INSTALL_ERRORS_FLAG,
          flags: new Set(),
          setupCommand: 'socket manifest setup',
          socketJson: 'socket.json',
        },
        ignoreUnresolved: true,
      },
    )
    expect(r.summary).toContain('Ignored 1 unresolved dependency(ies)')
    expect(r.summary).toContain(
      'Reachability analysis cannot install the ignored dependencies; pass --reach-continue-on-install-errors unless you already do.',
    )
  })
})

const mavenReport = (detail: string) =>
  renderResolutionErrorReport(
    [f('com.example:x:jar:1.0', detail, 'compile')],
    ['compile'],
    'maven',
  )

describe('Maven failure classification', () => {
  it('classifies a repository blocked by the HTTP blocker as a repository error', () => {
    const r = mavenReport(
      'Blocked mirror for repositories: [insecure (http://repo.example.invalid/maven, default, releases+snapshots)]',
    )
    expect(r.hasBlockingFailures).toBe(true)
    expect(r.summary).toContain('Repository or network error')
  })

  it('classifies offline mode as a repository error, not a miss', () => {
    const r = mavenReport(
      'The POM for com.example:x:jar:1.0 is missing, no dependency information available: Cannot access central (https://repo.maven.apache.org/maven2) in offline mode',
    )
    expect(r.summary).toContain('Repository or network error')
    expect(r.summary).not.toContain('Not found in any repository')
  })

  it('classifies a POM Maven tolerated as invalid as a POM problem', () => {
    const r = mavenReport(
      'The POM for com.example:x:jar:1.0 is invalid, transitive dependencies (if any) will not be available: 1 problem was encountered while building the effective model for com.example:x:1.0',
    )
    expect(r.summary).toContain('POM/descriptor problem')
  })

  it('classifies a path the repository prefix filter rules out as not found', () => {
    const r = mavenReport(
      'prefixes: Path com/example/x/1.0/x-1.0.pom NOT allowed from central',
    )
    expect(r.summary).toContain('Not found in any repository')
  })
})
