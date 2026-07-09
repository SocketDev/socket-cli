#!/usr/bin/env node
/*
 * @file User-invoked installer / health-fixer for the Socket security tools
 *   (AgentShield, SkillSpector, Zizmor, SFW, + TruffleHog/Trivy/OpenGrep/uv/
 *   janus/cdxgen/synp). Runs interactively. Differs from `index.mts` (the Stop
 *   hook):
 *
 *   - This script PROMPTS for missing config (e.g. SOCKET_API_KEY) and persists
 *     to the OS keychain.
 *   - It DOWNLOADS missing or stale binaries.
 *   - It REPAIRS broken SFW shims (entries pointing to dlx-cache hashes that no
 *     longer exist on disk). The Stop hook only DETECTS and REPORTS.
 *     Auto-prompting / auto- downloading from a Stop hook would surprise the
 *     operator with network calls + interactive flows mid-conversation. Skips
 *     the interactive prompt path when:
 *   - Running in CI (`getCI()` from @socketsecurity/lib-stable/env/ci).
 *   - Stdin isn't a TTY (`!process.stdin.isTTY`). In those skip cases, the script
 *     falls back to sfw-free (the auth- free SFW build) and continues without
 *     persisting a token. Invocation: node
 *     .claude/hooks/fleet/setup-security-tools/install.mts node
 *     .claude/hooks/fleet/setup-security-tools/install.mts --rotate Flags:
 *     --rotate Re-prompt for SOCKET_API_KEY and overwrite the keychain entry,
 *     ignoring env/.env/keychain lookup. Use to rotate a leaked or expired
 *     token without manually clearing the keychain first. --update-token Alias
 *     for --rotate. Exit codes: 0 — all tools installed + verified. 1 — at
 *     least one tool failed; details on stderr.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { findApiToken } from './lib/api-token.mts'
import {
  disableSparkleAutoUpdate,
  offerTokenPrompt,
  parseArgs,
  promptAndPersist,
  wireBridgeIntoShellRc,
} from './lib/operator-prompts.mts'
import {
  findBrokenShimTargets,
  getShimsDir,
  stabilizeShims,
} from './lib/shims.mts'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Walk an existing SFW shim and report whether its dlx-cached binary target
 * still exists. A shim is "broken" when the dlx cache has been evicted (cleanup
 * script, manual delete, manifest rebuild) and the shim points at a path that
 * no longer resolves.
 */
export async function findBrokenShims(): Promise<string[]> {
  const shimsDir = getShimsDir()
  if (!existsSync(shimsDir)) {
    return []
  }
  const broken: string[] = []
  const entries = await fs.readdir(shimsDir)
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const shimPath = path.join(shimsDir, entry)
    let content: string
    try {
      content = await fs.readFile(shimPath, 'utf8')
    } catch {
      continue
    }
    // Only bash shim files carry exec targets; binaries/symlinks in the same
    // bin dir (flat racked-tool handles) have no quoted paths and skip clean.
    if (!content.startsWith('#!')) {
      continue
    }
    if (findBrokenShimTargets(content).length > 0) {
      broken.push(entry)
    }
  }
  return broken
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  logger.log('Socket security tools — install / verify')
  logger.log('')

  let apiToken: string | undefined
  if (args.rotate) {
    // Rotation path: skip the lookup so a stale env/.env doesn't
    // short-circuit the re-prompt, and overwrite the keychain entry
    // unconditionally. If the user presses Enter without typing, the
    // existing keychain value stays in place — we fall through to the
    // normal lookup below so downstream installers still get the
    // pre-rotation token.
    const fresh = await promptAndPersist(logger, 'rotate')
    if (fresh) {
      apiToken = fresh
    } else {
      const lookup = findApiToken()
      apiToken = lookup.token
      if (apiToken && lookup.source) {
        logger.log(`Keeping existing SOCKET_API_KEY (via ${lookup.source}).`)
      }
    }
  } else {
    // Existing token state — env > .env > keychain.
    const lookup = findApiToken()
    apiToken = lookup.token
    if (apiToken && lookup.source) {
      logger.log(`SOCKET_API_KEY: found via ${lookup.source}.`)
    } else {
      apiToken = await offerTokenPrompt(logger)
    }
  }

  // Wire the literal token into the shell rc unconditionally. The
  // token may have come from env/keychain (no prompt fired) —
  // without this block, every NEW shell session launches with an
  // empty SOCKET_API_KEY and Socket tools return 401. We embed the
  // token VALUE directly in the rc instead of calling `security
  // find-generic-password` from the shell, because the latter
  // triggers a macOS Keychain auth prompt on every new shell
  // (Claude Code's Bash tool spawns one per command — see the
  // 2026-05-15 incident memory). Idempotent: same-value re-run is
  // outcome=unchanged. Rotate writes a fresh block.
  if (apiToken) {
    wireBridgeIntoShellRc(logger, apiToken)
  }

  // Disable Sparkle auto-update for fleet-tooling GUI apps (e.g. OrbStack) so a
  // self-update can't swap a tool version mid-task or pull off the soak gate.
  disableSparkleAutoUpdate(logger)

  // Broken-shim detection. When the dlx cache rotates (cleanup, manifest
  // rebuild, manual deletion), shims keep pointing at the old hash and
  // every shimmed command fails with "No such file or directory."
  // Repair = reinstall SFW, which rewrites the shims at the new hash.
  const broken = await findBrokenShims()
  if (broken.length > 0) {
    logger.warn(
      `Found ${broken.length} broken SFW shim(s): ${broken.join(', ')}. ` +
        'These point to a dlx-cache target that no longer exists. ' +
        'Reinstalling SFW will rewrite the shims.',
    )
  }

  const installers = (await import('./lib/installers.mts')) as {
    setupAgentShield: () => Promise<boolean>
    setupSkillSpector: () => Promise<boolean>
    setupZizmor: () => Promise<boolean>
    setupSfw: (apiToken: string | undefined) => Promise<boolean>
    setupTrufflehog: () => Promise<boolean>
    setupTrivy: () => Promise<boolean>
    setupOpengrep: () => Promise<boolean>
    setupUv: () => Promise<boolean>
    setupJanus: () => Promise<boolean>
    setupCdxgen: () => Promise<boolean>
    setupSynp: () => Promise<boolean>
  }

  const agentshieldOk = await installers.setupAgentShield()
  logger.log('')
  const skillspectorOk = await installers.setupSkillSpector()
  logger.log('')
  const zizmorOk = await installers.setupZizmor()
  logger.log('')
  const sfwOk = await installers.setupSfw(apiToken)
  logger.log('')
  const [trufflehogOk, trivyOk, opengrepOk, uvOk, janusOk, cdxgenOk, synpOk] =
    await Promise.all([
      installers.setupTrufflehog(),
      installers.setupTrivy(),
      installers.setupOpengrep(),
      installers.setupUv(),
      installers.setupJanus(),
      installers.setupCdxgen(),
      installers.setupSynp(),
    ])
  // Stabilize any dlx-backed shims the installs above just (re)wrote: mirror
  // their targets into the GC-stable dir and repoint the shim, so the next dlx
  // sweep can't orphan them (the recurring broken-headroom-shim failure). Runs
  // now, while the freshly-installed dlx sources still exist to mirror.
  const stabilized = await stabilizeShims()
  if (stabilized.length > 0) {
    logger.log(
      `Stabilized ${stabilized.length} shim(s) against dlx GC: ${stabilized.join(', ')}`,
    )
  }
  // Native messaging host — optional step (only runs when the lib exports it).
  // Allows the Chrome Trusted Publisher extension to call the OS keychain
  // without the user having to set SOCKET_API_TOKEN in their browser environment.
  const nativeHostOk = true
  try {
    const { installNativeHost, HOST_NAME } =
      await import('@socketsecurity/lib-stable/native-messaging/install')
    const result = installNativeHost({ allowedOrigins: ['*'] })
    logger.log(`Native host:  installed → ${result.manifestPaths.join(', ')}`)
    logger.log(`              name: ${HOST_NAME}`)
  } catch {
    // Not yet built or not available — skip silently. The extension falls
    // back to SOCKET_API_TOKEN env var or the review-service token path.
    logger.log('Native host:  skipped (not available in this build)')
  }
  logger.log('')

  logger.log('=== Summary ===')
  logger.log(`AgentShield:  ${agentshieldOk ? 'ready' : 'NOT AVAILABLE'}`)
  logger.log(`cdxgen:       ${cdxgenOk ? 'ready' : 'FAILED'}`)
  logger.log(`janus:        ${janusOk ? 'ready' : 'FAILED'}`)
  logger.log(`Native host:  ${nativeHostOk ? 'ready' : 'FAILED'}`)
  logger.log(`OpenGrep:     ${opengrepOk ? 'ready' : 'FAILED'}`)
  logger.log(`SFW:          ${sfwOk ? 'ready' : 'FAILED'}`)
  logger.log(
    `SkillSpector: ${skillspectorOk ? 'ready' : 'OPTIONAL (uv required)'}`,
  )
  logger.log(`synp:         ${synpOk ? 'ready' : 'FAILED'}`)
  logger.log(`Trivy:        ${trivyOk ? 'ready' : 'FAILED'}`)
  logger.log(`TruffleHog:   ${trufflehogOk ? 'ready' : 'FAILED'}`)
  logger.log(`uv:           ${uvOk ? 'ready' : 'FAILED'}`)
  logger.log(`Zizmor:       ${zizmorOk ? 'ready' : 'FAILED'}`)

  const allOk =
    agentshieldOk &&
    cdxgenOk &&
    janusOk &&
    nativeHostOk &&
    opengrepOk &&
    sfwOk &&
    synpOk &&
    trivyOk &&
    trufflehogOk &&
    uvOk &&
    zizmorOk
  if (allOk) {
    logger.log('')
    logger.log('All security tools ready.')
  } else {
    logger.error('')
    logger.warn('Some tools not available. See above.')
    process.exitCode = 1
  }
}

void __dirname

main().catch((e: unknown) => {
  const msg = errorMessage(e)
  logger.error(`setup-security-tools install: ${msg}`)
  process.exitCode = 1
})
