# Build Infrastructure

Shared build utilities for building third-party dependencies from source.

## Purpose

This package provides reusable build infrastructure used by all from-source packages:
- `smol-node` - Custom Node.js runtime
- `onnx-runtime` - ONNX Runtime WASM
- `codet5-models` - CodeT5 model conversion/optimization
- `yoga-layout` - Yoga Layout WASM

## Exports

### Command Execution
```javascript
import { exec, execCapture } from '@socketsecurity/build-infra/lib/build-exec'

// Execute command with stdio inheritance
await exec('cmake --build build', { stdio: 'inherit' })

// Execute and capture output
const { stdout, stderr, code } = await execCapture('git rev-parse HEAD')
```

### Build Helpers
```javascript
import {
  checkDiskSpace,
  checkCompiler,
  checkPythonVersion,
  estimateBuildTime,
  formatDuration,
  smokeTestBinary,
} from '@socketsecurity/build-infra/lib/build-helpers'

// Check prerequisites
await checkDiskSpace(5 * 1024 * 1024 * 1024) // 5 GB
await checkCompiler('clang++')
await checkPythonVersion('3.8')

// Smoke test binary
await smokeTestBinary('./build/node', ['--version'])
```

### Pretty Output
```javascript
import {
  printHeader,
  printStep,
  printSubstep,
  printSuccess,
  printError,
  printWarning,
} from '@socketsecurity/build-infra/lib/build-output'

printHeader('Build Node.js from Source')
printStep('Cloning repository')
printSubstep('Fetching v24.10.0')
printSuccess('Build complete!')
```

### CMake Builder
```javascript
import { CMakeBuilder } from '@socketsecurity/build-infra/lib/cmake-builder'

const cmake = new CMakeBuilder(sourceDir, buildDir)

await cmake.configure({
  'CMAKE_BUILD_TYPE': 'Release',
  'CMAKE_C_FLAGS': '-Oz -flto=thin',
})

await cmake.build({ parallel: true })
```

### Emscripten Builder
```javascript
import { EmscriptenBuilder } from '@socketsecurity/build-infra/lib/emscripten-builder'

const emcc = new EmscriptenBuilder(sourceDir, buildDir)

await emcc.build({
  sources: ['src/**/*.cpp'],
  output: 'output.wasm',
  flags: ['-Oz', '-flto', '--no-entry'],
  includes: ['-Iinclude'],
})
```

### Patch Validator
```javascript
import {
  validatePatch,
  applyPatch,
  applyPatchDirectory,
  testPatchApplication,
} from '@socketsecurity/build-infra/lib/patch-validator'

// Apply all patches in directory
await applyPatchDirectory('./patches/socket', './source')

// Apply single patch
await applyPatch('./patches/001-fix.patch', './source')
```

### Checkpoint Manager
```javascript
import {
  createCheckpoint,
  hasCheckpoint,
  cleanCheckpoint,
  getCheckpointData,
} from '@socketsecurity/build-infra/lib/checkpoint-manager'

// Save build state
await createCheckpoint('onnx-runtime', 'configured', { version: '1.20.1' })

// Check if step already done
if (await hasCheckpoint('onnx-runtime', 'built')) {
  console.log('Already built, skipping...')
}

// Clean checkpoints
await cleanCheckpoint('onnx-runtime')
```

## Pattern

All from-source packages follow this pattern:

1. **Check prerequisites** (disk space, compilers, etc.)
2. **Clone/download source**
3. **Apply custom patches**
4. **Configure build** (CMake, Emscripten, etc.)
5. **Build** with custom flags
6. **Optimize** (wasm-opt, strip, etc.)
7. **Verify** output
8. **Export** artifacts

This package provides the infrastructure for steps 1-7.
