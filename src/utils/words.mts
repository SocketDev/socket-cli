export function pluralize(word: string, count = 1): string {
  return count === 0 || count > 1 ? `${word}s` : word
}
