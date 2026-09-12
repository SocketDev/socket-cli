import micromatch from 'micromatch'

// Helper for testing.
export function isGlobMatch(path: string, patterns: string[]): boolean {
  return micromatch.isMatch(path, patterns)
}
