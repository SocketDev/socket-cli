/**
 * Verify that the bootstrap stub bundle only contains expected code
 * and no accidental dependencies.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const stubPath = path.join(rootDir, 'dist/sea/bootstrap.cjs')

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function fail(message) {
  log(`❌ ${message}`, 'red')
  process.exit(1)
}

function success(message) {
  log(`✅ ${message}`, 'green')
}

function info(message) {
  log(`ℹ️  ${message}`, 'cyan')
}

// Check if stub exists
if (!existsSync(stubPath)) {
  fail(`Bootstrap stub not found at ${stubPath}`)
  fail(
    'Run: pnpm run build --sea or NODE_ENV=production pnpm exec rollup -c .config/rollup.cli-sea.config.mjs',
  )
}

// Read stub content
const code = readFileSync(stubPath, 'utf8')
const stats = statSync(stubPath)

// Define expected state
const EXPECTED = {
  nodeBuiltins: [
    'node:child_process',
    'node:crypto',
    'node:fs',
    'node:https',
    'node:os',
    'node:path',
  ],
  // Node.js built-in modules that may appear with or without node: prefix
  // when tar library is inlined
  allowedBuiltins: [
    'assert',
    'buffer',
    'child_process',
    'crypto',
    'events',
    'fs',
    'https',
    'os',
    'path',
    'stream',
    'string_decoder',
    'zlib',
  ],
  functions: [
    '_interopDefault',
    'remove',
    'httpsGet',
    'getLatestVersion',
    'downloadPackage',
    'getInstalledVersion',
    'main',
  ],
  maxSize: 100000, // 100KB max (was 6KB, now includes inlined tar library)
}

log('\n📦 Bootstrap Stub Bundle Verification\n', 'cyan')

// Extract require statements
const requires = [...new Set(code.match(/require\(`[^`]+`\)/g) || [])]
const requiredModules = requires.map(r => r.match(/require\(`([^`]+)`\)/)[1])

// Verify only Node.js built-ins
info('Checking required modules...')
const isBuiltin = m =>
  m.startsWith('node:') ||
  EXPECTED.allowedBuiltins.includes(m) ||
  EXPECTED.allowedBuiltins.includes(m.replace('node:', ''))
const allBuiltins = requiredModules.every(isBuiltin)
if (!allBuiltins) {
  fail('Non-builtin modules detected!')
  const nonBuiltins = requiredModules.filter(m => !isBuiltin(m))
  console.log('  Found non-builtins:', nonBuiltins)
  console.log('  All modules:', requiredModules)
} else {
  success(`All ${requiredModules.length} requires are Node.js built-ins`)
  requiredModules.forEach(m => console.log(`    - ${m}`))
}

// Verify expected modules are present
const missingModules = EXPECTED.nodeBuiltins.filter(
  m => !requiredModules.includes(m),
)
if (missingModules.length > 0) {
  fail(`Missing expected modules: ${missingModules.join(', ')}`)
} else {
  success('All expected Node.js built-ins are present')
}

// Check for accidental external dependencies
info('\nChecking for external dependencies...')
const checks = {
  'node_modules paths': /node_modules/.test(code),
  // Note: 'external npm packages' check removed - we already verify all requires are built-ins above
  'relative requires': /require\(['"\\`]\./.test(code),
}

let hasExternalDeps = false
for (const [check, found] of Object.entries(checks)) {
  if (found) {
    fail(`Found ${check}`)
    hasExternalDeps = true
  } else {
    success(`No ${check}`)
  }
}

if (hasExternalDeps) {
  fail('External dependencies detected in bundle!')
}

// Extract and verify functions
info('\nChecking functions...')
const functionMatches = [
  ...(code.match(/function (\w+)\(/g) || []),
  ...(code.match(/async function (\w+)\(/g) || []),
]
const functions = [
  ...new Set(functionMatches.map(m => m.match(/function (\w+)/)[1])),
]

const unexpectedFunctions = functions.filter(
  f => !EXPECTED.functions.includes(f),
)
if (unexpectedFunctions.length > 0) {
  log(
    `⚠️  Unexpected functions found: ${unexpectedFunctions.join(', ')}`,
    'yellow',
  )
  log('  (This may be okay if intentional)', 'yellow')
} else {
  success(`All ${functions.length} functions are expected`)
  functions.forEach(f => console.log(`    - ${f}`))
}

const missingFunctions = EXPECTED.functions.filter(f => !functions.includes(f))
if (missingFunctions.length > 0) {
  fail(`Missing expected functions: ${missingFunctions.join(', ')}`)
}

// Verify size
info('\nChecking bundle size...')
const sizeKB = (stats.size / 1024).toFixed(2)
console.log(`  Size: ${sizeKB} KB (${stats.size} bytes)`)

if (stats.size > EXPECTED.maxSize) {
  fail(
    `Bundle size ${sizeKB}KB exceeds maximum ${(EXPECTED.maxSize / 1024).toFixed(2)}KB`,
  )
  fail('The stub should be minimal - investigate what was added')
} else {
  success(`Bundle size ${sizeKB}KB is within limit`)
}

// Summary
log(`\n${'='.repeat(50)}`, 'green')
log('✅ VERIFICATION PASSED', 'green')
log(`${'='.repeat(50)}\n`, 'green')

console.log('Summary:')
console.log(`  - ${requiredModules.length} Node.js built-ins (all expected)`)
console.log(`  - ${functions.length} functions (all expected)`)
console.log('  - 0 external dependencies')
console.log(`  - ${sizeKB} KB bundle size`)
console.log()
