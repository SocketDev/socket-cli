#!/usr/bin/env node
/**
 * Cross-platform binary decompression script.
 *
 * Automatically detects the platform and uses the appropriate decompression tool:
 * - macOS: socket_macho_decompress
 * - Linux: socket_elf_decompress
 * - Windows: socket_pe_decompress
 *
 * Usage:
 *   node scripts/decompress-binary.mjs <compressed> [args...]
 *   node scripts/decompress-binary.mjs ./node.compressed --version
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOOLS_DIR = path.resolve(__dirname, '../additions/tools')

/**
 * Platform configuration.
 */
const PLATFORM_CONFIG = {
  __proto__: null,
  darwin: {
    toolName: 'socket_macho_decompress',
    binaryFormat: 'Mach-O',
    buildCommand: 'make -f Makefile'
  },
  linux: {
    toolName: 'socket_elf_decompress',
    binaryFormat: 'ELF',
    buildCommand: 'make -f Makefile.linux'
  },
  win32: {
    toolName: 'socket_pe_decompress',
    binaryFormat: 'PE',
    buildCommand: 'mingw32-make -f Makefile.windows'
  }
}

/**
 * Parse command line arguments.
 */
function parseArgs() {
  const args = process.argv.slice(2)

  if (!args.length) {
    getDefaultLogger().error('Usage: decompress-binary.mjs <compressed> [args...]')
    getDefaultLogger().error('')
    getDefaultLogger().error('Examples:')
    getDefaultLogger().error('  node scripts/decompress-binary.mjs ./node.compressed')
    getDefaultLogger().error('  node scripts/decompress-binary.mjs ./node.compressed --version')
    getDefaultLogger().error('  node scripts/decompress-binary.mjs ./node.compressed script.js')
    process.exit(1)
  }

  const compressedPath = path.resolve(args[0])
  const binaryArgs = args.slice(1)

  return { compressedPath, binaryArgs }
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
 * Build decompression tool if it doesn't exist.
 */
async function ensureToolBuilt(config) {
  const toolPath = path.join(TOOLS_DIR, config.toolName)
  const toolPathExe = `${toolPath}.exe`

  // Check if tool exists (with or without .exe extension).
  if (existsSync(toolPath) || existsSync(toolPathExe)) {
    return existsSync(toolPathExe) ? toolPathExe : toolPath
  }

  getDefaultLogger().log(`Building ${config.binaryFormat} decompression tool...`)
  getDefaultLogger().log(`  Command: ${config.buildCommand}`)
  getDefaultLogger().log('')

  const result = await spawn(config.buildCommand, {
    cwd: TOOLS_DIR,
    shell: WIN32,
    stdio: 'inherit'
  })

  if (result.code !== 0) {
    throw new Error(`Failed to build decompression tool (exit code: ${result.code})`)
  }

  // Verify tool was built.
  if (!existsSync(toolPath) && !existsSync(toolPathExe)) {
    throw new Error(`Tool ${config.toolName} was not created after build`)
  }

  return existsSync(toolPathExe) ? toolPathExe : toolPath
}

/**
 * Decompress and execute binary using platform-specific tool.
 */
async function decompressAndExecute(toolPath, compressedPath, binaryArgs, config) {
  // Validate compressed file exists.
  if (!existsSync(compressedPath)) {
    throw new Error(`Compressed file not found: ${compressedPath}`)
  }

  getDefaultLogger().log(`Decompressing ${config.binaryFormat} binary...`)
  getDefaultLogger().log(`  Compressed: ${compressedPath}`)
  if (binaryArgs.length) {
    getDefaultLogger().log(`  Arguments: ${binaryArgs.join(' ')}`)
  }
  getDefaultLogger().log('')

  // Build command arguments.
  const args = [compressedPath, ...binaryArgs]

  // Execute decompression tool (it will decompress and execute the binary).
  const result = await spawn(toolPath, args, {
    stdio: 'inherit'
  })

  // Exit with same code as the decompressed binary.
  process.exit(result.code)
}

/**
 * Main function.
 */
async function main() {
  try {
    const { compressedPath, binaryArgs } = parseArgs()
    const config = getPlatformConfig()

    getDefaultLogger().log('Socket Binary Decompression')
    getDefaultLogger().log('===========================')
    getDefaultLogger().log(`Platform: ${config.binaryFormat} (${process.platform})`)
    getDefaultLogger().log('')

    // Ensure tool is built.
    const toolPath = await ensureToolBuilt(config)

    // Decompress and execute binary.
    await decompressAndExecute(toolPath, compressedPath, binaryArgs, config)

  } catch (e) {
    getDefaultLogger().error(`Error: ${e.message}`)
    process.exit(1)
  }
}

main()
