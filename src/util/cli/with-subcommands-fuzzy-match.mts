/**
 * Fuzzy command-name matching for the CLI sub-command router — suggests the
 * closest known command when a user mistypes one.
 *
 * Extracted from with-subcommands.mts to keep that file under the 1000-line
 * File size hard cap.
 */

/**
 * Find the best matching command name for a typo.
 */
export function findBestCommandMatch(
  input: string,
  subcommands: Record<string, unknown>,
  aliases: Record<string, unknown>,
): string | undefined {
  let bestMatch = undefined
  let bestScore = Number.POSITIVE_INFINITY
  const allCommands = [...Object.keys(subcommands), ...Object.keys(aliases)]
  for (let i = 0, { length } = allCommands; i < length; i += 1) {
    const command = allCommands[i]!
    const distance = levenshteinDistance(
      input.toLowerCase(),
      command.toLowerCase(),
    )
    const maxLength = Math.max(input.length, command.length)
    // Only suggest if the similarity is reasonable (more than 50% similar).
    if (distance < maxLength * 0.5 && distance < bestScore) {
      bestScore = distance
      bestMatch = command
    }
  }
  return bestMatch
}

/**
 * Calculate Levenshtein distance between two strings for fuzzy matching.
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0),
  )
  for (let i = 0; i <= a.length; i++) {
    matrix[i]![0] = i
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0]![j] = j
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i]![j] = Math.min(
        // Deletion.
        matrix[i - 1]?.[j]! + 1,
        // Insertion.
        matrix[i]?.[j - 1]! + 1,
        // Substitution.
        matrix[i - 1]?.[j - 1]! + cost,
      )
    }
  }
  return matrix[a.length]?.[b.length]!
}
