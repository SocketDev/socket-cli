// Janus installer — the shared multi-Janus wheelhouse binary. Ships a
// darwin-arm64 build only; installs into the shared
// ~/.socket/_wheelhouse/janus/<version>/ dir so every fleet member's hook
// reuses the same binary. Lives in its own file because installers.mts is at
// the 500-line soft cap.

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getSocketHomePath } from '@socketsecurity/lib-stable/paths/socket'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { runInstallGitHubReleaseTool } from './github-release.mts'
import { resolvePlatformEntry } from './installers.mts'
import { JANUS } from './tool-config.mts'

const logger = getDefaultLogger()
// This file lives at `.claude/hooks/fleet/setup-security-tools/lib/janus.mts`,
// so its own location is five levels below the project root — used only as
// the last-resort fallback when the agent runner hasn't set
// CLAUDE_PROJECT_DIR. Named HERE rather than __dirname: findUpPackageJson()
// would resolve to this hook's OWN package.json
// (`setup-security-tools/package.json`, a per-hook dependency manifest), not
// the actual project root being set up.
const HERE = path.dirname(fileURLToPath(import.meta.url))

/**
 * Best-effort `janus init` so a repo that just received the janus binary has a
 * `.janus/` queue without a manual step. Per docs/agents.md/fleet/release-vs-
 * cascade.md, `.janus/` is gitignored + created per-repo at setup (never seeded
 * from the release — the queue is repo-local + dynamic, and `janus init` is the
 * canonical creator). Idempotent (skips when `.janus/` already exists) and
 * NON-FATAL: a failure never fails the security-tools setup — the multi-Janus
 * shim simply treats a missing queue as "not adopted yet".
 */
export async function runEnsureJanusQueue(janusBin: string): Promise<void> {
  // Anchor on this hook's own location rather than process.cwd() — the agent
  // runner may invoke this from any directory. CLAUDE_PROJECT_DIR (set by the
  // hook runner) is authoritative; the walk-up from lib/ (five levels to the
  // project root) is the last-resort fallback, mirroring index.mts's HERE-based
  // fallback for the same hook.
  const repoRoot =
    process.env['CLAUDE_PROJECT_DIR'] ??
    path.join(HERE, '..', '..', '..', '..', '..')
  if (existsSync(path.join(repoRoot, '.janus'))) {
    return
  }
  try {
    await spawn(janusBin, ['init'], { cwd: repoRoot, stdio: 'ignore' })
    logger.log('janus: initialized .janus/ queue')
  } catch {
    // Non-fatal: `janus init` is a convenience, not a setup gate.
  }
}

export async function runSetupJanus(): Promise<boolean> {
  // janus ships a darwin-arm64 binary only (upstream builds one platform; the
  // version is pinned in external-tools.json). On every other platform,
  // skip the install with a quiet log rather than emitting a warning —
  // janus isn't a fleet-critical dependency, just a tool some Socket
  // workflows opt into. Install lands in the shared
  // ~/.socket/_wheelhouse/janus/<version>/ dir so every fleet member's
  // hook reuses the same binary.
  const { entry: janusEntry, platformKey } = resolvePlatformEntry(
    JANUS.platforms,
  )
  if (!janusEntry) {
    logger.log('=== janus ===')
    logger.log(`Skipped: no janus build for ${platformKey} (mac-arm64 only)`)
    return true
  }
  const installDir = path.join(
    getSocketHomePath(),
    '_wheelhouse',
    'janus',
    JANUS.version!,
    platformKey,
  )
  const installed = await runInstallGitHubReleaseTool({
    name: 'janus',
    displayName: 'janus',
    tool: JANUS,
    binaryNameInArchive: 'janus',
    finalBinaryName: 'janus',
    installDir,
  })
  if (installed) {
    await runEnsureJanusQueue(path.join(installDir, 'janus'))
  }
  return installed
}
