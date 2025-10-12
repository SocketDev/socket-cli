/**
 * @fileoverview Common utilities shared across all scripts.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import colors from 'yoctocolors-cjs'

// Get root path.
export const getRootPath = importMetaUrl => {
  const __dirname = path.dirname(fileURLToPath(importMetaUrl))
  return path.join(__dirname, '..')
}

// Simple print utilities for scripts - avoid re-exporting from lib.

export const printDivider = (char = '═') => console.log(char.repeat(55))
export const printHeader = title => {
  printDivider()
  console.log(`  ${title}`)
  printDivider()
}
export const printFooterLine = () => console.log('─'.repeat(55))
export const printDottedLine = () => console.log('·'.repeat(55))
export const printDiamondLine = () => console.log('◆'.repeat(55))
export const printFooter = msg => {
  printFooterLine()
  if (msg) {
    console.log(colors.green(msg))
  }
}
export const printHelpHeader = name => console.log(`Socket CLI ${name}`)
export const printSuccess = msg => console.log(colors.green(`✓ ${msg}`))
export const printError = msg => console.error(colors.red(`✗ ${msg}`))
export const printWarning = msg => console.warn(colors.yellow(`⚠ ${msg}`))
export const printInfo = msg => console.log(colors.blue(`ℹ ${msg}`))
export const printIndented = (msg, indent = 2) =>
  console.log(' '.repeat(indent) + msg)

// Console logging utilities with special formatting.
// These have different behavior than the print utilities above.
export const log = {
  info: msg => console.log(msg),
  error: msg => printError(msg),
  success: msg => printSuccess(msg),
  warn: msg => printWarning(msg),
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
  },
}

// Local argv utilities for scripts - avoid dependency on dist.
const argv = process.argv.slice(2)
export const isQuiet = () => argv.includes('--quiet') || argv.includes('-q')
export const isVerbose = () => argv.includes('--verbose') || argv.includes('-v')
export const isForced = () => argv.includes('--force') || argv.includes('-f')
export const isDryRun = () => argv.includes('--dry-run')
export const COMMON_SCRIPT_FLAGS = [
  '--quiet',
  '--verbose',
  '--force',
  '--dry-run',
]
export const getCommonScriptFlags = () =>
  argv.filter(arg => COMMON_SCRIPT_FLAGS.includes(arg))

// Exit with code.
export function exit(code = 0) {
  process.exitCode = code
  if (code !== 0) {
    throw new Error('Script failed')
  }
}
