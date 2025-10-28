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
import { logger } from '@socketsecurity/lib/logger'
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
    logger.log(`${colors.green('✓')} Compression tools already built`)
    return
  }

  logger.log('Building compression tools...')
  logger.log(`  Directory: ${TOOLS_DIR}`)
  logger.log('')

  try {
    const { stdout, stderr } = await execFileAsync('make', ['all'], {
      cwd: TOOLS_DIR,
      env: { ...process.env },
    })

    if (stdout) logger.log(stdout)
    if (stderr) logger.error(stderr)

    if (!existsSync(COMPRESS_TOOL)) {
      throw new Error('Compressor tool was not built')
    }
    if (!existsSync(DECOMPRESS_TOOL)) {
      throw new Error('Decompressor tool was not built')
    }

    logger.log(`${colors.green('✓')} Tools built successfully`)
    logger.log('')
  } catch (error) {
    logger.error(`${colors.red('✗')} Failed to build tools:`)
    logger.error(error.message)
    throw error
  }
}

/**
 * Compress a Mach-O binary.
 */
async function compressBinary(inputPath, outputPath, quality = 'lzfse') {
  logger.log('Compressing binary...')
  logger.log(`  Input: ${inputPath}`)
  logger.log(`  Output: ${outputPath}`)
  logger.log(`  Quality: ${quality}`)
  logger.log('')

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

    if (stdout) logger.log(stdout)
    if (stderr) logger.error(stderr)

    if (!existsSync(outputPath)) {
      throw new Error('Compressed binary was not created')
    }

    logger.log('')
    logger.log(`${colors.green('✓')} Compression complete`)
  } catch (error) {
    logger.error(`${colors.red('✗')} Compression failed:`)
    logger.error(error.message)
    throw error
  }
}

/**
 * Main function.
 */
async function main() {
  const args = process.argv.slice(2)

  if (args.length < 1) {
    logger.error('Usage: node compress-macho.mjs <input_binary> [output_binary] [--quality=lzfse|lz4|lzma|zlib]')
    logger.error()
    logger.error('Example:')
    logger.error('  node compress-macho.mjs build/out/Signed/node build/out/Compressed/node')
    logger.error()
    logger.error('Quality options:')
    logger.error('  lz4    - Fast decompression, lower compression (~20-30%)')
    logger.error('  zlib   - Balanced, good compatibility (~30-40%)')
    logger.error('  lzfse  - Apple default, best for binaries (~35-45%) [default]')
    logger.error('  lzma   - Maximum compression, slower (~40-50%)')
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

    logger.log('')
    logger.log('📝 Next steps:')
    logger.log('')
    logger.log('1. Test the compressed binary:')
    logger.log(`   ${DECOMPRESS_TOOL} ${outputPath} --version`)
    logger.log('')
    logger.log('2. Sign the compressed binary (macOS):')
    logger.log(`   codesign --sign - --force ${outputPath}`)
    logger.log('')
    logger.log('3. Distribute the compressed binary with the decompressor')
    logger.log(`   cp ${DECOMPRESS_TOOL} <distribution-directory>/`)
    logger.log('')
  } catch (error) {
    logger.error()
    logger.error(`${colors.red('✗')} Compression failed`)
    process.exit(1)
  }
}

main()
