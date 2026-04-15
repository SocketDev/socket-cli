#!/usr/bin/env node
/**
 * Test script to verify @socketaddon/iocraft package works correctly.
 * This tests the development fallback path that loads from sibling directories.
 */

import { createRequire } from 'node:module'
import { platform, arch } from 'node:os'

const require = createRequire(import.meta.url)

console.log('Testing @socketaddon/iocraft package...\n')
console.log(`Platform: ${platform()} ${arch()}`)

try {
  // Test loading the native binary directly first
  const platformName = platform()
  const archName = arch()

  const platformMap = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'win',
  }

  const archMap = {
    arm64: 'arm64',
    x64: 'x64',
  }

  const mappedPlatform = platformMap[platformName]
  const mappedArch = archMap[archName]
  const platformId = `${mappedPlatform}-${mappedArch}`

  console.log(`Testing native binary for ${platformId}...\n`)

  // Try to load the native binary directly
  const nativePath = `./build/dev/out/socketaddon-iocraft-${platformId}/iocraft.node`
  const nativeModule = require(nativePath)
  console.log('✓ Successfully loaded native binary directly')
  console.log('  Available functions:', Object.keys(nativeModule).join(', '))

  // Now test the main package (should use dev fallback)
  const iocraftModule = require('./build/dev/out/socketaddon-iocraft/index.mjs')
  const iocraft = iocraftModule.default || iocraftModule
  console.log('\n✓ Successfully loaded @socketaddon/iocraft via main package')

  // Test text() function
  const textNode = iocraft.text('Hello, World!')
  console.log('✓ text() function works')
  console.log('  textNode.type:', textNode.type)
  console.log('  textNode.content:', textNode.content)

  // Test view() function
  const viewNode = iocraft.view([textNode])
  console.log('✓ view() function works')
  console.log('  viewNode.type:', viewNode.type)
  console.log('  viewNode.children.length:', viewNode.children?.length)

  // Test renderToString() function
  const rendered = iocraft.renderToString(textNode)
  console.log('✓ renderToString() function works')
  console.log('  rendered:', JSON.stringify(rendered))

  // Test getTerminalSize() function
  const size = iocraft.getTerminalSize()
  console.log('✓ getTerminalSize() function works')
  console.log('  size:', size)

  // Test TuiRenderer class
  const renderer = new iocraft.TuiRenderer()
  console.log('✓ TuiRenderer class works')
  console.log('  renderer.isRunning():', renderer.isRunning())

  console.log('\n✅ All tests passed! Package is working correctly.')
  process.exit(0)
} catch (e) {
  console.error('\n❌ Test failed:', e.message)
  console.error(e.stack)
  process.exit(1)
}
