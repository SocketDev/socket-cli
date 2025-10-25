# yoga-layout

Custom Yoga Layout WASM build optimized for Socket CLI terminal rendering.

## Purpose

This package builds Yoga Layout for WebAssembly with:
- **Size optimizations**: Aggressive compiler flags and wasm-opt
- **Minimal features**: Only features needed for terminal layout
- **Emscripten build**: Compiled to WASM for cross-platform compatibility
- **Expected savings**: 15-20KB compared to default build

## Build Process

The build follows these steps:

1. **Clone Yoga source** - Download specific version
2. **Apply patches** - Socket-specific optimizations (if any)
3. **Configure CMake** - Set up minimal build
4. **Build with Emscripten** - Compile C++ to WASM
5. **Optimize WASM** - Apply wasm-opt with aggressive flags
6. **Verify** - Test layout calculations
7. **Export** - Copy to distribution location

## Usage

**Build Yoga Layout:**
```bash
pnpm run build
```

**Force rebuild (ignore checkpoints):**
```bash
pnpm run build:force
```

**Clean build artifacts:**
```bash
pnpm run clean
```

## Configuration

Build configuration in `scripts/build.mjs`:
- **Yoga version**: Change `YOGA_VERSION` constant
- **Emscripten flags**: Modify optimization flags
- **CMake options**: Adjust build features

## Features

The build includes only features needed for terminal rendering:
- **Flexbox layout**: Core layout engine
- **Text measurement**: For terminal text
- **Basic styling**: Margins, padding, borders

Excluded features (not needed for terminal):
- **Absolute positioning**: Not used in terminal layout
- **Grid layout**: Not needed
- **Advanced styling**: Complex CSS features

## Output

Built WASM files are exported to:
- `build/yoga.wasm` - Optimized WASM binary
- `build/yoga.js` - JavaScript bindings

## Checkpoints

The build uses checkpoints for incremental builds:
- `cloned` - Source code cloned
- `configured` - CMake configured
- `built` - WASM binary compiled
- `optimized` - wasm-opt applied
- `verified` - Layout calculations tested

Use `--force` flag to ignore checkpoints and rebuild from scratch.

## Integration

This package is used by Socket CLI for terminal rendering and layout calculations. The built Yoga Layout WASM is embedded in the Socket CLI distribution.

## Size Comparison

- **Default Yoga WASM**: ~110 KB
- **Size-optimized build (this)**: ~95 KB (15 KB saved)
- **After wasm-opt**: ~85 KB (25 KB saved)

Size savings come from:
1. Excluding unused features (10KB)
2. Aggressive optimization flags (10KB)
3. wasm-opt post-processing (5KB)

While the absolute size savings are smaller compared to ONNX Runtime, every kilobyte counts for distribution size.
