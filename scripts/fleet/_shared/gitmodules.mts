/**
 * @file One `.gitmodules` parser shared by the submodule checks. Splits the
 *   file into one entry per `[submodule "<name>"]` block, capturing the fields
 *   the fleet gates read: the sparse-checkout pattern + `# full-checkout:`
 *   annotation (submodules-are-sparse-or-annotated) and the `shallow` +
 *   `branch` reference fields (upstream-submodules-are-shallow-single-branch).
 *   A single pass avoids a per-check fork of the same section scanner.
 */

export interface GitmodulesEntry {
  // Quoted name from `[submodule "<name>"]`.
  name: string
  // 1-based line of the opening `[submodule …]`.
  line: number
  // `path =` value, else undefined.
  path: string | undefined
  // `url =` value, else undefined.
  url: string | undefined
  // `branch =` value (single-branch tracking ref), else undefined.
  branch: string | undefined
  // True when the block declares `shallow = true`.
  shallow: boolean
  // Non-empty `sparse-checkout =` value, else undefined.
  sparse: string | undefined
  // Convenience mirror of `sparse !== undefined`.
  hasSparse: boolean
  // `verify =` consumer command / the literal `none`, else undefined.
  verify: string | undefined
  // The `# full-checkout: <reason>` reason from the header comment, else
  // undefined.
  fullCheckoutReason: string | undefined
}

// Parse `.gitmodules` into one entry per submodule. Comment annotations are
// read from the contiguous `#` lines directly above the block; config fields
// are read from the block body up to the next `[` section.
export function parseGitmodules(text: string): GitmodulesEntry[] {
  const lines = text.split(/\r?\n/)
  const entries: GitmodulesEntry[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const open = /^\s*\[submodule\s+"([^"]+)"\s*\]\s*$/.exec(lines[i]!)
    if (!open) {
      continue
    }
    // Scan the contiguous comment lines directly above for a full-checkout
    // annotation (it may sit on the `# <name>-<version>` header or its own
    // comment line).
    let fullCheckoutReason: string | undefined
    for (let j = i - 1; j >= 0; j -= 1) {
      const prev = lines[j]!
      if (!prev.trimStart().startsWith('#')) {
        break
      }
      const m = /#.*\bfull-checkout:\s*(.+?)\s*$/.exec(prev)
      if (m) {
        fullCheckoutReason = m[1]
        break
      }
    }
    // Scan the block body (up to the next `[` section) for the config fields.
    let branch: string | undefined
    let entryPath: string | undefined
    let shallow = false
    let sparse: string | undefined
    let url: string | undefined
    let verify: string | undefined
    for (let j = i + 1; j < length; j += 1) {
      const next = lines[j]!
      if (/^\s*\[/.test(next)) {
        break
      }
      // Match a `key = value` .gitmodules line: capture the key (word chars
      // and hyphens) and the trimmed value on either side of the `=`.
      const kv = /^\s*([\w-]+)\s*=\s*(.*?)\s*$/.exec(next)
      if (!kv) {
        continue
      }
      const key = kv[1]!
      const value = kv[2]!
      if (key === 'branch' && value) {
        branch = value
      } else if (key === 'path') {
        entryPath = value
      } else if (key === 'shallow') {
        shallow = value === 'true'
      } else if (key === 'sparse-checkout' && value) {
        sparse = value
      } else if (key === 'url') {
        url = value
      } else if (key === 'verify' && value) {
        verify = value
      }
    }
    entries.push({
      name: open[1]!,
      line: i + 1,
      path: entryPath,
      url,
      branch,
      shallow,
      sparse,
      hasSparse: sparse !== undefined,
      verify,
      fullCheckoutReason,
    })
  }
  return entries
}
