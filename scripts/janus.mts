/**
 * @file Canonical fleet janus launcher. Forwards argv to the janus binary
 *   installed by `.claude/hooks/setup-security-tools/` under the shared
 *   wheelhouse dir
 *   (`~/.socket/_wheelhouse/janus/<version>/<platform-arch>/janus`) so every
 *   fleet member's `pnpm run janus -- <args>` resolves to the same SHA-verified
 *   binary. Version + platform support come from the hook's
 *   `external-tools.json` so this script never drifts from the installer. janus
 *   is not a security tool — it's a single-binary utility that some Socket
 *   workflows opt into. If the binary is missing (or the current platform isn't
 *   supported by upstream), we print a hint to run `pnpm run
 *   setup-security-tools` and exit non-zero rather than masking the absence.
 *   Platform/path construction goes through `getSocketHomePath()` from
 *   `@socketsecurity/lib-stable/paths/socket` so darwin / linux / win32 all
 *   resolve correctly. Cross-platform spawn lifecycle via `spawn` from
 *   `@socketsecurity/lib-stable/spawn` with `shell: WIN32` for Windows
 *   .exe/.cmd resolution. Wired in via `package.json`: "janus": "node
 *   scripts/janus.mts". Byte-identical across every fleet repo.
 *   Sync-scaffolding flags drift.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { getSocketHomePath } from '@socketsecurity/lib-stable/paths/socket'
import { spawn } from '@socketsecurity/lib-stable/spawn/spawn'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

type ToolEntry = {
  version?: string | undefined
  checksums?: Record<string, unknown> | undefined
}

function readJanusEntry(): ToolEntry {
  // The hook's external-tools.json is the single source of truth for
  // version + supported-platform list. Read it directly rather than
  // pinning a version here — drift between the installer and this
  // launcher would silently point at a missing dir.
  const configPath = path.join(
    __dirname,
    '..',
    '.claude',
    'hooks',
    'setup-security-tools',
    'external-tools.json',
  )
  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as {
    tools?: Record<string, ToolEntry> | undefined
  }
  const entry = raw.tools?.['janus']
  if (!entry) {
    throw new Error(
      `janus entry missing from ${configPath}; run \`pnpm run setup-security-tools\` to repair the hook`,
    )
  }
  return entry
}

function getPlatformKey(): string {
  return `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
}

async function main(): Promise<void> {
  const entry = readJanusEntry()
  const platformKey = getPlatformKey()

  if (!entry.checksums?.[platformKey]) {
    logger.info(
      `janus has no upstream build for ${platformKey} (currently darwin-arm64 only); skipping`,
    )
    return
  }

  const binaryName = process.platform === 'win32' ? 'janus.exe' : 'janus'
  const binaryPath = path.join(
    getSocketHomePath(),
    '_wheelhouse',
    'janus',
    entry.version!,
    platformKey,
    binaryName,
  )

  if (!existsSync(binaryPath)) {
    logger.info(
      `janus not installed at ${binaryPath}; run "pnpm run setup-security-tools" to install`,
    )
    process.exitCode = 1
    return
  }

  // process.argv: [node, scripts/janus.mts, ...forwarded].
  const forwardedArgs = process.argv.slice(2)
  try {
    const result = await spawn(binaryPath, forwardedArgs, {
      stdio: 'inherit',
      shell: WIN32,
    })
    process.exitCode = result.code ?? 1
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e) {
      const code = (e as { code: unknown }).code
      process.exitCode = typeof code === 'number' ? code : 1
      return
    }
    throw e
  }
}

main().catch((e: unknown) => {
  logger.error(e)
  process.exitCode = 1
})
