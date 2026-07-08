#!/usr/bin/env node
/**
 * @file `check --all` gate: the headroom-ai install enforces the telemetry +
 *   model-download lockdown. headroom ships an anonymous telemetry beacon ON BY
 *   DEFAULT (POSTs aggregate stats to a headroom Supabase) and fetches a
 *   compression model from HuggingFace on first use. The installed
 *   `bin/headroom` wrapper exports HEADROOM_LOCKDOWN_ENV before exec,
 *   disabling both for every invocation. This check IMPORTS the typed
 *   lockdown exports (never source-sniffs — per socket/no-source-sniffing) and
 *   asserts (1) the lockdown disables telemetry AND the model fetch, and (2)
 *   the generated wrapper actually exports them before exec. The lib also
 *   throws at import if the lockdown is weakened (fail-closed), so a regression
 *   fails here AND at every `bin/headroom` build. Usage: node
 *   scripts/fleet/check/headroom-is-telemetry-locked-down.mts [--quiet]
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Headroom installer lib: depth-independent join from the repo root so this
// path stays correct when scripts/fleet/check/ gains or loses a nesting level.
const HEADROOM_LIB = path.join(
  REPO_ROOT,
  '.claude/hooks/fleet/setup-security-tools/lib/headroom.mts',
)

async function main(): Promise<number> {
  if (!existsSync(HEADROOM_LIB)) {
    logger.log(
      'headroom-is-telemetry-locked-down: no headroom installer (n/a).',
    )
    return 0
  }
  // Import the typed exports. The module THROWS at import if HEADROOM_LOCKDOWN_ENV
  // was weakened (fail-closed) — so a failed import is itself a lockdown failure.
  let mod: {
    HEADROOM_LOCKDOWN_ENV: Readonly<Record<string, string>>
    lockdownViolations: (env: Readonly<Record<string, string>>) => string[]
    lockdownWrapperScript: (venvBin: string) => string
  }
  try {
    mod = await import(HEADROOM_LIB)
  } catch (e) {
    logger.fail(
      'headroom-is-telemetry-locked-down: the headroom lockdown is weakened (module import threw).',
    )
    logger.error(`  ${errorMessage(e)}`) // socket-lint: allow logger-decoration
    logger.error(
      '  fix:   restore HEADROOM_LOCKDOWN_ENV (HEADROOM_TELEMETRY=off + HF_HUB_OFFLINE=1) in headroom.mts',
    )
    return 1
  }

  const violations = mod.lockdownViolations(mod.HEADROOM_LOCKDOWN_ENV)
  if (violations.length) {
    logger.fail(
      'headroom-is-telemetry-locked-down: HEADROOM_LOCKDOWN_ENV does not disable telemetry + model fetch.',
    )
    for (let i = 0, { length } = violations; i < length; i += 1) {
      logger.error(`  ✗ ${violations[i]!}`)
    }
    return 1
  }

  // The generated bin/headroom wrapper must export the lockdown env BEFORE the
  // exec — otherwise a wrapper that execs first leaks the first telemetry beacon.
  const wrapper = mod.lockdownWrapperScript('/x/headroom')
  const execIdx = wrapper.indexOf('exec ')
  const missing = Object.keys(mod.HEADROOM_LOCKDOWN_ENV).filter(k => {
    const idx = wrapper.indexOf(`export ${k}=`)
    return idx === -1 || (execIdx !== -1 && idx > execIdx)
  })
  if (missing.length) {
    logger.fail(
      'headroom-is-telemetry-locked-down: the bin/headroom wrapper does not export the lockdown env before exec.',
    )
    logger.error(`  missing/late: ${missing.join(', ')}`)
    return 1
  }

  if (!process.argv.includes('--quiet')) {
    logger.success(
      'headroom-is-telemetry-locked-down: telemetry + model fetch are forced off for every invocation.',
    )
  }
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(code => {
    process.exitCode = code
  })
}
