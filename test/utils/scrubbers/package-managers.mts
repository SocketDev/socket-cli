/** @fileoverview Package manager output scrubbers for test snapshots. */

/**
 * Scrub Socket Firewall output to prevent snapshot inconsistencies
 * from version numbers, timing, package counts, and other variable data.
 */
export function scrubFirewallOutput(str: string): string {
  let result = str

  // Normalize Yarn version numbers (e.g., "Yarn 4.10.3" -> "Yarn X.X.X")
  result = result.replace(/Yarn \d+\.\d+\.\d+/g, 'Yarn X.X.X')

  // Normalize timing information (e.g., "3s 335ms" -> "Xs XXXms", "0s 357ms" -> "Xs XXXms")
  result = result.replace(/\d+s \d+ms/g, 'Xs XXXms')

  // Normalize package count information (e.g., "1137 more" -> "XXXX more")
  result = result.replace(/and \d+ more\./g, 'and XXXX more.')

  return result
}

/**
 * Scrub pnpm output to prevent snapshot inconsistencies from timing variations.
 * Normalizes execution time to prevent flaky tests.
 */
export function scrubPnpmOutput(str: string): string {
  let result = str

  // Normalize pnpm timing: "Done in 1.2s" -> "Done in Xs", "Done in 825ms" -> "Done in Xs"
  result = result.replace(
    /Done in \d+(\.\d+)?s using pnpm/g,
    'Done in Xs using pnpm',
  )
  result = result.replace(/Done in \d+ms using pnpm/g, 'Done in Xs using pnpm')

  // Remove all intermediate progress lines (keep only the final one with "done")
  // and normalize the numbers in remaining progress lines
  const lines = result.split('\n')
  const filteredLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Check if this is a progress line
    if (line.startsWith('Progress: resolved ')) {
      // Only keep the final progress line (the one with "done" at the end)
      // Skip intermediate progress updates
      if (line.includes(', done')) {
        // Normalize the numbers: "Progress: resolved 1045, reused 934, downloaded 0, added 0, done"
        // -> "Progress: resolved X, reused X, downloaded X, added X, done"
        filteredLines.push(
          line.replace(
            /Progress: resolved \d+, reused \d+, downloaded \d+, added \d+, done/,
            'Progress: resolved X, reused X, downloaded X, added X, done',
          ),
        )
      }
      // Skip intermediate progress lines without "done"
    } else {
      filteredLines.push(line)
    }
  }

  result = filteredLines.join('\n')

  return result
}

/**
 * Scrub npm output to prevent snapshot inconsistencies from timing variations.
 * Normalizes execution time to prevent flaky tests.
 */
export function scrubNpmOutput(str: string): string {
  let result = str

  // Normalize npm timing variations
  result = result.replace(
    /added \d+ packages in \d+(\.\d+)?s/g,
    'added X packages in Xs',
  )
  result = result.replace(/up to date in \d+(\.\d+)?s/g, 'up to date in Xs')

  return result
}
