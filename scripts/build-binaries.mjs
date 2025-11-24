/**
 * Build Socket binaries (WASM, SEA, smol) without running tests.
 *
 * Usage:
 *   pnpm run build:binaries              # All binaries
 *   pnpm run build:binaries --wasm       # Just WASM
 *   pnpm run build:binaries --sea        # Just SEA
 *   pnpm run build:binaries --smol       # Just smol
 *   pnpm run build:binaries --smol --sea # Multiple
 */

import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'

import { WIN32 } from '@socketsecurity/lib/constants/platform'

const { values } = parseArgs({
  options: {
    wasm: { type: 'boolean' },
    sea: { type: 'boolean' },
    smol: { type: 'boolean' },
    dev: { type: 'boolean' },
    prod: { type: 'boolean' },
    clean: { type: 'boolean' },
  },
  strict: false,
})

// If no specific binary selected, build all.
const buildAll = !values.wasm && !values.sea && !values.smol
const buildWasm = buildAll || values.wasm
const buildSea = buildAll || values.sea
const buildSmol = buildAll || values.smol

const tasks = []

// Build bootstrap first (required for all binaries).
console.log('\n🔨 Building bootstrap...\n')
tasks.push({
  name: 'bootstrap',
  cmd: 'pnpm',
  args: ['--filter', '@socketsecurity/bootstrap', 'run', 'build'],
})

// Build CLI (required for binaries).
console.log('🔨 Building CLI...\n')
tasks.push({
  name: 'cli',
  cmd: 'pnpm',
  args: ['--filter', '@socketsecurity/cli', 'run', 'build'],
})

// Build WASM (slowest, optional).
if (buildWasm) {
  const wasmArgs = ['run', values.dev ? 'wasm:build:dev' : 'wasm:build']
  console.log(`🔨 Building WASM ${values.dev ? '(dev mode)' : ''}...\n`)
  tasks.push({ name: 'wasm', cmd: 'pnpm', args: wasmArgs })
}

// Build SEA binary.
if (buildSea) {
  const seaArgs = [
    '--filter',
    '@socketsecurity/node-sea-builder',
    'run',
    'build',
  ]
  if (values.dev) {seaArgs.push('--dev')}
  if (values.prod) {seaArgs.push('--prod')}
  if (values.clean) {seaArgs.push('--clean')}
  console.log('🔨 Building SEA binary...\n')
  tasks.push({ name: 'sea', cmd: 'pnpm', args: seaArgs })
}

// Build smol binary.
if (buildSmol) {
  const smolArgs = [
    '--filter',
    '@socketsecurity/node-smol-builder',
    'run',
    'build',
  ]
  if (values.dev) {smolArgs.push('--dev')}
  if (values.prod) {smolArgs.push('--prod')}
  if (values.clean) {smolArgs.push('--clean')}
  console.log('🔨 Building smol binary...\n')
  tasks.push({ name: 'smol', cmd: 'pnpm', args: smolArgs })
}

// Run tasks sequentially.
async function runTask(task) {
  return new Promise((resolve, reject) => {
    const proc = spawn(task.cmd, task.args, {
      stdio: 'inherit',
      shell: WIN32,
    })

    proc.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${task.name} build failed with code ${code}`))
      }
    })
  })
}

;(async () => {
  const startTime = Date.now()

  for (const task of tasks) {
    try {
      await runTask(task)
    } catch (error) {
      console.error(`\n❌ Build failed: ${error.message}`)
      process.exit(1)
    }
  }

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
  console.log(`\n✅ All binaries built successfully in ${duration}m`)
})()
