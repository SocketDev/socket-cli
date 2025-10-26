# Yoga Layout WASM

Custom Yoga Layout WASM build optimized for Socket CLI terminal rendering with Ink.

## Overview

This package builds Yoga Layout from the official C++ implementation using Emscripten, providing a size-optimized WASM module for terminal UI rendering.

### Why Yoga C++ + Emscripten?

After exploring a pure Rust implementation with Taffy ([see research](./research/TAFFY-RESEARCH.md)), we determined that the official Yoga C++ code with Emscripten is the best approach:

✅ **100% API compatibility** - All Ink features work (measure functions, border, etc.)
✅ **Battle-tested** - Used by React Native, Facebook, and thousands of projects
✅ **Proven WASM** - Official yoga-layout package uses same approach
✅ **Smaller than expected** - Optimized build: ~65KB WASM + ~46KB JS = 111KB total

### Taffy Research (Pure Rust Exploration)

We explored building with [Taffy](https://github.com/DioxusLabs/taffy) (pure Rust flexbox engine) to avoid C++ toolchain dependencies. While promising, critical blockers emerged:

🔴 **Measure functions** - Required by Ink for text measurement, not supported by Taffy
🔴 **Border layout** - Ink uses borders extensively, Taffy v0.6 doesn't include border in layout

**Research preserved**: [research/TAFFY-RESEARCH.md](./research/TAFFY-RESEARCH.md) contains full architecture analysis, compatibility matrix, and lessons learned.

## Installation

### Prerequisites

- **Emscripten SDK**: [Install EMSDK](https://emscripten.org/docs/getting_started/downloads.html)
- **CMake 3.13+**: For configuring the build
- **Node.js 18+**: For building and testing
- **wasm-opt**: [Install Binaryen](https://github.com/WebAssembly/binaryen) for optimization

### Setup Emscripten

```bash
# Install EMSDK
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

### Building from Source

```bash
# Build WASM module
node scripts/build.mjs

# Output will be in build/wasm/
# - yoga.wasm (~65KB optimized)
# - yoga.js (~46KB)
```

### Build Options

```bash
# Force rebuild (ignore checkpoints)
node scripts/build.mjs --force

# Clean build artifacts
node scripts/clean.mjs
```

## Build Process

The build follows these optimized steps:

1. **Configure CMake** - Set up minimal Yoga build with Emscripten
2. **Compile C++ to WASM** - Use emcc with size optimizations
3. **Optimize WASM** - Apply wasm-opt with aggressive flags
4. **Verify** - Test layout calculations work correctly
5. **Export** - Copy to distribution location

### Optimization Flags

**Emscripten Compiler Flags** (`-Os`):
```bash
-Os                                 # Optimize for size
--closure 1                         # Google Closure Compiler
-s MODULARIZE=1                     # Modular output
-s EXPORT_ES6=1                     # ES6 module export
-s ALLOW_MEMORY_GROWTH=1            # Dynamic memory
-s SINGLE_FILE=1                    # Embed WASM in JS (optional)
```

**wasm-opt Flags** (Binaryen):
```bash
wasm-opt -Oz \
  --enable-simd \
  --enable-bulk-memory \
  --enable-sign-ext \
  --enable-mutable-globals \
  --low-memory-unused \
  --flatten \
  --rereloop \
  --vacuum \
  --dce \
  --remove-unused-names \
  --strip-debug \
  --strip-dwarf
```

## Usage

```javascript
import Yoga from '@socketsecurity/yoga-layout'

// Create root node
const root = Yoga.Node.create()
root.setWidth(500)
root.setHeight(300)
root.setFlexDirection(Yoga.FLEX_DIRECTION_ROW)

// Create children
const child1 = Yoga.Node.create()
child1.setFlexGrow(1)

const child2 = Yoga.Node.create()
child2.setFlexGrow(2)

root.insertChild(child1, 0)
root.insertChild(child2, 1)

// Calculate layout
root.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR)

// Read computed layout
console.log(child1.getComputedWidth())  // 166.67
console.log(child2.getComputedWidth())  // 333.33

// Cleanup
root.freeRecursive()
```

### With Ink (React for CLIs)

```javascript
import { render, Box, Text } from 'ink'

// Ink uses Yoga Layout internally
render(
  <Box flexDirection="column" padding={1}>
    <Box borderStyle="single" padding={1}>
      <Text>Hello from Socket CLI!</Text>
    </Box>
  </Box>
)
```

## Integration with Socket CLI

This package is used by Socket CLI for:
- **Ink**: Terminal UI framework (audit logs, interactive console, threat feed)
- **Ink-Table**: Table rendering in terminal
- **Layout calculations**: All terminal UI components

### Ink Features Used

From our analysis ([see details](./.claude/ink-yoga-analysis.md)):

✅ **setMeasureFunc** - Text measurement for wrapping
✅ **setBorder** - UI component borders
✅ **setFlexDirection** - Layout direction (row/column)
✅ **setFlexGrow/setFlexShrink** - Dynamic sizing
✅ **setPadding/setMargin** - Spacing
✅ **setAlignItems/setJustifyContent** - Alignment

All features work perfectly with official Yoga C++.

## Performance

### Size Comparison

| Implementation | WASM Size | JS Size | Total | Status |
|---------------|-----------|---------|-------|--------|
| **Yoga C++ (this)** | 65 KB | 46 KB | **111 KB** | ✅ Production |
| Taffy (Rust) | 230 KB | 7 KB | 237 KB | 🔬 Research only |

### Runtime Performance

Yoga is highly optimized:
- **Battle-tested** - Used in React Native (millions of devices)
- **O(n) layout** - Linear time complexity
- **Cached calculations** - Only recalculates dirty nodes
- **SIMD optimizations** - Available with modern WASM features

## Checkpoints

The build uses checkpoints for incremental builds:

```
.build-checkpoints/
├── yoga-layout-cloned      # Yoga source downloaded
├── yoga-layout-configured  # CMake configured
├── yoga-layout-built       # WASM compiled
├── yoga-layout-optimized   # wasm-opt applied
└── yoga-layout-verified    # Layout verified
```

Use `--force` flag to ignore checkpoints and rebuild from scratch.

## Troubleshooting

### Emscripten Not Found

```bash
# Ensure EMSDK is activated
source ~/emsdk/emsdk_env.sh

# Verify emcc is available
which emcc
```

### Build Fails

```bash
# Clean and rebuild
node scripts/clean.mjs
node scripts/build.mjs --force
```

### WASM Not Loading

Check that WASM file has correct magic bytes:
```bash
hexdump -C build/wasm/yoga.wasm | head -1
# Should start with: 00 61 73 6d (WASM magic number)
```

## Development

```bash
# Install dependencies
pnpm install

# Build WASM
node scripts/build.mjs

# Run tests (when available)
npm test

# Clean build
node scripts/clean.mjs
```

## References

### Official Resources
- **Yoga Layout**: https://yogalayout.dev/ (Official documentation)
- **Yoga GitHub**: https://github.com/facebook/yoga (C++ source code)
- **Emscripten**: https://emscripten.org/ (C++ to WASM compiler)
- **Ink**: https://github.com/vadimdemedes/ink (React for CLIs)

### Socket Resources
- **Taffy Research**: [research/TAFFY-RESEARCH.md](./research/TAFFY-RESEARCH.md)
- **Ink Analysis**: [.claude/ink-yoga-analysis.md](../.claude/ink-yoga-analysis.md)
- **Build Infrastructure**: `@socketsecurity/build-infra`

### Related Projects
- **yoga-layout (npm)**: Official Yoga WASM package
- **Taffy**: https://github.com/DioxusLabs/taffy (Pure Rust alternative)

## License

MIT License - Copyright (c) Socket Security

This package uses:
- Yoga Layout (MIT License, Meta Platforms)
- Emscripten (MIT/LLVM License)
