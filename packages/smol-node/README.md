# smol-node

Custom Node.js build with Socket.dev patches and optimizations for use in Socket CLI distribution.

## Purpose

This package builds a minimal Node.js runtime from source with:
- **Socket patches**: Custom patches for enhanced security and yao-pkg integration
- **Size optimizations**: Aggressive compiler flags to reduce binary size
- **Brotli compression**: SEA support with Brotli compression
- **yao-pkg patches**: Modified argument handling for proper PKG_DUMMY_ENTRYPOINT behavior

## Build Process

The build process follows these steps:

1. **Clone Node.js source** - Download specific Node.js version
2. **Apply Socket patches** - Apply all patches from `patches/socket/`
3. **Configure** - Configure build with optimization flags
4. **Build** - Compile Node.js with parallel jobs
5. **Strip & Sign** - Strip debug symbols and code sign binary
6. **Verify** - Smoke test the built binary
7. **Export** - Copy to distribution location

## Usage

**Build Node.js:**
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

Build configuration can be customized in `scripts/build.mjs`:
- **Node.js version**: Change `NODE_VERSION` constant
- **Optimization flags**: Modify `OPTIMIZATION_FLAGS`
- **Build options**: Adjust CMake configuration options

## Patches

All Socket patches are stored in `patches/socket/`:
- `001-brotli-sea-support.patch` - Brotli compression for SEA
- `002-yao-pkg-integration.patch` - yao-pkg argument handling
- `003-size-optimizations.patch` - Additional size optimizations

See `patches/socket/README.md` for patch creation and management guidelines.

## Output

Built binaries are exported to:
- `.node-source/out/Release/node` - Main build output
- `build/out/Release/node` - Distribution copy

## Checkpoints

The build uses checkpoints to enable incremental builds:
- `cloned` - Source code cloned
- `patched` - Patches applied
- `configured` - CMake configured
- `built` - Binary compiled
- `verified` - Smoke test passed

Use `--force` flag to ignore checkpoints and rebuild from scratch.

## Integration

This package is used by Socket CLI's build process to create the custom Node.js runtime for the standalone binary distribution. The built Node.js binary is embedded in the final Socket CLI executable.
