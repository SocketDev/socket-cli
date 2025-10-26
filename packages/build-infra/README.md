# Build Infrastructure

Shared build utilities for building third-party dependencies from source.

## Purpose

This package provides reusable build infrastructure used by all from-source packages:
- `node-smol-builder` - Custom Node.js runtime
- `onnx-runtime-builder` - ONNX Runtime WASM
- `codet5-models-builder` - CodeT5 model conversion/optimization
- `minilm-builder` - MiniLM model conversion/optimization
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

Build C/C++ projects to WebAssembly using Emscripten.

```javascript
import { EmscriptenBuilder } from '@socketsecurity/build-infra/lib/emscripten-builder'

const emcc = new EmscriptenBuilder(sourceDir, buildDir)

// Simple compilation
await emcc.build({
  sources: ['src/**/*.cpp'],
  output: 'output.wasm',
  flags: ['-Oz', '-flto', '--no-entry'],
  includes: ['-Iinclude'],
})

// Full CMake build pipeline
await emcc.configureCMake({
  'CMAKE_BUILD_TYPE': 'Release',
  'CMAKE_CXX_FLAGS': '-Oz',
})
await emcc.buildWithCMake({ parallel: true })
await emcc.optimize('build/output.wasm', { output: 'build/optimized.wasm' })
```

**Use cases**: Yoga Layout (C++), onnxruntime (C++), legacy C/C++ libraries.

**Prerequisites**: Emscripten SDK (EMSDK), CMake, wasm-opt (Binaryen).

### Rust Builder

Build pure Rust projects to WebAssembly using Cargo and wasm-bindgen.

```javascript
import {
  RustBuilder,
  MODERN_WASM_RUSTFLAGS,
  WASM_OPT_SIZE_FLAGS,
} from '@socketsecurity/build-infra/lib/rust-builder'

const rust = new RustBuilder(projectDir, buildDir)

// Check toolchain
if (!await rust.checkRustInstalled()) {
  throw new Error('Rust toolchain not found')
}
if (!await rust.checkWasmBindgenInstalled()) {
  throw new Error('wasm-bindgen-cli not installed')
}

// Full build pipeline (recommended)
await rust.buildPipeline({
  packageName: 'my_wasm_pkg',  // Cargo package name
  profile: 'release',          // or custom profile like 'release-wasm-fast'
  features: ['simd'],          // optional Cargo features
  outDir: 'build/pkg',         // output directory
  target: 'nodejs',            // or 'web', 'bundler', 'no-modules'
  optimize: true,              // run wasm-opt
})

// Or step-by-step for advanced control
await rust.installWasmTarget()

await rust.build({
  profile: 'release-wasm-fast',
  features: ['simd', 'parallel'],
  rustflags: MODERN_WASM_RUSTFLAGS,  // SIMD, bulk-memory, etc.
  parallel: true,
})

await rust.generateBindings({
  input: 'target/wasm32-unknown-unknown/release-wasm-fast/my_pkg.wasm',
  outDir: 'build/pkg',
  target: 'nodejs',
  typescript: true,
  debug: false,
})

await rust.optimize('build/pkg/my_pkg_bg.wasm', {
  flags: WASM_OPT_SIZE_FLAGS,  // aggressive size optimization
  output: 'build/pkg/my_pkg_bg.wasm',
})
```

**Modern WASM Features** (enabled by default via `MODERN_WASM_RUSTFLAGS`):
- SIMD (20-30% performance boost)
- Bulk memory operations
- Mutable globals
- Sign extension
- Non-trapping float-to-int conversion
- Reference types

**Optimization Flags** (applied via `WASM_OPT_SIZE_FLAGS`):
- `-Oz` - Aggressive size optimization
- `--enable-simd` - SIMD support
- `--enable-bulk-memory` - Bulk memory operations
- `--strip-debug` - Remove debug info
- `--strip-dwarf` - Remove DWARF data
- `--dce` - Dead code elimination
- Plus 10+ additional flags for maximum size reduction

**Use cases**: Acorn parser (pure Rust), Taffy layout (pure Rust), any Rust crate.

**Prerequisites**: Rust toolchain, wasm-bindgen-cli, wasm-opt (Binaryen).

**Comparison with Emscripten**:
- ✅ No C++ toolchain required
- ✅ Pure Rust, memory-safe
- ✅ Smaller JS glue code (~7KB vs ~46KB)
- ⚠️ WASM size varies by project (some Rust implementations are smaller, some larger)
- ⚠️ Limited to Rust ecosystem

**Size comparison example** (Yoga Layout):
- Emscripten (C++): 65KB WASM + 46KB JS = 111KB total
- Rust (Taffy): 230KB WASM + 7KB JS = 237KB total (2.1x total size)

Results vary significantly based on codebase complexity and optimization opportunities.

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
await createCheckpoint('onnx-runtime-builder', 'configured', { version: '1.20.1' })

// Check if step already done
if (await hasCheckpoint('onnx-runtime-builder', 'built')) {
  console.log('Already built, skipping...')
}

// Clean checkpoints
await cleanCheckpoint('onnx-runtime-builder')
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
