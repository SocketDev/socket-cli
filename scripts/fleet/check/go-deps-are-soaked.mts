#!/usr/bin/env node
/**
 * @file Fail-closed soak gate for Go modules. Go has NO native minimum-release
 *   age, so this is the enforcement: every own `go.mod` require (except a
 *   soak-excluded module) must pin a version published at least `SOAK_DAYS`
 *   ago, verified against the GOPROXY publish time. A dep still inside the soak
 *   window fails the gate — a compromised fresh publish can't be adopted, and a
 *   warning would not have stopped it. Pure `partitionSoakExcluded` is
 *   unit-tested; `findGoSoakViolations` is the fs + proxy glue (injectable
 *   fetch for tests). No-op (exit 0) in a repo without an own `go.mod`. Network
 *   goes through `go.mts`'s GOPROXY chain. Usage: node
 *   scripts/fleet/check/go-deps-are-soaked.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { SOAK_DAYS } from '../constants/soak.mts'
import {
  GO_SOAK_EXCLUDES,
  isSoakExcluded,
} from '../constants/soak-excludes.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import {
  checkModuleAges,
  fetchVersionTimeWithFallback,
  findGoModFiles,
  formatDays,
  parseGoMod,
  parseGoProxyChain,
} from '../update/go.mts'

import type { SoakExclude } from '../constants/soak-excludes.mts'
import type { GoModule, Violation } from '../update/go.mts'

const logger = getDefaultLogger()

/**
 * Split parsed modules into the ones the soak gate enforces and the excluded
 * ones (pure — the unit-test target).
 */
export function partitionSoakExcluded(
  modules: readonly GoModule[],
  excludes: readonly SoakExclude[],
): { enforced: GoModule[]; excluded: GoModule[] } {
  const enforced: GoModule[] = []
  const excluded: GoModule[] = []
  for (let i = 0, { length } = modules; i < length; i += 1) {
    const mod = modules[i]!
    if (isSoakExcluded(excludes, mod.module)) {
      excluded.push(mod)
    } else {
      enforced.push(mod)
    }
  }
  return { enforced, excluded }
}

/**
 * Every soak violation across the repo's own go.mod files. `fetchTime` resolves
 * a module version's publish time; it defaults to the GOPROXY chain and is
 * injected in tests.
 */
export async function findGoSoakViolations(
  root: string,
  soakDays: number,
  now: Date,
  fetchTime?: ((module: string, version: string) => Promise<Date>) | undefined,
): Promise<Violation[]> {
  const entries = parseGoProxyChain(process.env['GOPROXY'])
  const resolve =
    fetchTime ??
    ((module: string, version: string): Promise<Date> =>
      fetchVersionTimeWithFallback(entries, module, version))
  const violations: Violation[] = []
  for (const goModFile of findGoModFiles(root)) {
    if (!existsSync(goModFile)) {
      continue
    }
    const { enforced } = partitionSoakExcluded(
      parseGoMod(readFileSync(goModFile, 'utf8')),
      GO_SOAK_EXCLUDES,
    )
    if (enforced.length === 0) {
      continue
    }
    violations.push(
      ...(await checkModuleAges(enforced, soakDays, now, resolve)),
    )
  }
  return violations
}

async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  const violations = await findGoSoakViolations(
    REPO_ROOT,
    SOAK_DAYS,
    new Date(),
  )
  if (violations.length > 0) {
    logger.fail(
      `[go-deps-are-soaked] ${violations.length} Go dep(s) are inside the ` +
        `${SOAK_DAYS}-day soak window — a fresh publish can't be adopted:`,
    )
    for (let i = 0, { length } = violations; i < length; i += 1) {
      const v = violations[i]!
      logger.error(
        `  ✗ ${v.module}@${v.version} — ${formatDays(v.remainingMs)} left of ` +
          `${SOAK_DAYS}d soak`,
      )
    }
    logger.error(
      '  Fix: pin to a soaked version (`node scripts/fleet/update/go.mts ' +
        `--apply --soak-days ${SOAK_DAYS}\`), or add a dated GO_SOAK_EXCLUDES ` +
        'entry (scripts/fleet/constants/soak-excludes.mts) if it is deliberate.',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      `[go-deps-are-soaked] all Go deps clear the ${SOAK_DAYS}d soak.`,
    )
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
