#!/usr/bin/env node
/**
 * Migrate Socket CLI to monorepo structure.
 *
 * This script:
 * 1. Creates remaining package directories
 * 2. Moves code to appropriate packages
 * 3. Updates package.json files
 * 4. Preserves git history via git mv
 */

import { execSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const packagesDir = path.join(rootDir, 'packages')

/**
 * Execute git command.
 */
function gitExec(command) {
  try {
    execSync(command, { cwd: rootDir, stdio: 'inherit' })
    return true
  } catch (e) {
    logger.error(`Git command failed: ${command}`)
    return false
  }
}

/**
 * Create package directory structure.
 */
async function createPackageDir(name, subdirs = []) {
  const packageDir = path.join(packagesDir, name)
  logger.log(`Creating ${name}...`)

  await fs.mkdir(packageDir, { recursive: true })

  for (const subdir of subdirs) {
    await fs.mkdir(path.join(packageDir, subdir), { recursive: true })
  }

  logger.log(`  ✓ ${packageDir}`)
  return packageDir
}

/**
 * Move directory using git mv to preserve history.
 */
function gitMove(source, dest) {
  const sourceAbs = path.join(rootDir, source)
  const destAbs = path.join(rootDir, dest)

  if (!existsSync(sourceAbs)) {
    logger.log(`  ⊘ ${source} does not exist, skipping`)
    return false
  }

  logger.log(`  → ${source} → ${dest}`)

  // Ensure destination parent exists.
  const destParent = path.dirname(destAbs)
  if (!existsSync(destParent)) {
    execSync(`mkdir -p "${destParent}"`, { cwd: rootDir })
  }

  return gitExec(`git mv "${sourceAbs}" "${destAbs}"`)
}

/**
 * Copy directory (fallback when git mv not appropriate).
 */
async function copyDir(source, dest) {
  const sourceAbs = path.join(rootDir, source)
  const destAbs = path.join(rootDir, dest)

  if (!existsSync(sourceAbs)) {
    logger.log(`  ⊘ ${source} does not exist, skipping`)
    return false
  }

  logger.log(`  → ${source} → ${dest}`)

  await fs.cp(sourceAbs, destAbs, { recursive: true })
  return true
}

/**
 * Main migration.
 */
async function main() {
  logger.log('Migrating Socket CLI to monorepo structure...\n')

  // 1. Create packages/cli/ and move core CLI code.
  logger.log('\n1. Creating packages/cli/...')
  const cliDir = await createPackageDir('cli', ['scripts'])

  logger.log('Moving CLI source code...')
  gitMove('src', 'packages/cli/src')
  gitMove('bin', 'packages/cli/bin')
  gitMove('data', 'packages/cli/data')
  gitMove('external', 'packages/cli/external')
  gitMove('test', 'packages/cli/test')
  gitMove('dist', 'packages/cli/dist')

  logger.log('Copying CLI config files...')
  await copyDir('tsconfig.json', 'packages/cli/tsconfig.json')
  await copyDir('vitest.config.mts', 'packages/cli/vitest.config.mts')

  // Copy current package.json to cli/ (will be updated later).
  await copyDir('package.json', 'packages/cli/package.json')

  logger.log('Moving CLI build scripts...')
  gitMove('scripts/build.mjs', 'packages/cli/scripts/build.mjs')
  gitMove('.config/esbuild.cli.build.mjs', 'packages/cli/scripts/esbuild.config.mjs')

  // 2. Create packages/socket/ and move bootstrap code.
  logger.log('\n2. Creating packages/socket/...')
  const socketDir = await createPackageDir('socket', ['bin', 'src/bootstrap/shared', 'scripts'])

  logger.log('Moving bootstrap code...')
  gitMove('bin/bootstrap.js', 'packages/socket/bin/bootstrap.js')
  gitMove('src/bootstrap', 'packages/socket/src/bootstrap')

  // Create minimal socket package.json.
  const socketPackageJson = {
    bin: {
      socket: './bin/socket.js',
    },
    description: 'Thin Socket CLI wrapper that downloads and delegates to @socketsecurity/cli',
    files: ['bin/', 'dist/'],
    license: 'MIT',
    name: 'socket',
    optionalDependencies: {
      '@socketbin/cli-alpine-arm64': '^1.0.0',
      '@socketbin/cli-alpine-x64': '^1.0.0',
      '@socketbin/cli-darwin-arm64': '^1.0.0',
      '@socketbin/cli-darwin-x64': '^1.0.0',
      '@socketbin/cli-linux-arm64': '^1.0.0',
      '@socketbin/cli-linux-x64': '^1.0.0',
      '@socketbin/cli-win32-arm64': '^1.0.0',
      '@socketbin/cli-win32-x64': '^1.0.0',
    },
    version: '1.0.0',
  }

  await fs.writeFile(
    path.join(socketDir, 'package.json'),
    JSON.stringify(socketPackageJson, null, 2) + '\n',
  )

  // Create socket entry point that wraps bootstrap.
  const socketEntry = `#!/usr/bin/env node
// Socket CLI thin wrapper entry point.
import './bootstrap.js'
`

  await fs.writeFile(path.join(socketDir, 'bin', 'socket.js'), socketEntry)
  await fs.chmod(path.join(socketDir, 'bin', 'socket.js'), 0o755)

  // 3. Create packages/socketbin-custom-node-from-source/ and move Node.js build.
  logger.log('\n3. Creating packages/socketbin-custom-node-from-source/...')
  const customNodeDir = await createPackageDir('socketbin-custom-node-from-source', [
    'scripts',
  ])

  logger.log('Moving custom Node.js build...')
  gitMove('build', 'packages/socketbin-custom-node-from-source/build')
  gitMove('.node-source', 'packages/socketbin-custom-node-from-source/.node-source')
  gitMove('scripts/build-custom-node.mjs', 'packages/socketbin-custom-node-from-source/scripts/build.mjs')

  // Create minimal package.json for custom node builder.
  const customNodePackageJson = {
    description: 'Custom Node.js binary builder with Socket security patches',
    license: 'MIT',
    name: '@socketbin/node-smol-builder-builder',
    private: true,
    scripts: {
      build: 'node scripts/build.mjs',
      'build:all': 'node scripts/build.mjs --all-platforms',
    },
    version: '1.0.0',
  }

  await fs.writeFile(
    path.join(customNodeDir, 'package.json'),
    JSON.stringify(customNodePackageJson, null, 2) + '\n',
  )

  // 4. Create packages/socketbin-native-node-sea-builder/ for SEA builder.
  logger.log('\n4. Creating packages/socketbin-native-node-sea-builder/...')
  const seaDir = await createPackageDir('socketbin-native-node-sea-builder', ['scripts', 'dist'])

  logger.log('Moving SEA build scripts...')
  gitMove('scripts/build-sea.mjs', 'packages/socketbin-native-node-sea-builder/scripts/build.mjs')
  gitMove('scripts/publish-sea.mjs', 'packages/socketbin-native-node-sea-builder/scripts/publish.mjs')

  // Create minimal package.json for SEA builder.
  const seaPackageJson = {
    description: 'Native Node.js SEA binary builder (fallback)',
    license: 'MIT',
    name: '@socketbin/node-sea-builder-builder',
    private: true,
    scripts: {
      build: 'node scripts/build.mjs',
      'build:all': 'node scripts/build.mjs --all-platforms',
      publish: 'node scripts/publish.mjs',
    },
    version: '1.0.0',
  }

  await fs.writeFile(
    path.join(seaDir, 'package.json'),
    JSON.stringify(seaPackageJson, null, 2) + '\n',
  )

  // 5. Update root package.json to be workspace-only.
  logger.log('\n5. Updating root package.json...')
  const rootPackageJson = JSON.parse(
    await fs.readFile(path.join(rootDir, 'package.json'), 'utf-8'),
  )

  // Keep only workspace-related fields.
  const workspacePackageJson = {
    devDependencies: rootPackageJson.devDependencies,
    engines: rootPackageJson.engines,
    'lint-staged': rootPackageJson['lint-staged'],
    name: 'socket-cli-monorepo',
    pnpm: rootPackageJson.pnpm,
    private: true,
    scripts: {
      build: 'pnpm --filter "./packages/**" run build',
      'build:cli': 'pnpm --filter @socketsecurity/cli run build',
      'build:socket': 'pnpm --filter socket run build',
      check: 'pnpm --filter @socketsecurity/cli run check',
      clean: 'pnpm --filter "./packages/**" run clean',
      lint: 'pnpm --filter @socketsecurity/cli run lint',
      prepare: rootPackageJson.scripts.prepare,
      test: 'pnpm --filter @socketsecurity/cli run test',
      type: 'pnpm --filter @socketsecurity/cli run type',
    },
    typeCoverage: rootPackageJson.typeCoverage,
    version: rootPackageJson.version,
  }

  await fs.writeFile(
    path.join(rootDir, 'package.json'),
    JSON.stringify(workspacePackageJson, null, 2) + '\n',
  )

  logger.log('\n✓ Migration complete!\n')
  logger.log('Next steps:')
  logger.log('  1. Review git status: git status')
  logger.log('  2. Update import paths in packages/cli/src/')
  logger.log('  3. Run: pnpm install')
  logger.log('  4. Test builds: pnpm run build')
  logger.log('  5. Commit changes: git add . && git commit\n')
}

main().catch(error => {
  logger.error('Migration failed:', error)
  process.exit(1)
})
