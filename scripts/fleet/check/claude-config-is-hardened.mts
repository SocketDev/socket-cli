// Fleet check — the global Claude config (`~/.claude.json`) stays hardened.
//
// `scripts/fleet/setup/claude-config.mts` sets the fleet's hardened global-only
// keys (currently `copyOnSelect: false`, which stops the TUI's OSC-52
// clipboard escape + the iTerm2 "terminal attempted to access the clipboard"
// banner). Those keys live in the user's `~/.claude.json` (a global-only config
// the client reads via getGlobalConfig — they can't be cascaded as a repo
// file), so without a gate they silently drift back the moment the client
// rewrites the config or the user toggles the setting in-app. This check is the
// continuous-enforcement half: it fails `check --all` when a hardened key has
// drifted from its required value, pointing at the one-line setup re-run.
//
// Absent `~/.claude.json` is tolerated (fresh machine / CI without a global
// config) — there's nothing to drift, and the setup step writes it when the
// client first creates it.
//
// Usage: node scripts/fleet/check/claude-config-is-hardened.mts [--quiet]

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  globalConfigPath,
  HARDENED_GLOBAL_CONFIG,
} from '../setup/claude-config.mts'

const logger = getDefaultLogger()

export interface HardeningViolation {
  key: string
  expected: unknown
  actual: unknown
}

// The hardened keys whose value drifted from the fleet's requirement. Empty =
// hardened. Pure — the test drives it directly.
export function hardeningViolations(
  config: Record<string, unknown>,
): HardeningViolation[] {
  const out: HardeningViolation[] = []
  for (const key of Object.keys(HARDENED_GLOBAL_CONFIG)) {
    const expected = HARDENED_GLOBAL_CONFIG[key]
    if (config[key] !== expected) {
      out.push({ key, expected, actual: config[key] })
    }
  }
  return out
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const configPath = globalConfigPath()
  if (!existsSync(configPath)) {
    if (!quiet) {
      logger.log('~/.claude.json absent — nothing to harden; check skipped.')
    }
    return
  }
  let config: Record<string, unknown>
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
      string,
      unknown
    >
  } catch (error) {
    logger.error(
      `~/.claude.json is not valid JSON (${errorMessage(error)}); cannot verify hardening. Fix the file, then re-run.`,
    )
    process.exitCode = 1
    return
  }
  const violations = hardeningViolations(config)
  if (violations.length > 0) {
    logger.error(
      `Global Claude config has drifted from the fleet hardening (${violations.length}):`,
    )
    for (const v of violations) {
      logger.error(
        `  ${v.key}: is ${JSON.stringify(v.actual)}, must be ${JSON.stringify(v.expected)}`,
      )
    }
    logger.error(
      'Re-run `node scripts/fleet/setup/claude-config.mts` to re-apply. (copyOnSelect: false stops the TUI OSC-52 clipboard banner.)',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success('Global Claude config is hardened (copyOnSelect: false).')
  }
}

if (process.argv[1]?.endsWith('claude-config-is-hardened.mts')) {
  main()
}
