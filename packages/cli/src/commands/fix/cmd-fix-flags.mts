import terminalLink from 'terminal-link'

import { ENV } from '../../constants.mts'

import type { MeowFlag, MeowFlags } from '../../flags.mts'

export const DEFAULT_LIMIT = 10

export const generalFlags: MeowFlags = {
  all: {
    type: 'boolean',
    default: false,
    description:
      'Process all discovered vulnerabilities in local mode. Cannot be used with --id.',
  },
  applyFixes: {
    aliases: ['onlyCompute'],
    type: 'boolean',
    default: true,
    description:
      'Compute fixes only, do not apply them. Logs what upgrades would be applied. If combined with --output-file, the output file will contain the upgrades that would be applied.',
    // Hidden to allow custom documenting of the negated `--no-apply-fixes` variant.
    hidden: true,
  },
  autopilot: {
    type: 'boolean',
    default: false,
    description: `Enable auto-merge for pull requests that Socket opens.\nSee ${terminalLink(
      'GitHub documentation',
      'https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository',
    )} for managing auto-merge for pull requests in your repository.`,
  },
  batch: {
    type: 'boolean',
    default: false,
    description:
      'Create a single PR for all fixes instead of one PR per GHSA (CI mode only)',
    hidden: true,
  },
  debug: {
    type: 'boolean',
    default: false,
    description:
      'Enable debug logging in the Coana-based Socket Fix CLI invocation.',
    shortFlag: 'd',
  },
  disableExternalToolChecks: {
    type: 'boolean',
    default: false,
    description: 'Disable external tool checks during fix analysis.',
    hidden: true,
  },
  ecosystems: {
    type: 'string',
    default: [],
    description:
      'Limit fix analysis to specific ecosystems. Can be provided as comma separated values or as multiple flags. Defaults to all ecosystems.',
    isMultiple: true,
  },
  exclude: {
    type: 'string',
    default: [],
    description:
      'Exclude workspaces matching these glob patterns. Can be provided as comma separated values or as multiple flags',
    isMultiple: true,
  },
  fixVersion: {
    type: 'string',
    description: `Override the version of @coana-tech/cli used for fix analysis. Default: ${ENV.INLINED_COANA_VERSION}.`,
  },
  id: {
    type: 'string',
    default: [],
    description: `Provide a list of vulnerability identifiers to compute fixes for:
    - ${terminalLink(
      'GHSA IDs',
      'https://docs.github.com/en/code-security/security-advisories/working-with-global-security-advisories-from-the-github-advisory-database/about-the-github-advisory-database#about-ghsa-ids',
    )} (e.g., GHSA-xxxx-xxxx-xxxx)
    - ${terminalLink(
      'CVE IDs',
      'https://cve.mitre.org/cve/identifiers/',
    )} (e.g., CVE-${new Date().getFullYear()}-1234) - automatically converted to GHSA
    - ${terminalLink(
      'PURLs',
      'https://github.com/package-url/purl-spec',
    )} (e.g., pkg:npm/package@1.0.0) - automatically converted to GHSA
    Can be provided as comma separated values or as multiple flags. Cannot be used with --all.`,
    isMultiple: true,
  },
  include: {
    type: 'string',
    default: [],
    description:
      'Include workspaces matching these glob patterns. Can be provided as comma separated values or as multiple flags',
    isMultiple: true,
  },
  majorUpdates: {
    type: 'boolean',
    default: true,
    description:
      'Allow major version updates. Use --no-major-updates to disable.',
    // Hidden to allow custom documenting the negated `--no-major-updates` variant.
    hidden: true,
  },
  minimumReleaseAge: {
    type: 'string',
    default: '',
    description:
      'Set a minimum age requirement for suggested upgrade versions (e.g., 1h, 2d, 3w). A higher age requirement reduces the risk of upgrading to malicious versions. For example, setting the value to 1 week (1w) gives ecosystem maintainers one week to remove potentially malicious versions.',
  },
  outputFile: {
    type: 'string',
    default: '',
    description: 'Path to store upgrades as a JSON file at this path.',
  },
  prLimit: {
    aliases: ['limit'],
    type: 'number',
    default: DEFAULT_LIMIT,
    description: `Maximum number of pull requests to create in CI mode (default ${DEFAULT_LIMIT}). Has no effect in local mode.`,
  },
  rangeStyle: {
    type: 'string',
    default: 'preserve',
    description: `
Define how dependency version ranges are updated in package.json (default 'preserve').
Available styles:
  * pin - Use the exact version (e.g. 1.2.3)
  * preserve - Retain the existing version range style as-is
      `.trim(),
  },
  showAffectedDirectDependencies: {
    type: 'boolean',
    default: false,
    description:
      'List the direct dependencies responsible for introducing transitive vulnerabilities and list the updates required to resolve the vulnerabilities',
  },
  silence: {
    type: 'boolean',
    default: false,
    description: 'Silence all output except the final result',
  },
}

export const hiddenFlags: MeowFlags = {
  autoMerge: {
    ...generalFlags['autopilot'],
    hidden: true,
  } as MeowFlag,
  ghsa: {
    ...generalFlags['id'],
    hidden: true,
  } as MeowFlag,
  maxSatisfying: {
    type: 'boolean',
    default: true,
    description: 'Use the maximum satisfying version for dependency updates',
    hidden: true,
  },
  minSatisfying: {
    type: 'boolean',
    default: false,
    description:
      'Constrain dependency updates to the minimum satisfying version',
    hidden: true,
  },
  prCheck: {
    type: 'boolean',
    default: true,
    description: 'Check for an existing PR before attempting a fix',
    hidden: true,
  },
  purl: {
    type: 'string',
    default: [],
    description: `Provide a list of ${terminalLink(
      'PURLs',
      'https://github.com/package-url/purl-spec?tab=readme-ov-file#purl',
    )} to compute fixes for, as either a comma separated value or as\nmultiple flags`,
    isMultiple: true,
    shortFlag: 'p',
    hidden: true,
  },
  test: {
    type: 'boolean',
    default: false,
    description: 'Verify the fix by running unit tests',
    hidden: true,
  },
  testScript: {
    type: 'string',
    default: 'test',
    description: "The test script to run for fix attempts (default 'test')",
    hidden: true,
  },
}
