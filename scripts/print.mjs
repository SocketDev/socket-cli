/**
 * @fileoverview Common print utilities for scripts.
 */

import colors from 'yoctocolors-cjs'

export function printDivider() {
  console.log('═══════════════════════════════════════════════════════')
}

export function printHeader(title) {
  printDivider()
  console.log(`  ${title}`)
  printDivider()
}

// New clear naming for success/error footers
export function printSuccessFooter(message) {
  console.log('')
  printDivider()
  console.log(`${colors.green('✓')} ${message}`)
  printDivider()
}

export function printErrorFooter(message) {
  console.log('')
  printDivider()
  console.error(`${colors.red('✗')} ${message}`)
  printDivider()
}

// Renamed for clarity - just prints a title without decoration
export function printTitle(name) {
  console.log(`${name}`)
}

// Decide success/error footer based on parameter
export function printFooter(message, success = true) {
  if (success) {
    printSuccessFooter(message)
  } else {
    printErrorFooter(message)
  }
}

// Clearer name for help headers
export function printHelpHeader(name) {
  console.log(`${name}`)
}