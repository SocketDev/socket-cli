#!/usr/bin/env node
/**
 * @fileoverview Wrapper for yao-pkg patched Node.js binary.
 *
 * Yao-pkg patched binaries have modified argument processing due to PKG bootstrap patches.
 * They cannot handle standard Node.js flags like --version, --help, -e, etc.
 * This wrapper translates standard Node.js invocations to yao-compatible script execution.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const YAO_BINARY = join(__dirname, 'node')

// Get command line arguments (skip node and script name).
const args = process.argv.slice(2)

if (args.length === 0) {
  // No arguments - start REPL (not supported by yao-pkg).
  console.error('Error: REPL not supported with yao-pkg binaries')
  process.exit(1)
}

const firstArg = args[0]

// Handle special flags that yao-pkg cannot process.
if (firstArg === '--version' || firstArg === '-v') {
  // Create temp script to get version.
  const tempDir = mkdtempSync(join(tmpdir(), 'yao-version-'))
  const tempScript = join(tempDir, 'version.js')

  try {
    writeFileSync(tempScript, 'console.log(process.version)')
    const result = spawnSync(YAO_BINARY, [tempScript], {
      stdio: 'inherit',
      encoding: 'utf8',
    })
    process.exit(result.status ?? 0)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
} else if (firstArg === '-e' || firstArg === '--eval') {
  // Eval mode: create temp script with the code.
  const code = args[1]
  if (!code) {
    console.error('Error: -e requires code argument')
    process.exit(1)
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'yao-eval-'))
  const tempScript = join(tempDir, 'eval.js')

  try {
    writeFileSync(tempScript, code)
    const result = spawnSync(YAO_BINARY, [tempScript, ...args.slice(2)], {
      stdio: 'inherit',
      encoding: 'utf8',
    })
    process.exit(result.status ?? 0)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
} else if (firstArg === '-p' || firstArg === '--print') {
  // Print mode: wrap code in console.log().
  const code = args[1]
  if (!code) {
    console.error('Error: -p requires code argument')
    process.exit(1)
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'yao-print-'))
  const tempScript = join(tempDir, 'print.js')

  try {
    writeFileSync(tempScript, `console.log(${code})`)
    const result = spawnSync(YAO_BINARY, [tempScript, ...args.slice(2)], {
      stdio: 'inherit',
      encoding: 'utf8',
    })
    process.exit(result.status ?? 0)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
} else if (firstArg === '--help' || firstArg === '-h') {
  // Show help.
  console.log('Usage: yao-wrapper [options] [script.js] [arguments]')
  console.log('')
  console.log('Options:')
  console.log('  -v, --version     Print Node.js version')
  console.log('  -e, --eval code   Evaluate code')
  console.log('  -p, --print code  Evaluate code and print result')
  console.log('  -h, --help        Print this help message')
  console.log('')
  console.log('This is a wrapper for yao-pkg patched Node.js binaries.')
  console.log('Yao-pkg binaries require scripts to be passed as files, not flags.')
  process.exit(0)
} else if (firstArg.startsWith('-')) {
  // Unknown flag - yao-pkg will fail on these.
  console.error(`Error: Unknown or unsupported flag: ${firstArg}`)
  console.error('Yao-pkg binaries do not support most Node.js command-line flags.')
  console.error('Use yao-wrapper --help for supported options.')
  process.exit(1)
} else {
  // Assume first argument is a script file - pass directly to yao binary.
  const result = spawnSync(YAO_BINARY, args, {
    stdio: 'inherit',
    encoding: 'utf8',
  })
  process.exit(result.status ?? 0)
}
