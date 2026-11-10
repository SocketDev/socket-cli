/**
 * Narrow copy of @socketsecurity/registry 1.1.17 lib/words.js pluralize.
 * Copyright (c) Socket Inc. Licensed under the MIT License.
 */

export function pluralize(word: string, count = 1): string {
  return count === 0 || count > 1 ? `${word}s` : word
}
