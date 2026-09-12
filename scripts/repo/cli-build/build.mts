/**
 * Build script for Socket CLI. Options: --quiet, --verbose, --force, --watch.
 */

import { copyFileSync, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isWin32 } from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { buildSdxgenBundle } from './sdxgen.mts'
import { safeDelete } from '../../fleet/fs/safe.mts'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '../../..')

// Node options for memory allocation.
const NODE_MEMORY_FLAGS = ['--max-old-space-size=8192']

// Simple CLI helpers without registry dependencies.
const isQuiet = () => process.argv.includes('--quiet')
const isVerbose = () => process.argv.includes('--verbose')

/**
 * Copy the JVM build-tool resolution assets — the Gradle init scripts, the sbt
 * plugin, and the Maven extension jar — into dist, where the manifest commands
 * resolve them at runtime. The Maven jar is compiled by
 * maven-extension/build-jar.sh and is absent from a fresh checkout: a local dev
 * build tolerates that (run.mts surfaces a build hint at runtime) but a
 * published build fails closed, because shipping without the jar would make
 * `socket manifest maven` silently produce an empty SBOM.
 */
async function writeCommandWrappers(): Promise<void> {
  const results = await Promise.allSettled(
    ['npm', 'npx', 'pnpm', 'yarn'].map(mode =>
      fs.writeFile(
        path.join(packageRoot, 'dist', `socket-${mode}.js`),
        `#!/usr/bin/env node\nprocess.env.SOCKET_CLI_MODE = ${JSON.stringify(mode)};\nrequire('./index.js');\n`,
        { mode: 0o755 },
      ),
    ),
  )
  const failed = results.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') {
    throw failed.reason
  }
}

async function copyManifestScripts() {
  const srcDir = path.join(packageRoot, 'src/command/manifest/scripts')
  const distDir = path.join(packageRoot, 'dist')
  const destDir = path.join(distDir, 'manifest-scripts')
  await fs.mkdir(path.join(destDir, 'maven-extension'), { recursive: true })
  const copies = await Promise.allSettled([
    fs.copyFile(
      path.join(packageRoot, 'src/command/manifest/init.gradle'),
      path.join(distDir, 'init.gradle'),
    ),
    fs.copyFile(
      path.join(srcDir, 'socket-facts.init.gradle'),
      path.join(destDir, 'socket-facts.init.gradle'),
    ),
    fs.copyFile(
      path.join(srcDir, 'socket-facts.plugin.scala'),
      path.join(destDir, 'socket-facts.plugin.scala'),
    ),
  ])
  const copyFailure = copies.find(r => r.status === 'rejected')
  if (copyFailure) {
    throw copyFailure.reason
  }
  const jarPath = path.join(
    srcDir,
    'maven-extension',
    'coana-maven-extension.jar',
  )
  if (existsSync(jarPath)) {
    await fs.copyFile(
      jarPath,
      path.join(destDir, 'maven-extension', 'coana-maven-extension.jar'),
    )
  } else if (getEnvValue('INLINED_PUBLISHED_BUILD') === '1') {
    throw new Error(
      `Maven manifest extension jar not found at ${jarPath} for a published build. Build it first: pnpm run build:maven-extension`,
    )
  }
}

/**
 * Post-process bundled files to break node-gyp require.resolve strings. This
 * prevents esbuild from trying to bundle node-gyp during the build.
 *
 * @param {string} dir - Directory to process.
 * @param {object} options - Options.
 * @param {boolean} options.quiet - Suppress output.
 * @param {boolean} options.verbose - Show detailed output.
 */
async function fixNodeGypStrings(
  dir: string,
  options: { quiet?: boolean | undefined; verbose?: boolean | undefined } = {},
) {
  const { quiet = false, verbose = false } = options

  // Find all .js files in build directory.
  const files = await fs.readdir(dir, { withFileTypes: true })

  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    const filePath = path.join(dir, file.name)

    if (file.isDirectory()) {
      // Recursively process subdirectories.
      await fixNodeGypStrings(filePath, options)
    } else if (file.name.endsWith('.js')) {
      // Read file contents.
      const contents = await fs.readFile(filePath, 'utf-8')

      // Check if file contains the problematic pattern.
      if (contents.includes('node-gyp/bin/node-gyp.js')) {
        // Replace literal string with concatenated version.
        const fixed = contents.replace(
          /["']node-gyp\/bin\/node-gyp\.js["']/g,
          '"node-" + "gyp/bin/node-gyp.js"',
        )

        await fs.writeFile(filePath, fixed, 'utf-8')

        if (!quiet && verbose) {
          logger.info(
            `Fixed node-gyp string in ${path.relative(packageRoot, filePath)}`,
          )
        }
      }
    }
  }
}

async function runBuildStep(executable: string, args: string[]): Promise<void> {
  const result = await spawn(executable, args, {
    stdio: 'inherit',
    shell: isWin32(),
  })
  if (result.code !== 0) {
    throw new Error(`Build step failed with exit code ${result.code ?? 1}`)
  }
}

async function main(): Promise<void> {
  const quiet = isQuiet()
  const verbose = isVerbose()
  if (process.argv.includes('--force')) {
    process.env['SOCKET_CLI_FORCE_BUILD'] = '1'
    await safeDelete([
      path.join(packageRoot, 'build'),
      path.join(packageRoot, 'dist'),
    ])
  }
  if (!quiet) {
    logger.step('Building Socket CLI')
  }
  await fs.mkdir(path.join(packageRoot, 'dist'), { recursive: true })
  if (process.argv.includes('--watch')) {
    await runBuildStep(process.execPath, [
      ...NODE_MEMORY_FLAGS,
      '.config/repo/cli/rolldown.cli.mts',
      '--watch',
    ])
    return
  }
  await runBuildStep(process.execPath, [
    ...NODE_MEMORY_FLAGS,
    '.config/repo/cli/rolldown.build.mts',
  ])
  await fixNodeGypStrings(path.join(packageRoot, 'build'), { quiet, verbose })
  copyFileSync(
    path.join(packageRoot, 'build/cli.js'),
    path.join(packageRoot, 'dist/cli.js'),
  )
  const results = await Promise.allSettled([
    writeCommandWrappers(),
    buildSdxgenBundle(packageRoot),
    copyManifestScripts(),
  ])
  const failed = results.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') {
    throw failed.reason
  }
  if (!quiet) {
    logger.success('Build completed')
  }
}

main().catch(error => {
  logger.error(error)
  process.exitCode = 1
})
