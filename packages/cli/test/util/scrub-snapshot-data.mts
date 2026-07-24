/**
 * Comprehensive snapshot data scrubbing for consistent cross-environment
 * testing.
 *
 * This utility ensures snapshots don't contain machine-specific,
 * time-dependent, or environment-specific data that would cause test failures
 * across different systems or time periods.
 */

import { WORKSPACE_ROOT } from '../../scripts/paths.mts'

interface ScrubOptions {
  /**
   * Scrub absolute file paths (default: true).
   */
  paths?: boolean | undefined
  /**
   * Scrub timestamps and dates (default: true).
   */
  timestamps?: boolean | undefined
  /**
   * Scrub UUIDs and scan IDs (default: true).
   */
  ids?: boolean | undefined
  /**
   * Scrub version numbers (default: false - usually stable in mocks).
   */
  versions?: boolean | undefined
  /**
   * Scrub IP addresses (default: true).
   */
  ipAddresses?: boolean | undefined
  /**
   * Scrub git branch names in dry-run details (default: true).
   */
  branches?: boolean | undefined
  /**
   * Scrub email addresses (default: false - usually stable in mocks).
   */
  emails?: boolean | undefined
  /**
   * Additional custom scrubbing patterns.
   */
  custom?: Array<{ pattern: RegExp; replacement: string }> | undefined
}

/**
 * Scrub snapshot data to remove environment-specific and time-dependent values.
 *
 * This function applies multiple scrubbing passes to ensure snapshots are
 * consistent across different machines, environments, and time periods.
 *
 * @param output - The string to scrub.
 * @param options - Scrubbing options to control what gets scrubbed.
 *
 * @returns The scrubbed string with environment-specific data replaced
 */
export function scrubSnapshotData(
  output: string,
  options: ScrubOptions = {},
): string {
  const {
    branches = true,
    custom = [],
    emails = false,
    ids = true,
    ipAddresses = true,
    paths = true,
    timestamps = true,
    versions = false,
  } = options

  let scrubbed = output

  // Phase 1: Timestamps.
  if (timestamps) {
    // ISO timestamps: 2025-04-02T01:47:26.914Z.
    scrubbed = scrubbed.replace(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g,
      '[TIMESTAMP]',
    )
    // Date-only: 2025-04-02.
    scrubbed = scrubbed.replace(/\d{4}-\d{2}-\d{2}/g, '[DATE]')
    // Relative time: "2 days ago", "5 minutes ago".
    scrubbed = scrubbed.replace(
      /\d+\s+(?:days?|hours?|minutes?|seconds?)\s+ago/g,
      '[RELATIVE_TIME]',
    )
  }

  // Phase 2: Absolute paths.
  if (paths) {
    // Workspace root - must come before user home scrubbing. Anchoring on
    // WORKSPACE_ROOT (not process.cwd()) keeps [PROJECT] stable across test
    // lanes: the fleet root vitest lane runs workers at the repo root while
    // the packages/cli wrapper lane runs them at packages/cli.
    scrubbed = scrubbed.replaceAll(WORKSPACE_ROOT, '[PROJECT]')
    // Worker cwd, for the rare case it sits outside the workspace root
    // (no-op when nested - the root pass already rewrote its prefix).
    scrubbed = scrubbed.replaceAll(process.cwd(), '[PROJECT]')

    // Unix home directories.
    scrubbed = scrubbed.replace(/\/Users\/[^/\s]+/g, '/[HOME]')
    scrubbed = scrubbed.replace(/\/home\/[^/\s]+/g, '/[HOME]')

    // Windows home directories.
    scrubbed = scrubbed.replace(/C:\\Users\\[^\\]+/gi, 'C:\\[HOME]')

    // Temp directories.
    scrubbed = scrubbed.replace(/\/tmp\/[a-zA-Z0-9_-]+/g, '/[TEMP]')
    scrubbed = scrubbed.replace(/\\Temp\\[a-zA-Z0-9_-]+/gi, '\\[TEMP]')

    // Resolved npm/npx binary paths. The raw-npm/raw-npx dry-run prints the
    // npm install it resolved, which varies by machine (wheelhouse rack copy
    // locally, hostedtoolcache npm in CI) and by rack npm version.
    scrubbed = scrubbed.replace(/\S+[\\/]npm-cli\.js/g, '[NPM_CLI]')
    scrubbed = scrubbed.replace(/\S+[\\/]npx-cli\.js/g, '[NPX_CLI]')
  }

  // Phase 3: IDs and UUIDs.
  if (ids) {
    // UUIDs.
    scrubbed = scrubbed.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '[UUID]',
    )
    // Scan IDs: scan-123, scan-ai-dee.
    scrubbed = scrubbed.replace(/scan-[a-zA-Z0-9-]+/g, 'scan-[ID]')
    // Event IDs in JSON: "event_id": "123112".
    scrubbed = scrubbed.replace(/"event_id":\s*"(?:\d+)"/g, '"event_id":"[ID]"')
  }

  // Phase 4: Version numbers.
  if (versions) {
    // Node version: v22.11.0.
    scrubbed = scrubbed.replace(/v\d+\.\d+\.\d+/g, 'v[VERSION]')
    // Package versions: socket@1.1.25.
    scrubbed = scrubbed.replace(/socket@\d+\.\d+\.\d+/g, 'socket@[VERSION]')
  }

  // Phase 5: IP addresses.
  if (ipAddresses) {
    // IPv4.
    scrubbed = scrubbed.replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '[IP]')
    // IPv6.
    scrubbed = scrubbed.replace(/(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}/gi, '[IP]')
  }

  // Phase 6: Email addresses.
  if (emails) {
    scrubbed = scrubbed.replace(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      '[EMAIL]',
    )
  }

  // Phase 7: Git branch names in dry-run details.
  if (branches) {
    // The CLI resolves the branch from the ambient git checkout
    // (`git symbolic-ref`) or the CI env (GITHUB_HEAD_REF / GITHUB_REF_NAME),
    // so the rendered `branchName: "…"` is whatever branch the test happens to
    // run on — "main" on a main push, the PR head branch on a PR build, the
    // local feature branch when run from a worktree, or a short commit hash on
    // a detached HEAD with no CI env. Pin it so the snapshot is branch-agnostic
    // (this test failed on every non-main PR before). The branch-resolution
    // logic itself stays covered by the unit tests that mock `gitBranch`
    // (handle-ci / cmd-ci unit specs). Only matches the human-readable details
    // form (`branchName: "…"`, space after the unquoted key), not JSON output
    // (`"branchName":"…"`).
    scrubbed = scrubbed.replace(
      /branchName: "[^"]*"/g,
      'branchName: "[BRANCH]"',
    )
  }

  // Phase 8: Custom patterns.
  for (const { pattern, replacement } of custom) {
    scrubbed = scrubbed.replace(pattern, replacement)
  }

  return scrubbed
}

/**
 * Convenience function for scrubbing inline snapshot strings. Wraps
 * scrubSnapshotData with sensible defaults.
 *
 * @param output - The string to scrub.
 *
 * @returns The scrubbed string with default scrubbing applied
 */
export function toSnapshotString(output: string): string {
  return scrubSnapshotData(output, {
    emails: false,
    versions: false,
  })
}
