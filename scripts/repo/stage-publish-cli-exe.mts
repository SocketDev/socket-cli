/**
 * @file Staged-publish runner for the `@socketsecurity/cli.exe.<triplet>` tail
 *   family and the `socket` wrapper. The cascade-owned npm-publish surface
 *   stages exactly one package — the repo-root manifest — so this repo-owned
 *   runner covers the multi-package cli.exe family instead: it guards each
 *   requested package directory (name, stamped version, payload presence, no
 *   private field, no lingering placeholders) and runs `pnpm stage publish`
 *   from it. Staging only — approval stays a human step: `pnpm stage list` +
 *   `pnpm stage approve <id>` locally with 2FA. DRY-RUN by default; pass
 *   --publish to upload to npm staging for real. `--provenance` is added
 *   automatically under GITHUB_ACTIONS so OIDC trusted publishing applies.
 *   Usage: node scripts/repo/stage-publish-cli-exe.mts --version=2.1.0
 *   --triplets=buildable [--stamp] [--list] node
 *   scripts/repo/stage-publish-cli-exe.mts --version=2.1.0
 *   --triplets=darwin-arm64,linux-x64 --publish node
 *   scripts/repo/stage-publish-cli-exe.mts --version=2.1.0 --wrapper --stamp
 *   --publish.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  CLI_EXE_TRIPLETS,
  cliExeBinaryName,
  cliExePackageName,
  isCliExeTriplet,
} from 'package-builder/scripts/cli-exe-targets.mts'
import type { CliExeTriplet } from 'package-builder/scripts/cli-exe-targets.mts'
import {
  getCliExeBinaryPath,
  getCliExePackageDir,
  getPackageOutDir,
} from 'package-builder/scripts/paths.mts'
import { preparePackageForPublish } from 'package-builder/scripts/util/prepare-package.mts'

const logger = getDefaultLogger()

interface StagePublishArgs {
  list?: boolean | undefined
  publish?: boolean | undefined
  stamp?: boolean | undefined
  tag: string
  triplets?: string | undefined
  version?: string | undefined
  wrapper?: boolean | undefined
}

interface StageTarget {
  readonly dir: string
  readonly name: string
  readonly payloadPath: string
}

interface ParsedManifest {
  readonly name?: string | undefined
  readonly optionalDependencies?: Record<string, string> | undefined
  readonly private?: boolean | undefined
  readonly version?: string | undefined
}

const { values } = parseArgs<StagePublishArgs>({
  options: {
    list: { type: 'boolean' },
    publish: { type: 'boolean' },
    stamp: { type: 'boolean' },
    tag: { default: 'latest', type: 'string' },
    triplets: { type: 'string' },
    version: { type: 'string' },
    wrapper: { type: 'boolean' },
  },
})

function readManifest(dir: string): ParsedManifest | undefined {
  const manifestPath = path.join(dir, 'package.json')
  if (!existsSync(manifestPath)) {
    return undefined
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as ParsedManifest
}

/**
 * Resolve the requested triplet list. `all` is the full 8-triplet set,
 * `buildable` is the subset whose SEA binary is already stamped into the tail
 * (the win32 pair stays unbuildable while the frozen node-smol win stubs
 * refuse injection), and a comma list picks triplets explicitly.
 */
function resolveTriplets(spec: string): readonly CliExeTriplet[] | undefined {
  if (spec === 'all') {
    return CLI_EXE_TRIPLETS
  }
  if (spec === 'buildable') {
    return CLI_EXE_TRIPLETS.filter(t => existsSync(getCliExeBinaryPath(t)))
  }
  const parts = spec.split(',').map(part => part.trim())
  const triplets: CliExeTriplet[] = []
  for (let i = 0, { length } = parts; i < length; i += 1) {
    const part = parts[i]
    if (!isCliExeTriplet(part)) {
      logger.error(
        `Unknown triplet "${part}" — expected one of: ${CLI_EXE_TRIPLETS.join(', ')}, or all/buildable`,
      )
      return undefined
    }
    triplets.push(part)
  }
  return triplets
}

/**
 * Guard one package directory: manifest present, name as expected, version
 * stamped to the requested release, private stripped, payload in place, and —
 * for the wrapper — no `0.0.0-replaced-by-*` placeholders left in
 * optionalDependencies.
 */
function guardTarget(target: StageTarget, version: string): boolean {
  const manifest = readManifest(target.dir)
  if (!manifest) {
    logger.error(`${target.name}: no package.json at ${target.dir}`)
    return false
  }
  if (manifest.name !== target.name) {
    logger.error(
      `${target.dir}: manifest names ${manifest.name}, expected ${target.name}`,
    )
    return false
  }
  if (manifest.version !== version) {
    logger.error(
      `${target.name}: version is ${manifest.version}, expected ${version} — run the prepublish stamp first (or pass --stamp)`,
    )
    return false
  }
  if (manifest.private) {
    logger.error(
      `${target.name}: still private — run the prepublish stamp first (or pass --stamp)`,
    )
    return false
  }
  if (!existsSync(target.payloadPath)) {
    logger.error(`${target.name}: payload missing at ${target.payloadPath}`)
    return false
  }
  const placeholders = Object.entries(
    manifest.optionalDependencies ?? {},
  ).filter(({ 1: range }) => range.startsWith('0.0.0-replaced-by-'))
  if (placeholders.length) {
    logger.error(
      `${target.name}: optionalDependencies still carry placeholders: ${placeholders.map(({ 0: dep }) => dep).join(', ')}`,
    )
    return false
  }
  return true
}

async function stageTarget(
  target: StageTarget,
  config: { dryRun: boolean; tag: string },
): Promise<boolean> {
  const args = [
    'stage',
    'publish',
    '--access',
    'public',
    '--tag',
    config.tag,
    '--no-git-checks',
    '--ignore-scripts',
  ]
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    args.push('--provenance')
  }
  if (config.dryRun) {
    args.push('--dry-run')
  }
  logger.log(`pnpm ${args.join(' ')}  (cwd: ${target.dir})`)
  let code: number
  try {
    const result = await spawn('pnpm', args, {
      cwd: target.dir,
      stdio: 'inherit',
    })
    // The spawn helper reports null on signal termination.
    code = result.code ?? 1
  } catch (e) {
    // Non-zero exits reject; the error carries the exit code.
    const errCode =
      e && typeof e === 'object' && 'code' in e ? e.code : undefined
    code = typeof errCode === 'number' ? errCode : 1
  }
  if (code !== 0) {
    logger.fail(`${target.name}: pnpm stage publish exited ${code}`)
    return false
  }
  return true
}

async function main(): Promise<void> {
  const {
    list,
    publish,
    stamp,
    tag,
    triplets: tripletsSpec,
    version: providedVersion,
  } = values

  if (!providedVersion) {
    logger.error('--version is required')
    process.exitCode = 1
    return
  }
  if (!tripletsSpec && !values.wrapper) {
    logger.error(
      'Nothing to stage — pass --triplets=<all|buildable|csv> and/or --wrapper',
    )
    process.exitCode = 1
    return
  }
  const version = providedVersion.replace(/^v/, '')

  const targets: StageTarget[] = []
  if (tripletsSpec) {
    const triplets = resolveTriplets(tripletsSpec)
    if (!triplets) {
      process.exitCode = 1
      return
    }
    if (!triplets.length) {
      logger.error('No buildable triplets found — run the SEA build first')
      process.exitCode = 1
      return
    }
    for (const triplet of triplets) {
      const dir = getCliExePackageDir(triplet)
      if (stamp) {
        preparePackageForPublish(dir, { buildMethod: 'sea', version })
      }
      targets.push({
        dir,
        name: cliExePackageName(triplet),
        payloadPath: path.join(dir, 'bin', cliExeBinaryName(triplet)),
      })
    }
  }
  if (values.wrapper) {
    const dir = getPackageOutDir('socket')
    if (stamp) {
      // Also rewrites the wrapper's `0.0.0-replaced-by-publish` cli.exe
      // optionalDependencies to this version (lockstep); the frozen
      // @socketbin/* pins stay put.
      preparePackageForPublish(dir, { version })
    }
    targets.push({
      dir,
      name: 'socket',
      payloadPath: path.join(dir, 'bin', 'socket.js'),
    })
  }

  let ok = true
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]
    if (!target) {
      continue
    }
    ok = guardTarget(target, version) && ok
  }
  if (!ok) {
    process.exitCode = 1
    return
  }

  const dryRun = !publish
  if (list) {
    logger.log('')
    logger.log(
      `Plan (${dryRun ? 'dry-run' : 'PUBLISH'}, tag=${tag}, version=${version}):`,
    )
    for (let i = 0, { length } = targets; i < length; i += 1) {
      const target = targets[i]
      if (!target) {
        continue
      }
      logger.log(`  ${target.name}@${version}  <- ${target.dir}`)
    }
    return
  }

  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]
    if (!target) {
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    const staged = await stageTarget(target, { dryRun, tag })
    if (!staged) {
      process.exitCode = 1
      return
    }
  }

  logger.log('')
  logger.success(
    dryRun
      ? `Dry-run complete for ${targets.length} package${targets.length > 1 ? 's' : ''}. Re-run with --publish to upload to npm staging.`
      : `Staged ${targets.length} package${targets.length > 1 ? 's' : ''}. Approve locally: pnpm stage list, then pnpm stage approve <id> (2FA).`,
  )
}

main().catch((e: unknown) => {
  logger.error(e)
  process.exitCode = 1
})
