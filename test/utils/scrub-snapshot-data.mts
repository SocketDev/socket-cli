/**
 * Comprehensive snapshot data scrubbing for consistent cross-environment testing.
 *
 * This utility ensures snapshots don't contain machine-specific, time-dependent,
 * or environment-specific data that would cause test failures across different
 * systems or time periods.
 */

export interface ScrubOptions {
  /** Scrub absolute file paths (default: true). */
  paths?: boolean
  /** Scrub timestamps and dates (default: true). */
  timestamps?: boolean
  /** Scrub UUIDs and scan IDs (default: true). */
  ids?: boolean
  /** Scrub version numbers (default: false - usually stable in mocks). */
  versions?: boolean
  /** Scrub IP addresses (default: true). */
  ipAddresses?: boolean
  /** Scrub email addresses (default: false - usually stable in mocks). */
  emails?: boolean
  /** Additional custom scrubbing patterns. */
  custom?: Array<{ pattern: RegExp; replacement: string }>
}

/**
 * Scrub snapshot data to remove environment-specific and time-dependent values.
 *
 * This function applies multiple scrubbing passes to ensure snapshots are
 * consistent across different machines, environments, and time periods.
 *
 * @param output - The string to scrub
 * @param options - Scrubbing options to control what gets scrubbed
 * @returns The scrubbed string with environment-specific data replaced
 */
export function scrubSnapshotData(
  output: string,
  options: ScrubOptions = {},
): string {
  const {
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
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z/g,
      '[TIMESTAMP]',
    )
    // Date-only: 2025-04-02.
    scrubbed = scrubbed.replace(/\d{4}-\d{2}-\d{2}/g, '[DATE]')
    // Relative time: "2 days ago", "5 minutes ago".
    scrubbed = scrubbed.replace(
      /\d+\s+(days?|hours?|minutes?|seconds?)\s+ago/g,
      '[RELATIVE_TIME]',
    )
  }

  // Phase 2: Absolute paths.
  if (paths) {
    // Project root (use process.cwd()) - must come before user home scrubbing.
    const cwd = process.cwd()
    scrubbed = scrubbed.replaceAll(cwd, '[PROJECT]')

    // Unix home directories.
    scrubbed = scrubbed.replace(/\/Users\/[^/\s]+/g, '/[HOME]')
    scrubbed = scrubbed.replace(/\/home\/[^/\s]+/g, '/[HOME]')

    // Windows home directories.
    scrubbed = scrubbed.replace(/C:\\Users\\[^\\]+/gi, 'C:\\[HOME]')

    // Temp directories.
    scrubbed = scrubbed.replace(/\/tmp\/[a-zA-Z0-9_-]+/g, '/[TEMP]')
    scrubbed = scrubbed.replace(/\\Temp\\[a-zA-Z0-9_-]+/gi, '\\[TEMP]')
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
    scrubbed = scrubbed.replace(/"event_id":\s*"(\d+)"/g, '"event_id":"[ID]"')
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
    scrubbed = scrubbed.replace(/([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}/gi, '[IP]')
  }

  // Phase 6: Email addresses.
  if (emails) {
    scrubbed = scrubbed.replace(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      '[EMAIL]',
    )
  }

  // Phase 7: Custom patterns.
  for (const { pattern, replacement } of custom) {
    scrubbed = scrubbed.replace(pattern, replacement)
  }

  return scrubbed
}

/**
 * Convenience function for scrubbing inline snapshot strings.
 * Wraps scrubSnapshotData with sensible defaults.
 *
 * @param output - The string to scrub
 * @returns The scrubbed string with default scrubbing applied
 */
export function toSnapshotString(output: string): string {
  return scrubSnapshotData(output, {
    emails: false,
    versions: false,
  })
}
