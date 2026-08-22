/**
 * @file Platform-specific binary mappings for external security tools, derived
 *   from the `platforms` map each `gh-asset` tool declares in
 *   packages/cli/bundle-tools.json. Used by:
 *
 *   - SEA build utils for downloading and packaging security tools
 *   - The build-time checksum validator bundle-tools.json is the single source of
 *     truth: a tool's asset for a platform is edited there, never here.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

interface PlatformEntry {
  asset: string
  integrity: string
}

interface ToolEntry {
  origin?: string | undefined
  // oxlint-disable-next-line socket/prefer-refined-record -- JSON shape.
  platforms?: Record<string, PlatformEntry> | undefined
}

// oxlint-disable-next-line socket/prefer-refined-record -- JSON shape.
type PlatformMapTools = Record<string, Record<string, string>>

/**
 * Platform-specific binary mappings for external security tools.
 *
 * Maps a canonical platform key such as `darwin-arm64`, `linux-x64-musl` or
 * `win32-x64` to `{ <tool name>: <release asset filename> }`. The keys are the
 * canonical 8 the shared external-tools schema defines, which is what
 * `downloadExternalTools` builds from a SEA target's `platform`/`arch`/`libc`.
 *
 * Most assets are native for their target. Two deliberate substitutions are
 * encoded in bundle-tools.json rather than inferred here:
 *
 * - Trivy, OpenGrep and sfw have no native Windows ARM64 build, so `win32-arm64`
 *   points at the x64 asset. Windows 11 ARM64 emulates x64 transparently.
 * - Socket-patch ships neither an `x86_64-unknown-linux-gnu` nor an
 *   `aarch64-unknown-linux-musl` build, so `linux-x64` uses the statically
 *   linked musl asset and `linux-arm64-musl` uses the glibc asset. The musl
 *   asset runs on glibc systems as well.
 */
export const PLATFORM_MAP_TOOLS: PlatformMapTools = buildPlatformMapTools()

function buildPlatformMapTools(): PlatformMapTools {
  const tools = JSON.parse(
    readFileSync(path.join(packageRoot, 'bundle-tools.json'), 'utf8'),
    // oxlint-disable-next-line socket/prefer-refined-record -- JSON shape.
  ).tools as Record<string, ToolEntry>

  const byPlatform = { __proto__: null } as unknown as PlatformMapTools
  const entries = Object.entries(tools)
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const [toolName, tool] = entries[i]!
    if (tool.origin !== 'gh-asset' || !tool.platforms) {
      continue
    }
    const platformEntries = Object.entries(tool.platforms)
    for (let j = 0, plen = platformEntries.length; j < plen; j += 1) {
      const [platformKey, platformEntry] = platformEntries[j]!
      let forPlatform = byPlatform[platformKey]
      if (!forPlatform) {
        forPlatform = { __proto__: null } as unknown as Record<string, string>
        byPlatform[platformKey] = forPlatform
      }
      forPlatform[toolName] = platformEntry.asset
    }
  }
  return byPlatform
}
