#!/usr/bin/env node
/**
 * Cross-platform binary compression script.
 *
 * Automatically detects the platform and uses the appropriate compression tool:
 * - macOS: socket_macho_compress (Apple Compression framework)
 * - Linux: socket_elf_compress (liblzma)
 * - Windows: socket_pe_compress (Windows Compression API)
 *
 * Usage:
 *   node scripts/compress-binary.mjs <input> <output> [--quality=lzma|lzfse|xpress]
 *   node scripts/compress-binary.mjs ./node ./node.compressed --quality=lzma
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from '@socketsecurity/registry/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOOLS_DIR = path.resolve(__dirname, '../additions/tools')

/**
 * Platform configuration.
 */
const PLATFORM_CONFIG = {
  __proto__: null,
  darwin: {
    toolName: 'socket_macho_compress',
    binaryFormat: 'Mach-O',
    defaultQuality: 'lzfse',
    qualityOptions: ['lz4', 'zlib', 'lzfse', 'lzma'],
    buildCommand: 'make -f Makefile'
  },
  linux: {
    toolName: 'socket_elf_compress',
    binaryFormat: 'ELF',
    defaultQuality: 'lzma',
    qualityOptions: ['lzma'],
    buildCommand: 'make -f Makefile.linux'
  },
  win32: {
    toolName: 'socket_pe_compress',
    binaryFormat: 'PE',
    defaultQuality: 'lzms',
    qualityOptions: ['xpress', 'xpress_huff', 'lzms'],
    buildCommand: 'mingw32-make -f Makefile.windows'
  }
}

/**
 * Parse command line arguments.
 */
function parseArgs() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.error('Usage: compress-binary.mjs <input> <output> [--quality=lzma|lzfse|xpress]')
    console.error('')
    console.error('Examples:')
    console.error('  node scripts/compress-binary.mjs ./node ./node.compressed')
    console.error('  node scripts/compress-binary.mjs ./node ./node.compressed --quality=lzma')
    process.exit(1)
  }

  const inputPath = path.resolve(args[0])
  const outputPath = path.resolve(args[1])
  let quality = null

  for (const arg of args.slice(2)) {
    if (arg.startsWith('--quality=')) {
      quality = arg.substring('--quality='.length)
    }
  }

  return { inputPath, outputPath, quality }
}

/**
 * Get platform configuration.
 */
function getPlatformConfig() {
  const platform = process.platform
  const config = PLATFORM_CONFIG[platform]

  if (!config) {
    throw new Error(`Unsupported platform: ${platform}. Supported: macOS, Linux, Windows`)
  }

  return config
}

/**
 * Build compression tool if it doesn't exist.
 */
async function ensureToolBuilt(config) {
  const toolPath = path.join(TOOLS_DIR, config.toolName)
  const toolPathExe = `${toolPath}.exe`

  // Check if tool exists (with or without .exe extension).
  if (existsSync(toolPath) || existsSync(toolPathExe)) {
    return existsSync(toolPathExe) ? toolPathExe : toolPath
  }

  console.log(`Building ${config.binaryFormat} compression tool...`)
  console.log(`  Command: ${config.buildCommand}`)
  console.log('')

  const result = await spawn(config.buildCommand, {
    cwd: TOOLS_DIR,
    shell: true,
    stdio: 'inherit'
  })

  if (result.code !== 0) {
    throw new Error(`Failed to build compression tool (exit code: ${result.code})`)
  }

  // Verify tool was built.
  if (!existsSync(toolPath) && !existsSync(toolPathExe)) {
    throw new Error(`Tool ${config.toolName} was not created after build`)
  }

  return existsSync(toolPathExe) ? toolPathExe : toolPath
}

/**
 * Get file size in MB.
 */
async function getFileSizeMB(filePath) {
  const stats = await fs.stat(filePath)
  return stats.size / 1024 / 1024
}

/**
 * Compress binary using platform-specific tool.
 */
async function compressBinary(toolPath, inputPath, outputPath, quality, config) {
  // Validate input file exists.
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`)
  }

  // Get input file size.
  const inputSizeMB = await getFileSizeMB(inputPath)

  console.log(`Compressing ${config.binaryFormat} binary...`)
  console.log(`  Input: ${inputPath} (${inputSizeMB.toFixed(2)} MB)`)
  console.log(`  Output: ${outputPath}`)
  console.log(`  Quality: ${quality || config.defaultQuality}`)
  console.log('')

  // Build command arguments.
  const args = [inputPath, outputPath]
  if (quality) {
    args.push(`--quality=${quality}`)
  }

  // Execute compression tool.
  const result = await spawn(toolPath, args, {
    stdio: 'inherit'
  })

  if (result.code !== 0) {
    throw new Error(`Compression failed (exit code: ${result.code})`)
  }

  // Verify output file was created.
  if (!existsSync(outputPath)) {
    throw new Error(`Output file was not created: ${outputPath}`)
  }

  // Get output file size.
  const outputSizeMB = await getFileSizeMB(outputPath)
  const reduction = ((inputSizeMB - outputSizeMB) / inputSizeMB) * 100

  console.log('')
  console.log(`✓ Compression complete!`)
  console.log(`  Original: ${inputSizeMB.toFixed(2)} MB`)
  console.log(`  Compressed: ${outputSizeMB.toFixed(2)} MB`)
  console.log(`  Reduction: ${reduction.toFixed(1)}%`)
  console.log(`  Saved: ${(inputSizeMB - outputSizeMB).toFixed(2)} MB`)
}

/**
 * Main function.
 */
async function main() {
  try {
    const { inputPath, outputPath, quality } = parseArgs()
    const config = getPlatformConfig()

    console.log('Socket Binary Compression')
    console.log('=========================')
    console.log(`Platform: ${config.binaryFormat} (${process.platform})`)
    console.log('')

    // Ensure tool is built.
    const toolPath = await ensureToolBuilt(config)

    // Compress binary.
    await compressBinary(toolPath, inputPath, outputPath, quality, config)

  } catch (e) {
    console.error(`Error: ${e.message}`)
    process.exit(1)
  }
}

main()
