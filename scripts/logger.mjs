/**
 * @fileoverview Unified logger for scripts with consistent interface.
 */

import colors from 'yoctocolors-cjs'

// Unified logger with consistent methods
export const logger = {
  // Basic output
  info: msg => console.log(msg),
  warn: msg => console.warn(`${colors.yellow('⚠')} ${msg}`),
  error: msg => console.error(`${colors.red('✗')} ${msg}`),
  success: msg => console.log(`${colors.green('✓')} ${msg}`),

  // Progress indicators with clear names
  startProgress: msg => process.stdout.write(`  ∴ ${msg}`),
  endProgress: msg => {
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.green('✓')} ${msg}`)
  },
  failProgress: msg => {
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.red('✗')} ${msg}`)
  },

  // Structural output
  section: msg => console.log(`\n${msg}`),
  subsection: msg => console.log(`  ${msg}`)
}

export default logger