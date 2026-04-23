/**
 * Comprehensive build script with intelligent caching.
 *
 * Builds packages in the correct order:
 * 1. CLI package (TypeScript compilation and bundling)
 * 2. SEA binary for current platform (only with --force)
 *
 * Note: Yoga WASM and node-smol binaries are downloaded from socket-btm during CLI build.
 *
 * Usage:
 *   pnpm run build                           # Smart build (skips unchanged)
 *   pnpm run build --force                   # Force rebuild all + SEA for current platform
 *   pnpm run build:sea                       # Build SEA binaries for all platforms
 *   pnpm run build --target <name>           # Build specific target
 *   pnpm run build --targets <t1,t2,...>     # Build multiple targets
 *   pnpm run build --platforms               # Build all platform binaries
 *   pnpm run build --platforms --parallel    # Build platforms in parallel
 *   pnpm run build --help                    # Show this help
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import fg from 'fast-glob'

import colors from 'yoctocolors-cjs'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { CHECKPOINTS } from '../packages/build-infra/lib/constants.mts'
import {
  PLATFORM_TARGETS,
  formatPlatformTarget,
  parsePlatformTarget,
} from '../packages/build-infra/lib/platform-targets.mts'
import { runPipelineCli } from '../packages/build-infra/lib/build-pipeline.mts'

const logger = getDefaultLogger()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const TARGET_PACKAGES: Record<string, string> = {
  __proto__: null as unknown as string,
  all: './packages/**',
  cli: '@socketsecurity/cli',
  'cli-sentry': '@socketsecurity/cli-with-sentry',
  node: '@socketbin/node-smol-builder-builder',
  sea: '@socketbin/node-sea-builder-builder',
  socket: 'socket',
}

interface BuildPackageConfig {
  name: string
  filter: string
  outputCheck: string
  /**
   * Glob patterns (repo-relative) whose file contents contribute to the build
   * signature. A change to any matching file invalidates the cache and forces
   * a rebuild.
   */
  inputs: string[]
}

interface BuildResult {
  success: boolean
  skipped: boolean
}

interface BuildTargetResult {
  duration: string
  success: boolean
  target: string
}

interface ParsedArgs {
  arch: string | undefined
  buildArgs: string[]
  force: boolean
  help: boolean
  parallel: boolean
  platform: string | undefined
  platforms: boolean
  target: string | undefined
  targets: string[]
}

/**
 * Build configuration for each package in the default build order.
 */
const BUILD_PACKAGES: BuildPackageConfig[] = [
  {
    name: 'CLI Package',
    filter: '@socketsecurity/cli',
    outputCheck: 'packages/cli/dist/index.js',
    inputs: [
      'packages/cli/.config/**/*.{mts,ts,json}',
      'packages/cli/scripts/**/*.{mts,ts}',
      'packages/cli/src/**/*.{mts,ts,cts,json}',
      'packages/cli/package.json',
      'packages/cli/tsconfig.json',
      'packages/build-infra/lib/**/*.{mts,ts}',
      'packages/build-infra/package.json',
      'pnpm-lock.yaml',
      '.node-version',
    ],
  },
]

/**
 * Compute a SHA-256 signature over the contents of files matched by the
 * package's input globs. Files are sorted to keep the hash deterministic.
 */
function computeBuildSignature(pkg: BuildPackageConfig): string {
  const files = fg.sync(pkg.inputs, {
    cwd: rootDir,
    onlyFiles: true,
    dot: true,
    absolute: true,
  })
  files.sort()

  const hash = createHash('sha256')
  for (const file of files) {
    const relative = path.relative(rootDir, file)
    hash.update(relative)
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * Path to the sidecar signature file written alongside the build output.
 */
function signaturePath(pkg: BuildPackageConfig): string {
  return path.join(rootDir, `${pkg.outputCheck}.build-signature`)
}

function readSignature(pkg: BuildPackageConfig): string | null {
  const file = signaturePath(pkg)
  if (!existsSync(file)) {
    return null
  }
  return readFileSync(file, 'utf8').trim()
}

function writeSignature(pkg: BuildPackageConfig, signature: string): void {
  writeFileSync(signaturePath(pkg), `${signature}\n`, 'utf8')
}

/**
 * Parse command line arguments.
 */
function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2)
  let target: string | undefined
  let targets: string[] = []
  let platforms = false
  let parallel = false
  let force = false
  let help = false
  let platform: string | undefined
  let arch: string | undefined
  const buildArgs: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--target' && i + 1 < args.length) {
      target = args[++i]
    } else if (arg === '--targets' && i + 1 < args.length) {
      targets = args[++i]!.split(',').map(t => t.trim())
    } else if (arg === '--platform' && i + 1 < args.length) {
      platform = args[++i]
    } else if (arg.startsWith('--platform=')) {
      platform = arg.split('=')[1]
    } else if (arg === '--arch' && i + 1 < args.length) {
      arch = args[++i]
    } else if (arg.startsWith('--arch=')) {
      arch = arg.split('=')[1]
    } else if (arg === '--platforms') {
      platforms = true
    } else if (arg === '--parallel') {
      parallel = true
    } else if (arg === '--force') {
      force = true
    } else if (arg === '--help' || arg === '-h') {
      help = true
    } else {
      buildArgs.push(arg)
    }
  }

  // If --platform and --arch are provided, combine them into target.
  if (platform && arch) {
    target = `${platform}-${arch}`
  }

  return {
    arch,
    buildArgs,
    force,
    help,
    parallel,
    platform,
    platforms,
    target,
    targets,
  }
}

/**
 * Display help message.
 */
function showHelp(): void {
  logger.log('')
  logger.log(`${colors.blue('Socket CLI Build System')}`)
  logger.log('')
  logger.log('Usage:')
  logger.log(
    '  pnpm run build                           # Smart build (skips unchanged)',
  )
  logger.log(
    '  pnpm run build --force                   # Force rebuild all + SEA for current platform',
  )
  logger.log(
    '  pnpm run build:sea                       # Build SEA binaries for all platforms',
  )
  logger.log(
    '  pnpm run build --target <name>           # Build specific target',
  )
  logger.log(
    '  pnpm run build --platform <p> --arch <a> # Build specific platform/arch',
  )
  logger.log(
    '  pnpm run build --targets <t1,t2,...>     # Build multiple targets',
  )
  logger.log(
    '  pnpm run build --platforms               # Build all platform binaries',
  )
  logger.log(
    '  pnpm run build --platforms --parallel    # Build platforms in parallel',
  )
  logger.log('  pnpm run build --help                    # Show this help')
  logger.log('')
  logger.log('Default Build Order:')
  logger.log('  1. CLI Package (TypeScript compilation + bundling)')
  logger.log('  2. SEA Binary for current platform (only with --force)')
  logger.log('')
  logger.log(
    'Note: Yoga WASM and node-smol binaries are downloaded from socket-btm',
  )
  logger.log('      All pre-built binaries are cached in ~/.socket/ directory')
  logger.log('')
  logger.log('Platform Targets:')
  for (const target of PLATFORM_TARGETS) {
    logger.log(`  ${target}`)
  }
  logger.log('')
  logger.log('Other Available Targets:')
  for (const target of Object.keys(TARGET_PACKAGES).sort()) {
    if (!PLATFORM_TARGETS.includes(target)) {
      logger.log(`  ${target}`)
    }
  }
  logger.log('')
}

/**
 * Check if a package needs to be built.
 * Returns true if build is needed, false if can skip.
 *
 * Rebuild triggers:
 *   1. --force
 *   2. Missing build output
 *   3. Missing signature sidecar
 *   4. Current input signature differs from the recorded one
 */
function needsBuild(pkg: BuildPackageConfig, force: boolean): boolean {
  if (force) {
    return true
  }

  const outputPath = path.join(rootDir, pkg.outputCheck)
  if (!existsSync(outputPath)) {
    return true
  }

  const stored = readSignature(pkg)
  if (!stored) {
    return true
  }

  return computeBuildSignature(pkg) !== stored
}

/**
 * Build a single package.
 */
async function buildPackage(
  pkg: BuildPackageConfig,
  force: boolean,
): Promise<BuildResult> {
  const skip = !needsBuild(pkg, force)

  if (skip) {
    logger.log(
      `${colors.cyan('→')} ${pkg.name}: ${colors.gray('skipped (up to date)')}`,
    )
    return { success: true, skipped: true }
  }

  logger.log(`${colors.cyan('→')} ${pkg.name}: ${colors.blue('building...')}`)

  const buildScript = force ? 'build:force' : 'build'
  const args = ['--filter', pkg.filter, 'run', buildScript]

  const startTime = Date.now()
  const result = await spawn('pnpm', args, {
    shell: WIN32,
    stdio: 'inherit',
  })
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)

  if (result.code !== 0) {
    logger.log(
      `${colors.red('✗')} ${pkg.name}: ${colors.red('failed')} (${duration}s)`,
    )
    return { success: false, skipped: false }
  }

  logger.log(
    `${colors.green('✓')} ${pkg.name}: ${colors.green('built')} (${duration}s)`,
  )

  try {
    writeSignature(pkg, computeBuildSignature(pkg))
  } catch (e) {
    logger.warn(
      `Could not write build signature for ${pkg.name}: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  return { success: true, skipped: false }
}

/**
 * Build SEA binary for current platform.
 */
async function buildCurrentPlatformSea(): Promise<{ success: boolean }> {
  const { arch, platform } = await import('node:os')
  const currentPlatform = platform()
  const currentArch = arch()

  logger.log('')
  logger.log(
    `${colors.cyan('→')} Building SEA binary for ${currentPlatform}-${currentArch}...`,
  )

  const startTime = Date.now()
  const result = await spawn(
    'pnpm',
    [
      '--filter',
      '@socketsecurity/cli',
      'run',
      'build:sea',
      `--platform=${currentPlatform}`,
      `--arch=${currentArch}`,
    ],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)

  if (result.code !== 0) {
    logger.log(`${colors.red('✗')} SEA build failed (${duration}s)`)
    return { success: false }
  }

  logger.log(`${colors.green('✓')} SEA binary built (${duration}s)`)
  return { success: true }
}

/**
 * Run the default smart build — now orchestrated via the shared
 * build-pipeline (same system socket-btm/ultrathink/socket-tui/sdxgen use).
 *
 * Stages:
 *   CLI        build @socketsecurity/cli via pnpm --filter (the existing
 *              buildPackage helper handles signature check + skip-on-cached
 *              inside the workspace; the orchestrator's shouldRun layer
 *              complements with a content-hashed cache key)
 *   SEA        build SEA binary for current platform (only when --force/--prod)
 *   FINALIZED  verify expected outputs exist
 *
 * Inherits CLI flags from runPipelineCli: --force, --clean, --clean-stage,
 * --from-stage, --cache-key, --prod, --dev.
 */
async function runSmartBuild(force: boolean): Promise<void> {
  // The orchestrator reads --force/--clean/... off process.argv itself; we
  // only pass `force` here so the SEA stage knows whether to run.
  const cliPkg = BUILD_PACKAGES[0]!
  const cliOutputPath = path.join(rootDir, cliPkg.outputCheck)

  await runPipelineCli({
    packageRoot: rootDir,
    packageName: 'cli',
    resolvePlatformArch: async () => 'universal',
    getBuildPaths: (mode: string) => ({
      buildDir: path.join(rootDir, 'build', mode),
    }),
    getOutputFiles: () => [cliOutputPath],
    stages: [
      {
        name: CHECKPOINTS.CLI,
        sourcePaths: fg.sync(cliPkg.inputs, {
          cwd: rootDir,
          onlyFiles: true,
          dot: true,
          absolute: true,
        }),
        run: async () => {
          const result = await buildPackage(cliPkg, force)
          if (!result.success) {
            throw new Error(`${cliPkg.name} build failed`)
          }
          return {
            smokeTest: async () => {
              if (!existsSync(cliOutputPath)) {
                throw new Error(`CLI output missing: ${cliOutputPath}`)
              }
            },
          }
        },
      },
      // SEA stage only runs when --force / --prod is set (matches the
      // historical behavior of runSmartBuild — plain `pnpm build` stops
      // after CLI, `pnpm build --force` also builds SEA for the current
      // platform). The skip predicate runs before shouldRun(), so the
      // stage is transparently absent on a normal dev build.
      {
        name: CHECKPOINTS.SEA,
        skip: ctx => !force && ctx.buildMode !== 'prod',
        // Hash the CLI output into this stage's cache key. Without it,
        // shouldRun() only sees external-tools.json + package.json, so a
        // CLI rebuild that leaves those files untouched would skip SEA
        // and leave a stale binary built against the previous dist/index.js.
        sourcePaths: [cliOutputPath],
        run: async () => {
          const seaResult = await buildCurrentPlatformSea()
          if (!seaResult.success) {
            throw new Error('SEA binary build failed')
          }
          return {}
        },
      },
      {
        name: CHECKPOINTS.FINALIZED,
        run: async () => ({
          smokeTest: async () => {
            if (!existsSync(cliOutputPath)) {
              throw new Error(`CLI output missing: ${cliOutputPath}`)
            }
          },
        }),
      },
    ],
  })
}

/**
 * Build SEA binary for a specific platform.
 */
async function buildPlatformSea(
  platform: string,
  arch: string,
  libc: string | undefined,
): Promise<{ success: boolean }> {
  const targetName = formatPlatformTarget(platform, arch, libc)

  logger.log('')
  logger.log(`${colors.cyan('→')} Building SEA binary for ${targetName}...`)

  const seaArgs = [
    '--filter',
    '@socketsecurity/cli',
    'run',
    'build:sea',
    `--platform=${platform}`,
    `--arch=${arch}`,
  ]

  if (libc) {
    seaArgs.push(`--libc=${libc}`)
  }

  const startTime = Date.now()
  const result = await spawn('pnpm', seaArgs, {
    shell: WIN32,
    stdio: 'inherit',
  })
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)

  if (result.code !== 0) {
    logger.log(
      `${colors.red('✗')} SEA build for ${targetName} failed (${duration}s)`,
    )
    return { success: false }
  }

  logger.log(
    `${colors.green('✓')} SEA binary for ${targetName} built (${duration}s)`,
  )
  return { success: true }
}

/**
 * Run a targeted build for a specific package or platform.
 */
async function runTargetedBuild(
  target: string,
  buildArgs: string[],
): Promise<void> {
  // Check if this is a platform target (e.g., darwin-arm64).
  const platformInfo = parsePlatformTarget(target)
  if (platformInfo) {
    // Ensure CLI is built first.
    const cliOutputPath = path.join(rootDir, 'packages/cli/dist/index.js')
    if (!existsSync(cliOutputPath)) {
      logger.log(`${colors.cyan('→')} Building CLI first...`)
      const cliResult = await buildPackage(BUILD_PACKAGES[0], false)
      if (!cliResult.success) {
        process.exitCode = 1
        return
      }
    }

    // Build SEA for the specified platform.
    const result = await buildPlatformSea(
      platformInfo.platform,
      platformInfo.arch,
      platformInfo.libc,
    )
    process.exitCode = result.success ? 0 : 1
    return
  }

  // Not a platform target, use pnpm filter for package builds.
  const packageFilter = TARGET_PACKAGES[target]
  if (!packageFilter) {
    logger.error(`Unknown build target: ${target}`)
    logger.error(
      `Available targets: ${Object.keys(TARGET_PACKAGES).join(', ')}`,
    )
    process.exitCode = 1
    return
  }

  const pnpmArgs = ['--filter', packageFilter, 'run', 'build', ...buildArgs]

  const result = await spawn('pnpm', pnpmArgs, {
    shell: WIN32,
    stdio: 'inherit',
  })

  process.exitCode = result.code ?? 1
}

/**
 * Build a single target (for parallel/sequential builds).
 */
async function buildTarget(
  target: string,
  buildArgs: string[],
): Promise<BuildTargetResult> {
  const startTime = Date.now()
  logger.log(`${colors.cyan('→')} [${target}] Starting build...`)

  // Check if this is a platform target (e.g., darwin-arm64).
  const platformInfo = parsePlatformTarget(target)
  if (platformInfo) {
    const seaArgs = [
      '--filter',
      '@socketsecurity/cli',
      'run',
      'build:sea',
      `--platform=${platformInfo.platform}`,
      `--arch=${platformInfo.arch}`,
    ]

    if (platformInfo.libc) {
      seaArgs.push(`--libc=${platformInfo.libc}`)
    }

    const result = await spawn('pnpm', seaArgs, {
      shell: WIN32,
      stdio: 'pipe',
    })

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    if (result.code === 0) {
      logger.log(
        `${colors.green('✓')} [${target}] Build succeeded (${duration}s)`,
      )
      return { duration, success: true, target }
    }

    logger.error(`${colors.red('✗')} [${target}] Build failed (${duration}s)`)
    if (result.stderr) {
      logger.error(`${colors.red('✗')} [${target}] Error output:`)
      logger.error(result.stderr)
    }
    return { duration, success: false, target }
  }

  // Not a platform target, use pnpm filter for package builds.
  const packageFilter = TARGET_PACKAGES[target]
  if (!packageFilter) {
    throw new Error(`Unknown build target: ${target}`)
  }

  const pnpmArgs = ['--filter', packageFilter, 'run', 'build', ...buildArgs]

  const result = await spawn('pnpm', pnpmArgs, {
    shell: WIN32,
    stdio: 'pipe',
  })

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)

  if (result.code === 0) {
    logger.log(
      `${colors.green('✓')} [${target}] Build succeeded (${duration}s)`,
    )
    return { duration, success: true, target }
  }

  logger.error(`${colors.red('✗')} [${target}] Build failed (${duration}s)`)
  if (result.stderr) {
    logger.error(`${colors.red('✗')} [${target}] Error output:`)
    logger.error(result.stderr)
  }
  return { duration, success: false, target }
}

/**
 * Run multiple targeted builds in parallel.
 */
async function runParallelBuilds(
  targetsToBuild: string[],
  buildArgs: string[],
): Promise<void> {
  logger.log('')
  logger.log('='.repeat(60))
  logger.log(
    `${colors.blue('Building ' + targetsToBuild.length + ' targets in parallel')}`,
  )
  logger.log('='.repeat(60))
  logger.log('')
  logger.log(`Targets: ${targetsToBuild.join(', ')}`)
  logger.log('')

  // Check if any targets are platform targets that need CLI built first.
  const hasPlatformTargets = targetsToBuild.some(
    t => parsePlatformTarget(t) !== null,
  )
  if (hasPlatformTargets) {
    const cliOutputPath = path.join(rootDir, 'packages/cli/dist/index.js')
    if (!existsSync(cliOutputPath)) {
      logger.log(`${colors.cyan('→')} Building CLI first...`)
      const cliResult = await buildPackage(BUILD_PACKAGES[0], false)
      if (!cliResult.success) {
        process.exitCode = 1
        return
      }
      logger.log('')
    }
  }

  const startTime = Date.now()
  const results = await Promise.allSettled(
    targetsToBuild.map(target => buildTarget(target, buildArgs)),
  )

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)

  logger.log('')
  logger.log('='.repeat(60))
  logger.log(`${colors.blue('Build Summary')}`)
  logger.log('='.repeat(60))
  logger.log('')

  const successful = results.filter(
    r => r.status === 'fulfilled' && r.value.success,
  ).length
  const failed = results.filter(
    r =>
      r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success),
  ).length

  logger.log(`${colors.green('Succeeded:')} ${successful}`)
  logger.log(`${colors.red('Failed:')}    ${failed}`)
  logger.log(`${colors.blue('Total:')}     ${totalDuration}s`)
  logger.log('')

  if (failed > 0) {
    logger.log(`${colors.red('✗')} One or more builds failed`)
    logger.log('')
    process.exitCode = 1
    return
  }

  logger.log(`${colors.green('✓')} All builds completed successfully`)
  logger.log('')
}

/**
 * Run multiple targeted builds sequentially.
 */
async function runSequentialBuilds(
  targetsToBuild: string[],
  buildArgs: string[],
): Promise<void> {
  logger.log('')
  logger.log('='.repeat(60))
  logger.log(
    `${colors.blue('Building ' + targetsToBuild.length + ' targets sequentially')}`,
  )
  logger.log('='.repeat(60))
  logger.log('')
  logger.log(`Targets: ${targetsToBuild.join(', ')}`)
  logger.log('')

  // Check if any targets are platform targets that need CLI built first.
  const hasPlatformTargets = targetsToBuild.some(
    t => parsePlatformTarget(t) !== null,
  )
  if (hasPlatformTargets) {
    const cliOutputPath = path.join(rootDir, 'packages/cli/dist/index.js')
    if (!existsSync(cliOutputPath)) {
      logger.log(`${colors.cyan('→')} Building CLI first...`)
      const cliResult = await buildPackage(BUILD_PACKAGES[0], false)
      if (!cliResult.success) {
        process.exitCode = 1
        return
      }
      logger.log('')
    }
  }

  const startTime = Date.now()
  const results = []

  for (const target of targetsToBuild) {
    const result = await buildTarget(target, buildArgs)
    results.push(result)

    if (!result.success) {
      break
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)

  logger.log('')
  logger.log('='.repeat(60))
  logger.log(`${colors.blue('Build Summary')}`)
  logger.log('='.repeat(60))
  logger.log('')

  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  logger.log(`${colors.green('Succeeded:')} ${successful}`)
  logger.log(`${colors.red('Failed:')}    ${failed}`)
  logger.log(`${colors.blue('Total:')}     ${totalDuration}s`)
  logger.log('')

  if (failed > 0) {
    logger.log(
      `${colors.red('✗')} Build failed at target: ${results.find(r => !r.success)?.target}`,
    )
    logger.log('')
    process.exitCode = 1
    return
  }

  logger.log(`${colors.green('✓')} All builds completed successfully`)
  logger.log('')
}

/**
 * Main build function.
 */
async function main(): Promise<void> {
  const opts = parseArgs()

  if (opts.help) {
    showHelp()
    return
  }

  // Handle platforms build.
  if (opts.platforms) {
    const buildFn = opts.parallel ? runParallelBuilds : runSequentialBuilds
    await buildFn(PLATFORM_TARGETS, opts.buildArgs)
    return
  }

  // Handle multiple targets.
  if (opts.targets.length > 0) {
    const buildFn = opts.parallel ? runParallelBuilds : runSequentialBuilds
    await buildFn(opts.targets, opts.buildArgs)
    return
  }

  // Handle single target.
  if (opts.target) {
    await runTargetedBuild(opts.target, opts.buildArgs)
    return
  }

  // Otherwise, run the smart build with caching.
  await runSmartBuild(opts.force)
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e)
  logger.error('')
  logger.error(`${colors.red('✗')} Unexpected error: ${message}`)
  logger.error('')
  process.exitCode = 1
})
