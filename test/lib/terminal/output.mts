import type { TerminalBackend } from '@termless/core'

export interface LiteralReplacement {
  readonly search: string
  readonly replacement: string
}

/** Replace known fixture paths before terminal layout, including split PTY chunks. */
export function normalizeBackendPaths(
  backend: TerminalBackend,
  paths: readonly string[],
  replacement = '<NATIVE_FIXTURE>',
): { flush(): void; matched(search: string): boolean } {
  return normalizeBackendOutput(
    backend,
    paths.map(search => ({ search, replacement })),
  )
}

/** Normalize exact known strings before the emulator calculates terminal layout. */
export function normalizeBackendOutput(
  backend: TerminalBackend,
  literals: readonly LiteralReplacement[],
): { flush(): void; matched(search: string): boolean } {
  const replacements = literals
    .filter(({ search }) => search.length > 0)
    .map(
      ({ replacement, search }) =>
        [Buffer.from(search), Buffer.from(replacement)] as const,
    )
    .sort(([a], [b]) => b.length - a.length)
  if (!replacements.length) {
    return { flush() {}, matched: () => false }
  }

  const feed = backend.feed.bind(backend)
  const matches = new Set<string>()
  let pending = Buffer.alloc(0)
  const write = (data: Buffer, flush: boolean) => {
    const combined = Buffer.concat([pending, data])
    const output: Buffer[] = []
    let cursor = 0
    while (cursor < combined.length) {
      const exact = replacements.find(([needle]) =>
        combined.subarray(cursor, cursor + needle.length).equals(needle),
      )
      if (exact) {
        matches.add(exact[0].toString())
        output.push(exact[1])
        cursor += exact[0].length
        continue
      }
      let partialLength = 0
      if (!flush) {
        for (const [needle] of replacements) {
          const length = Math.min(needle.length - 1, combined.length - cursor)
          if (
            length > partialLength &&
            combined
              .subarray(cursor, cursor + length)
              .equals(needle.subarray(0, length))
          ) {
            partialLength = length
          }
        }
      }
      if (partialLength === combined.length - cursor) {
        break
      }
      if (partialLength > 0) {
        output.push(combined.subarray(cursor, cursor + partialLength))
        cursor += partialLength
      } else {
        output.push(combined.subarray(cursor, cursor + 1))
        cursor += 1
      }
    }
    pending = Buffer.from(combined.subarray(cursor))
    const normalized = Buffer.concat(output)
    if (normalized.length > 0) {
      feed(normalized)
    }
  }
  backend.feed = data => write(Buffer.from(data), false)
  return {
    flush() {
      write(Buffer.alloc(0), true)
    },
    matched(search) {
      return matches.has(search)
    },
  }
}
