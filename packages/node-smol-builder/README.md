# @socketbin/node-smol-builder-builder

Custom Node.js binary builder with Socket security patches.

**This is a private package used for building Socket CLI binaries.**

## What It Does

Builds a custom Node.js v24.10.0 binary from source with:
- Socket security patches
- Brotli compression support
- SEA (Single Executable Application) support
- Bootstrap integration

## Building

### Standard Build

```bash
cd packages/node-smol-builder
node scripts/build.mjs
```

### Build without Compression (Opt-out)

Compression is **enabled by default** (it's called "smol" for a reason! 😄)

```bash
cd packages/node-smol-builder
node scripts/build.mjs                     # Default: WITH compression (33 MB → 13 MB)
COMPRESS_BINARY=0 node scripts/build.mjs   # Opt-out: WITHOUT compression (33 MB)
```

The build process:
1. Downloads Node.js v24.10.0 source
2. Applies Socket security patches from `patches/`
3. Configures and compiles Node.js with size optimizations
4. Copies bootstrap code to internal modules
5. Strips debug symbols (44 MB → 23-27 MB)
6. Signs the binary (macOS ARM64)
7. **Default:** Compresses binary (23-27 MB → 10-12 MB)
8. **Default:** Bundles platform-specific decompression tool

## Output

**Default build (with compression):**
- `build/out/Release/node` - Unstripped binary (44 MB)
- `build/out/Stripped/node` - Stripped binary (23-27 MB)
- `build/out/Signed/node` - Stripped + signed (macOS ARM64)
- `build/out/Final/node` - Final binary for distribution (23-27 MB)
- `build/out/Compressed/node` - **Compressed binary (10-12 MB)** ← Default output
- `build/out/Compressed/socket_*_decompress` - Decompression tool (~90 KB)
- `dist/socket-smol` - E2E test binary (copy of Compressed)

**Without compression (`COMPRESS_BINARY=0`):**
- Same as above, but skips Compressed directory
- `dist/socket-smol` - E2E test binary (copy of Final, uncompressed)

## Platform Support

Currently builds for the host platform only. Cross-compilation not yet supported.

## License

MIT
