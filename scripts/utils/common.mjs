/**
 * @fileoverview Common utilities shared across all scripts.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import colors from 'yoctocolors-cjs'

// Get root path
export const getRootPath = (importMetaUrl) => {
  const __dirname = path.dirname(fileURLToPath(importMetaUrl))
  return path.join(__dirname, '..', '..')
}

// Console logging utilities
export const log = {
  info: msg => console.log(msg),
  error: msg => console.error(`${colors.red('✗')} ${msg}`),
  success: msg => console.log(`${colors.green('✓')} ${msg}`),
  warn: msg => console.log(`${colors.yellow('⚠')} ${msg}`),
  step: msg => console.log(`\n${msg}`),
  substep: msg => console.log(`  ${msg}`),
  progress: msg => {
    process.stdout.write(`  ∴ ${msg}`)
  },
  done: msg => {
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.green('✓')} ${msg}`)
  },
  failed: msg => {
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.red('✗')} ${msg}`)
  }
}

// Print divider
export function printDivider() {
  console.log('═══════════════════════════════════════════════════════')
}

// Print header with divider
export function printHeader(title) {
  printDivider()
  console.log(`  ${title}`)
  printDivider()
}

// Print footer with divider
export function printFooter(message, success = true) {
  console.log('')
  printDivider()
  if (success) {
    log.success(message)
  } else {
    log.error(message)
  }
  printDivider()
}

// Standard help header
export function printHelpHeader(name) {
  console.log(`Socket PackageURL ${name}`)
}

// Handle quiet options
export function isQuiet(values) {
  return values.quiet || values.silent
}

// Exit with code
export function exit(code = 0) {
  process.exitCode = code
  if (code !== 0) {
    throw new Error('Script failed')
  }
}