/**
 * Socket CLI WASM Bundle Manager
 *
 * Unified script for building and downloading the unified WASM bundle
 * containing all AI models (MiniLM, CodeT5 encoder/decoder, ONNX Runtime, Yoga).
 *
 * COMMANDS:
 * - --build:    Build WASM bundle from source (requires Python, Rust, wasm-pack)
 * - --dev:      Fast dev build (3-5x faster, use with --build)
 * - --download: Download pre-built WASM bundle from GitHub releases
 * - --help:     Show this help message
 *
 * USAGE:
 *   node scripts/wasm.mjs --build                 # Production build
 *   node scripts/wasm.mjs --build --dev           # Fast dev build
 *   node scripts/wasm.mjs --download
 *   node scripts/wasm.mjs --help
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const externalDir = path.join(rootPath, 'external')
const outputFile = path.join(externalDir, 'socket-ai-sync.mjs')

const GITHUB_REPO = 'SocketDev/socket-cli'
const WASM_ASSET_NAME = 'socket-ai-sync.mjs'

/**
 * Check Node.js version requirement.
 */
function checkNodeVersion() {
  const nodeVersion = process.versions.node
  const major = Number.parseInt(nodeVersion.split('.')[0], 10)

  if (major < 18) {
    getDefaultLogger().error(' Node.js version 18 or higher is required')
    getDefaultLogger().error(`Current version: ${nodeVersion}`)
    getDefaultLogger().error('Please upgrade: https://nodejs.org/')
    process.exit(1)
  }
}

/**
 * Show help message.
 */
function showHelp() {
  getDefaultLogger().info(`
╔═══════════════════════════════════════════════════╗
║   Socket CLI WASM Bundle Manager                  ║
╚═══════════════════════════════════════════════════╝

Commands:
  --build     Build WASM bundle from source
              Requirements: Python 3.8+, Rust, wasm-pack, binaryen
              Time: ~10-20 minutes (first run), ~5 minutes (subsequent)
              Size: ~115MB output

  --dev       Fast dev build (use with --build)
              Optimizations: Minimal (opt-level=1, no LTO)
              Time: ~2-5 minutes (3-5x faster than production)
              Size: Similar to production (stripped)

  --download  Download pre-built WASM bundle from GitHub releases
              Requirements: Internet connection
              Time: ~1-2 minutes
              Size: ~115MB download

  --help      Show this help message

Usage:
  node scripts/wasm.mjs --build           # Production build
  node scripts/wasm.mjs --build --dev     # Fast dev build
  node scripts/wasm.mjs --download
  node scripts/wasm.mjs --help

Examples:
  # Build from source for production
  node scripts/wasm.mjs --build

  # Fast dev build for iteration (3-5x faster)
  node scripts/wasm.mjs --build --dev

  # Download pre-built bundle (for quick setup)
  node scripts/wasm.mjs --download

Optimizations:
  - Cargo profiles: dev-wasm (fast) vs release (optimized)
  - Thin LTO: 5-10% faster builds than full LTO
  - Strip symbols: 5-10% size reduction
  - wasm-opt -Oz: 5-15% additional size reduction
  - Brotli compression: ~70% final size reduction

Notes:
  - The WASM bundle contains all AI models with INT4 quantization
  - INT4 provides 50% size reduction with only 1-2% quality loss
  - Output location: external/socket-ai-sync.mjs (~115MB)
`)
}

/**
 * Execute command and wait for completion.
 */
async function exec(command, args, options = {}) {
  const result = await spawn(command, args, {
    stdio: options.stdio || 'pipe',
    stdioString: true,
    stripAnsi: false,
    ...options,
  })

  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}`)
  }

  return {
    code: result.code ?? 0,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

/**
 * Build WASM bundle from source.
 */
async function buildWasm() {
  const isDev = process.argv.includes('--dev')

  getDefaultLogger().info(
    '╔═══════════════════════════════════════════════════╗',
  )
  if (isDev) {
    getDefaultLogger().info(
      '║   Building WASM Bundle (Dev Mode)                ║',
    )
    getDefaultLogger().info(
      '║   3-5x faster builds with minimal optimization   ║',
    )
  } else {
    getDefaultLogger().info(
      '║   Building WASM Bundle from Source               ║',
    )
  }
  getDefaultLogger().info(
    '╚═══════════════════════════════════════════════════╝\n',
  )

  const convertScript = path.join(__dirname, 'wasm', 'convert-codet5.mjs')
  const buildScript = path.join(__dirname, 'wasm', 'build-unified-wasm.mjs')

  // Step 1: Convert CodeT5 models to INT4.
  getDefaultLogger().info('Step 1: Converting CodeT5 models to ONNX INT4...\n')
  try {
    await exec('node', [convertScript], { stdio: 'inherit' })
  } catch (e) {
    getDefaultLogger().error('\n❌ CodeT5 conversion failed')
    getDefaultLogger().error(`Error: ${e.message}`)
    process.exit(1)
  }

  // Step 2: Build unified WASM bundle.
  getDefaultLogger().info('\nStep 2: Building unified WASM bundle...\n')
  try {
    const buildArgs = [buildScript]
    if (isDev) {
      buildArgs.push('--dev')
    }
    await exec('node', buildArgs, { stdio: 'inherit' })
  } catch (e) {
    getDefaultLogger().error('\n❌ WASM bundle build failed')
    getDefaultLogger().error(`Error: ${e.message}`)
    process.exit(1)
  }

  // Verify output file exists.
  if (!existsSync(outputFile)) {
    getDefaultLogger().error(`\n❌ Output file not found: ${outputFile}`)
    process.exit(1)
  }

  const stats = await fs.stat(outputFile)
  getDefaultLogger().info(
    '\n╔═══════════════════════════════════════════════════╗',
  )
  getDefaultLogger().info(
    '║   Build Complete                                  ║',
  )
  getDefaultLogger().info(
    '╚═══════════════════════════════════════════════════╝\n',
  )
  getDefaultLogger().done(' WASM bundle built successfully')
  getDefaultLogger().info(`✓ Output: ${outputFile}`)
  getDefaultLogger().info(
    `✓ Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB\n`,
  )
}

/**
 * Get latest WASM build release from GitHub.
 */
async function getLatestWasmRelease() {
  getDefaultLogger().info('📡 Fetching latest WASM build from GitHub...\n')

  try {
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases`
    const response = await fetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'socket-cli-wasm-downloader',
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.statusText}`)
    }

    const releases = await response.json()

    // Find the latest WASM build release (tagged with wasm-build-*).
    const wasmRelease = releases.find(r => r.tag_name.startsWith('wasm-build-'))

    if (!wasmRelease) {
      throw new Error('No WASM build releases found')
    }

    // Find the asset.
    const asset = wasmRelease.assets.find(a => a.name === WASM_ASSET_NAME)

    if (!asset) {
      throw new Error(
        `Asset "${WASM_ASSET_NAME}" not found in release ${wasmRelease.tag_name}`,
      )
    }

    return {
      asset,
      name: wasmRelease.name,
      tagName: wasmRelease.tag_name,
      url: asset.browser_download_url,
    }
  } catch (e) {
    getDefaultLogger().error(' Failed to fetch release information')
    getDefaultLogger().error(`Error: ${e.message}`)
    getDefaultLogger().error('\nTry building from source instead:')
    getDefaultLogger().error('node scripts/wasm.mjs --build\n')
    process.exit(1)
  }
}

/**
 * Download file with progress.
 */
async function downloadFile(url, outputPath, expectedSize) {
  getDefaultLogger().progress(' Downloading from GitHub...')
  getDefaultLogger().substep(`URL: ${url}`)
  getDefaultLogger().substep(
    `Size: ${(expectedSize / 1024 / 1024).toFixed(2)} MB\n`,
  )

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'socket-cli-wasm-downloader',
      },
    })

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    await fs.writeFile(outputPath, Buffer.from(buffer))

    const stats = await fs.stat(outputPath)
    getDefaultLogger().info(
      `✓ Downloaded ${(stats.size / 1024 / 1024).toFixed(2)} MB`,
    )
    getDefaultLogger().info(`✓ Saved to ${outputPath}\n`)
  } catch (e) {
    getDefaultLogger().error(' Download failed')
    getDefaultLogger().error(`Error: ${e.message}`)
    getDefaultLogger().error('\nTry building from source instead:')
    getDefaultLogger().error('node scripts/wasm.mjs --build\n')
    process.exit(1)
  }
}

/**
 * Download pre-built WASM bundle from GitHub releases.
 */
async function downloadWasm() {
  getDefaultLogger().info(
    '╔═══════════════════════════════════════════════════╗',
  )
  getDefaultLogger().info(
    '║   Downloading Pre-built WASM Bundle               ║',
  )
  getDefaultLogger().info(
    '╚═══════════════════════════════════════════════════╝\n',
  )

  // Check if output file already exists.
  if (existsSync(outputFile)) {
    const stats = await fs.stat(outputFile)
    getDefaultLogger().warn(' WASM bundle already exists:')
    getDefaultLogger().substep(`${outputFile}`)
    getDefaultLogger().substep(
      `Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB\n`,
    )

    // Ask user if they want to overwrite (simple y/n).
    getDefaultLogger().info('Overwrite? (y/N): ')
    const answer = await new Promise(resolve => {
      process.stdin.once('data', data => {
        resolve(data.toString().trim().toLowerCase())
      })
    })

    if (answer !== 'y' && answer !== 'yes') {
      getDefaultLogger().info('\n✓ Keeping existing file\n')
      return
    }

    getDefaultLogger().info()
  }

  // Get latest release info.
  const release = await getLatestWasmRelease()
  getDefaultLogger().info(`✓ Found release: ${release.name}`)
  getDefaultLogger().substep(`Tag: ${release.tagName}\n`)

  // Ensure output directory exists.
  await fs.mkdir(externalDir, { recursive: true })

  // Download the file.
  await downloadFile(release.url, outputFile, release.asset.size)

  getDefaultLogger().info(
    '╔═══════════════════════════════════════════════════╗',
  )
  getDefaultLogger().info(
    '║   Download Complete                               ║',
  )
  getDefaultLogger().info(
    '╚═══════════════════════════════════════════════════╝\n',
  )
  getDefaultLogger().done(' WASM bundle downloaded successfully')
  getDefaultLogger().info(`✓ Output: ${outputFile}\n`)
}

/**
 * Main entry point.
 */
async function main() {
  // Check Node.js version first.
  checkNodeVersion()

  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp()
    return
  }

  if (args.includes('--build')) {
    await buildWasm()
    return
  }

  if (args.includes('--download')) {
    await downloadWasm()
    return
  }

  getDefaultLogger().error(' Unknown command\n')
  showHelp()
  process.exit(1)
}

main().catch(e => {
  getDefaultLogger().error(' Unexpected error:', e)
  process.exit(1)
})
