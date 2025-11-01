/**
 * @fileoverview Compress macOS binaries using Apple's Compression framework.
 *
 * This script integrates socket_macho_compress with the Node.js build process.
 * It provides an alternative to UPX that works with macOS code signing.
 *
 * Features:
 *   - Compresses Mach-O binaries using LZFSE/LZMA
 *   - Preserves code signature compatibility
 *   - ~20-30% size reduction beyond stripping
 *   - Creates decompressor for runtime execution
 *
 * Usage:
 *   node compress-macho.mjs <input_binary> [output_binary] [--quality=lzfse]
 *
 * Example:
 *   node compress-macho.mjs build/out/Signed/node build/out/Compressed/node
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const execFileAsync = promisify(execFile)

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Path to compression tools.
const TOOLS_DIR = join(__dirname, '..', 'additions', 'tools')
const COMPRESS_TOOL = join(TOOLS_DIR, 'socket_macho_compress')
const DECOMPRESS_TOOL = join(TOOLS_DIR, 'socket_macho_decompress')

/**
 * Build compression tools if needed.
 */
async function buildTools() {
  if (existsSync(COMPRESS_TOOL) && existsSync(DECOMPRESS_TOOL)) {
    getDefaultLogger().log(`${colors.green('✓')} Compression tools already built`)
    return
  }

  getDefaultLogger().log('Building compression tools...')
  getDefaultLogger().log(`  Directory: ${TOOLS_DIR}`)
  getDefaultLogger().log('')

  try {
    const { stdout, stderr } = await execFileAsync('make', ['all'], {
      cwd: TOOLS_DIR,
      env: { ...process.env },
    })

    if (stdout) getDefaultLogger().log(stdout)
    if (stderr) getDefaultLogger().error(stderr)

    if (!existsSync(COMPRESS_TOOL)) {
      throw new Error('Compressor tool was not built')
    }
    if (!existsSync(DECOMPRESS_TOOL)) {
      throw new Error('Decompressor tool was not built')
    }

    getDefaultLogger().log(`${colors.green('✓')} Tools built successfully`)
    getDefaultLogger().log('')
  } catch (error) {
    getDefaultLogger().error(`${colors.red('✗')} Failed to build tools:`)
    getDefaultLogger().error(error.message)
    throw error
  }
}

/**
 * Compress a Mach-O binary.
 */
async function compressBinary(inputPath, outputPath, quality = 'lzfse') {
  getDefaultLogger().log('Compressing binary...')
  getDefaultLogger().log(`  Input: ${inputPath}`)
  getDefaultLogger().log(`  Output: ${outputPath}`)
  getDefaultLogger().log(`  Quality: ${quality}`)
  getDefaultLogger().log('')

  // Ensure input exists.
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`)
  }

  // Create output directory.
  await mkdir(dirname(outputPath), { recursive: true })

  // Run compression tool.
  try {
    const args = [inputPath, outputPath, `--quality=${quality}`]
    const { stdout, stderr } = await execFileAsync(COMPRESS_TOOL, args, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for output.
    })

    if (stdout) getDefaultLogger().log(stdout)
    if (stderr) getDefaultLogger().error(stderr)

    if (!existsSync(outputPath)) {
      throw new Error('Compressed binary was not created')
    }

    getDefaultLogger().log('')
    getDefaultLogger().log(`${colors.green('✓')} Compression complete`)
  } catch (error) {
    getDefaultLogger().error(`${colors.red('✗')} Compression failed:`)
    getDefaultLogger().error(error.message)
    throw error
  }
}

/**
 * Main function.
 */
async function main() {
  const args = process.argv.slice(2)

  if (args.length < 1) {
    getDefaultLogger().error('Usage: node compress-macho.mjs <input_binary> [output_binary] [--quality=lzfse|lz4|lzma|zlib]')
    getDefaultLogger().error()
    getDefaultLogger().error('Example:')
    getDefaultLogger().error('  node compress-macho.mjs build/out/Signed/node build/out/Compressed/node')
    getDefaultLogger().error()
    getDefaultLogger().error('Quality options:')
    getDefaultLogger().error('  lz4    - Fast decompression, lower compression (~20-30%)')
    getDefaultLogger().error('  zlib   - Balanced, good compatibility (~30-40%)')
    getDefaultLogger().error('  lzfse  - Apple default, best for binaries (~35-45%) [default]')
    getDefaultLogger().error('  lzma   - Maximum compression, slower (~40-50%)')
    process.exit(1)
  }

  const inputPath = args[0]
  const outputPath = args[1] || inputPath.replace(/(\.[^.]+)?$/, '.compressed$1')

  // Parse quality argument.
  let quality = 'lzfse'
  for (const arg of args) {
    if (arg.startsWith('--quality=')) {
      quality = arg.substring(10)
    }
  }

  try {
    // Build tools if needed.
    await buildTools()

    // Compress binary.
    await compressBinary(inputPath, outputPath, quality)

    getDefaultLogger().log('')
    getDefaultLogger().log('📝 Next steps:')
    getDefaultLogger().log('')
    getDefaultLogger().log('1. Test the compressed binary:')
    getDefaultLogger().log(`   ${DECOMPRESS_TOOL} ${outputPath} --version`)
    getDefaultLogger().log('')
    getDefaultLogger().log('2. Sign the compressed binary (macOS):')
    getDefaultLogger().log(`   codesign --sign - --force ${outputPath}`)
    getDefaultLogger().log('')
    getDefaultLogger().log('3. Distribute the compressed binary with the decompressor')
    getDefaultLogger().log(`   cp ${DECOMPRESS_TOOL} <distribution-directory>/`)
    getDefaultLogger().log('')
  } catch (error) {
    getDefaultLogger().error()
    getDefaultLogger().error(`${colors.red('✗')} Compression failed`)
    process.exit(1)
  }
}

main()
