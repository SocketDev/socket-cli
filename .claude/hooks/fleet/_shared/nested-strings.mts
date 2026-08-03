/*
 * @file Bounded walk over a nested tool payload, collecting every string it
 *   reaches.
 *
 *   A tool's text rarely sits in one top-level field. Notion's `rich_text` is
 *   an array of block objects, Slack's `blocks` nest several levels, a
 *   `WebSearch` result is an array of result objects, and a `Bash` result puts
 *   its text under `stdout`/`stderr`. Field names vary per tool and per MCP
 *   server, so a scanner reads EVERY string value rather than pinning a key it
 *   would then have to keep in sync.
 *
 *   Depth and byte caps keep a pathological — or hostile — payload from wedging
 *   the hook doing the walking.
 */

/**
 * Caps for {@link collectNestedStrings}. Both are optional; the defaults suit a
 * tool payload a hook must scan on every call.
 */
export interface NestedStringOptions {
  // Stop collecting once this many characters have been gathered.
  readonly maxBytes?: number | undefined
  // Stop descending past this nesting level. The top-level value is depth 0.
  readonly maxDepth?: number | undefined
}

const DEFAULT_MAX_BYTES = 256 * 1024
const DEFAULT_MAX_DEPTH = 6

/**
 * Every string reachable from `value`, in walk order — plain objects and arrays
 * are descended, every other type is skipped. Returns an empty array for a
 * value carrying no strings.
 */
export function collectNestedStrings(
  value: unknown,
  options?: NestedStringOptions | undefined,
): string[] {
  const opts = { __proto__: null, ...options } as NestedStringOptions
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH
  let remaining = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const out: string[] = []
  const walk = (node: unknown, depth: number): void => {
    if (remaining <= 0 || depth > maxDepth) {
      return
    }
    if (typeof node === 'string') {
      out.push(node)
      remaining -= node.length
      return
    }
    if (Array.isArray(node)) {
      for (let i = 0, { length } = node; i < length; i += 1) {
        walk(node[i], depth + 1)
      }
      return
    }
    if (node && typeof node === 'object') {
      const values = Object.values(node as Record<string, unknown>)
      for (let i = 0, { length } = values; i < length; i += 1) {
        walk(values[i], depth + 1)
      }
    }
  }
  walk(value, 0)
  return out
}
