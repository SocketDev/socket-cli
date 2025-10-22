/**
 * Socket CLI WASM Bundle Manager
 *
 * Unified script for building and downloading the unified WASM bundle
 * containing all AI models (MiniLM, CodeT5 encoder/decoder, ONNX Runtime, Yoga).
 *
 * COMMANDS:
 * - --build:    Build WASM bundle from source (requires Python, Rust, wasm-pack)
 * - --download: Download pre-built WASM bundle from GitHub releases
 * - --help:     Show this help message
 *
 * USAGE:
 *   node scripts/wasm.mjs --build
 *   node scripts/wasm.mjs --download
 *   node scripts/wasm.mjs --help
 */

import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const externalDir = path.join(rootPath, 'external')
const outputFile = path.join(externalDir, 'socket-ai-sync.mjs')

const GITHUB_REPO = 'SocketDev/socket-cli'
const WASM_ASSET_NAME = 'socket-ai-sync.mjs'

/**
 * Show help message.
 */
function showHelp() {
  console.log(`
╔═══════════════════════════════════════════════════╗
║   Socket CLI WASM Bundle Manager                  ║
╚═══════════════════════════════════════════════════╝

Commands:
  --build     Build WASM bundle from source
              Requirements: Python 3.8+, Rust, wasm-pack, Homebrew (macOS)
              Time: ~10-20 minutes
              Size: ~115MB output

  --download  Download pre-built WASM bundle from GitHub releases
              Requirements: Internet connection
              Time: ~1-2 minutes
              Size: ~115MB download

  --help      Show this help message

Usage:
  node scripts/wasm.mjs --build
  node scripts/wasm.mjs --download
  node scripts/wasm.mjs --help

Examples:
  # Build from source (for development)
  node scripts/wasm.mjs --build

  # Download pre-built bundle (for quick setup)
  node scripts/wasm.mjs --download

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

  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}`)
  }

  return {
    code: result.status ?? 0,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

/**
 * Build WASM bundle from source.
 */
async function buildWasm() {
  console.log('╔═══════════════════════════════════════════════════╗')
  console.log('║   Building WASM Bundle from Source               ║')
  console.log('╚═══════════════════════════════════════════════════╝\n')

  const convertScript = path.join(__dirname, 'wasm', 'convert-codet5.mjs')
  const buildScript = path.join(__dirname, 'wasm', 'build-unified-wasm.mjs')

  // Step 1: Convert CodeT5 models to INT4.
  console.log('Step 1: Converting CodeT5 models to ONNX INT4...\n')
  try {
    await exec('node', [convertScript], { stdio: 'inherit' })
  } catch (e) {
    console.error('\n❌ CodeT5 conversion failed')
    console.error(`   Error: ${e.message}`)
    process.exit(1)
  }

  // Step 2: Build unified WASM bundle.
  console.log('\nStep 2: Building unified WASM bundle...\n')
  try {
    await exec('node', [buildScript], { stdio: 'inherit' })
  } catch (e) {
    console.error('\n❌ WASM bundle build failed')
    console.error(`   Error: ${e.message}`)
    process.exit(1)
  }

  // Verify output file exists.
  if (!existsSync(outputFile)) {
    console.error(`\n❌ Output file not found: ${outputFile}`)
    process.exit(1)
  }

  const stats = await fs.stat(outputFile)
  console.log('\n╔═══════════════════════════════════════════════════╗')
  console.log('║   Build Complete                                  ║')
  console.log('╚═══════════════════════════════════════════════════╝\n')
  console.log('✓ WASM bundle built successfully')
  console.log(`✓ Output: ${outputFile}`)
  console.log(`✓ Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB\n`)
}

/**
 * Get latest WASM build release from GitHub.
 */
async function getLatestWasmRelease() {
  console.log('📡 Fetching latest WASM build from GitHub...\n')

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
    console.error('❌ Failed to fetch release information')
    console.error(`   Error: ${e.message}`)
    console.error('\nTry building from source instead:')
    console.error('   node scripts/wasm.mjs --build\n')
    process.exit(1)
  }
}

/**
 * Download file with progress.
 */
async function downloadFile(url, outputPath, expectedSize) {
  console.log('📥 Downloading from GitHub...')
  console.log(`   URL: ${url}`)
  console.log(`   Size: ${(expectedSize / 1024 / 1024).toFixed(2)} MB\n`)

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
    console.log(`✓ Downloaded ${(stats.size / 1024 / 1024).toFixed(2)} MB`)
    console.log(`✓ Saved to ${outputPath}\n`)
  } catch (e) {
    console.error('❌ Download failed')
    console.error(`   Error: ${e.message}`)
    console.error('\nTry building from source instead:')
    console.error('   node scripts/wasm.mjs --build\n')
    process.exit(1)
  }
}

/**
 * Download pre-built WASM bundle from GitHub releases.
 */
async function downloadWasm() {
  console.log('╔═══════════════════════════════════════════════════╗')
  console.log('║   Downloading Pre-built WASM Bundle               ║')
  console.log('╚═══════════════════════════════════════════════════╝\n')

  // Check if output file already exists.
  if (existsSync(outputFile)) {
    const stats = await fs.stat(outputFile)
    console.log('⚠ WASM bundle already exists:')
    console.log(`   ${outputFile}`)
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB\n`)

    // Ask user if they want to overwrite (simple y/n).
    console.log('Overwrite? (y/N): ')
    const answer = await new Promise(resolve => {
      process.stdin.once('data', data => {
        resolve(data.toString().trim().toLowerCase())
      })
    })

    if (answer !== 'y' && answer !== 'yes') {
      console.log('\n✓ Keeping existing file\n')
      return
    }

    console.log()
  }

  // Get latest release info.
  const release = await getLatestWasmRelease()
  console.log(`✓ Found release: ${release.name}`)
  console.log(`   Tag: ${release.tagName}\n`)

  // Ensure output directory exists.
  await fs.mkdir(externalDir, { recursive: true })

  // Download the file.
  await downloadFile(release.url, outputFile, release.asset.size)

  console.log('╔═══════════════════════════════════════════════════╗')
  console.log('║   Download Complete                               ║')
  console.log('╚═══════════════════════════════════════════════════╝\n')
  console.log('✓ WASM bundle downloaded successfully')
  console.log(`✓ Output: ${outputFile}\n`)
}

/**
 * Main entry point.
 */
async function main() {
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

  console.error('❌ Unknown command\n')
  showHelp()
  process.exit(1)
}

main().catch(e => {
  console.error('❌ Unexpected error:', e)
  process.exit(1)
})
