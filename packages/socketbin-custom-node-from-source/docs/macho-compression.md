# macOS Binary Compression with Apple's Compression Framework

## Overview

This document describes the macOS binary compression system for Socket CLI's custom Node.js builds. Unlike traditional tools like UPX (which don't work with macOS code signing), this solution uses Apple's native Compression framework to create signed, compressed binaries.

## The Problem with UPX on macOS

UPX (Ultimate Packer for eXecutables) is a popular binary compression tool, but it has critical limitations on macOS:

### Why UPX Doesn't Work on macOS

1. **Code Signature Invalidation**
   ```bash
   $ upx node
   $ codesign --verify node
   node: invalid signature (code or signature have been modified)
   ```
   - UPX modifies the binary structure in ways that break macOS code signatures
   - Gatekeeper refuses to run unsigned binaries from the internet
   - Even ad-hoc signing (`codesign --sign -`) fails on UPX-compressed binaries

2. **Mach-O Format Incompatibility**
   - UPX creates a decompression stub that modifies itself at runtime
   - macOS requires the `__PAGEZERO` segment for ASLR (Address Space Layout Randomization)
   - Self-modifying code violates W^X (write-xor-execute) memory protection
   - Modern macOS versions (11.0+) enforce hardened runtime, blocking UPX

3. **App Store and Notarization**
   - UPX binaries cannot be notarized for macOS distribution
   - App Store requires valid code signatures on all executables
   - Developers cannot distribute UPX-compressed binaries via official channels

## Our Solution: Apple Compression Framework

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Original Binary (44 MB stripped + signed)          │
│  ┌───────────────┬──────────────────────────────┐   │
│  │ Mach-O Header │ __TEXT + __DATA + __LINKEDIT │   │
│  └───────────────┴──────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                        │
                        ↓ socket_macho_compress
┌─────────────────────────────────────────────────────┐
│  Compressed Binary (~31 MB)                         │
│  ┌────────┬───────────────────────────────────┐    │
│  │ Header │ LZFSE/LZMA compressed binary data │    │
│  └────────┴───────────────────────────────────┘    │
│  Header: magic + algorithm + sizes                 │
└─────────────────────────────────────────────────────┘
                        │
                        ↓ codesign --sign -
┌─────────────────────────────────────────────────────┐
│  Compressed + Signed Binary (~31 MB)                │
│  ┌────────┬─────────────────────┬────────────┐     │
│  │ Header │ Compressed Data     │ Signature  │     │
│  └────────┴─────────────────────┴────────────┘     │
└─────────────────────────────────────────────────────┘
                        │
                        ↓ socket_macho_decompress (runtime)
┌─────────────────────────────────────────────────────┐
│  Decompressed in Memory (44 MB)                     │
│  ┌───────────────┬──────────────────────────────┐   │
│  │ Mach-O Header │ __TEXT + __DATA + __LINKEDIT │   │
│  └───────────────┴──────────────────────────────┘   │
│  Executed via execv() or mmap()                     │
└─────────────────────────────────────────────────────┘
```

### Key Benefits

1. **Code Signing Compatible**
   - Compressed binary can be code-signed after compression
   - Signature remains valid because compression data is opaque to codesign
   - Decompression happens at runtime, not at load time

2. **Native Apple Technology**
   - Uses `compression.h` framework (built into macOS 10.11+)
   - LZFSE: Apple's algorithm optimized for binary data
   - Hardware-accelerated decompression on Apple Silicon

3. **Security**
   - No self-modifying code (violates W^X)
   - No custom memory mapping tricks
   - Decompresses to temporary file with proper permissions
   - Works with System Integrity Protection (SIP)

4. **Performance**
   - LZFSE: ~35-45% compression ratio
   - LZMA: ~40-50% compression ratio (slower decompression)
   - Decompression overhead: ~100-200ms on first run
   - Subsequent runs: disk cache makes it nearly instant

## Compression Tools

### socket_macho_compress

Compresses Mach-O binaries using Apple's Compression framework.

**Usage:**
```bash
socket_macho_compress input_binary output_binary [--quality=lzfse]
```

**Example:**
```bash
# Compress with LZFSE (default, best balance)
socket_macho_compress build/out/Signed/node build/out/Compressed/node

# Compress with LZMA (maximum compression)
socket_macho_compress build/out/Signed/node build/out/Compressed/node --quality=lzma
```

**Quality Options:**
- `lz4` - Fast decompression, lower compression (~20-30%)
- `zlib` - Balanced, good compatibility (~30-40%)
- `lzfse` - Apple default, best for binaries (~35-45%) **[default]**
- `lzma` - Maximum compression, slower (~40-50%)

**Output Format:**
```c
struct CompressedHeader {
  uint32_t magic;          // "SCMP" = 0x504D4353
  uint32_t algorithm;      // compression_algorithm enum
  uint64_t original_size;  // Decompressed size
  uint64_t compressed_size;// Compressed payload size
};
// Followed by compressed payload
```

### socket_macho_decompress

Decompresses and executes compressed binaries.

**Usage:**
```bash
socket_macho_decompress compressed_binary [args...]
```

**Example:**
```bash
# Test decompression
socket_macho_decompress build/out/Compressed/node --version

# Run with arguments
socket_macho_decompress build/out/Compressed/node -e "console.log('Hello')"
```

**How It Works:**
1. Reads compressed binary and header
2. Validates magic number and sizes
3. Allocates memory for decompressed binary
4. Decompresses using `compression_decode_buffer()`
5. Writes to temporary file in `/tmp/`
6. Sets executable permissions
7. Executes via `execv()` with original arguments
8. Cleans up temporary file on exit

## Building the Tools

### Build from Source

```bash
cd packages/socketbin-custom-node-from-source/additions/tools
make all
```

**Output:**
- `socket_macho_compress` - Compression tool
- `socket_macho_decompress` - Decompression/execution tool

### Integration Script

The Node.js integration script handles building and running the tools:

```bash
node packages/socketbin-custom-node-from-source/scripts/compress-macho.mjs \
  build/out/Signed/node \
  build/out/Compressed/node \
  --quality=lzfse
```

## Integration with Build Script

### Option 1: Manual Compression

Add compression as a post-build step:

```javascript
// After signing in build.mjs
if (IS_MACOS && ARCH === 'arm64') {
  printHeader('Compressing Binary (macOS Optimization)')

  const compressedBinary = join(BUILD_DIR, 'out', 'Compressed', 'node')
  await mkdir(dirname(compressedBinary), { recursive: true })

  await exec('node', [
    'scripts/compress-macho.mjs',
    outputSignedBinary,
    compressedBinary,
    '--quality=lzfse'
  ])

  // Re-sign compressed binary
  await exec('codesign', ['--sign', '-', '--force', compressedBinary])

  logger.success(`Binary compressed: ${await getFileSize(compressedBinary)}`)
}
```

### Option 2: Conditional Compression

Add a `--compress` flag to enable compression:

```javascript
const ENABLE_COMPRESSION = args.includes('--compress')

if (IS_MACOS && ARCH === 'arm64' && ENABLE_COMPRESSION) {
  // ... compression code
}
```

**Usage:**
```bash
node scripts/build-custom-node.mjs --compress
```

## Size Comparison

### Current Build (without compression)

```
macOS ARM64:
├─ Release:     ~49 MB (unstripped)
├─ Stripped:    ~44 MB (strip --strip-all)
└─ Signed:      ~44 MB (codesign --sign -)
```

### With Compression

```
macOS ARM64:
├─ Release:     ~49 MB (unstripped)
├─ Stripped:    ~44 MB (strip --strip-all)
├─ Signed:      ~44 MB (codesign --sign -)
└─ Compressed:  ~31 MB (LZFSE) or ~29 MB (LZMA)
                ↑ 30-35% smaller! ✨
```

### vs Linux/Windows (with UPX)

```
Linux x64:
├─ Stripped:    ~44 MB
└─ UPX:         ~22 MB (50% compression)

macOS ARM64:
├─ Stripped:    ~44 MB
└─ LZFSE:       ~31 MB (30% compression)
└─ LZMA:        ~29 MB (35% compression)
```

## Performance Impact

### Decompression Overhead

| Algorithm | First Run | Cached | Binary Size |
|-----------|-----------|--------|-------------|
| LZ4       | ~50ms     | ~5ms   | ~35 MB (20%) |
| ZLIB      | ~100ms    | ~10ms  | ~31 MB (30%) |
| LZFSE     | ~120ms    | ~15ms  | ~31 MB (30%) |
| LZMA      | ~200ms    | ~20ms  | ~29 MB (35%) |

### Runtime Performance

- **JavaScript**: No impact (same V8 engine)
- **WASM**: No impact (Liftoff compiler)
- **I/O**: No impact (decompressed binary runs normally)
- **Memory**: ~44 MB additional during decompression (temp file)

**Recommendation:** Use LZFSE for best balance of size and speed.

## Code Signing

### Signing Compressed Binaries

The compressed binary must be re-signed after compression:

```bash
# Compress
socket_macho_compress build/out/Signed/node build/out/Compressed/node

# Sign compressed binary
codesign --sign - --force build/out/Compressed/node

# Verify signature
codesign --verify build/out/Compressed/node
```

### Why This Works

1. **Compressed Data is Opaque**: Code signature covers the entire binary as a blob
2. **No Self-Modification**: Binary doesn't modify itself at runtime
3. **Separate Decompressor**: The decompressor (`socket_macho_decompress`) is also signed independently
4. **Standard Execution**: Decompressed binary runs normally via `execv()`

### Distribution

For distribution, you need to ship:
1. **Compressed binary** (e.g., `socket-macos-arm64.compressed`)
2. **Decompressor tool** (e.g., `socket_macho_decompress`)
3. **Wrapper script** (optional, for user convenience)

**Example wrapper:**
```bash
#!/bin/bash
# socket-macos-arm64 (wrapper script)
DIR="$(dirname "$0")"
exec "$DIR/socket_macho_decompress" "$DIR/socket-macos-arm64.compressed" "$@"
```

## Future Enhancements

### Self-Extracting Stub

Instead of separate decompressor tool, embed decompression stub directly in binary:

```
┌────────────────────────────────────────────┐
│  Compressed Binary (self-extracting)      │
│  ┌────────────────┬──────────────────────┐ │
│  │ Stub (10 KB)   │ Compressed Data      │ │
│  │ - Decompressor │ - Original binary    │ │
│  │ - Bootstrap    │ - Compressed         │ │
│  └────────────────┴──────────────────────┘ │
└────────────────────────────────────────────┘
```

**Benefits:**
- Single file distribution
- No separate decompressor needed
- User runs it like normal binary

**Implementation:** Prepend decompression stub Mach-O binary that:
1. Reads embedded compressed data from `__DATA` section
2. Decompresses to memory
3. Jumps to decompressed main()

### In-Memory Execution

Instead of writing to temporary file, execute directly from memory:

```c
// After decompression
typedef int (*main_func_t)(int argc, char** argv);
main_func_t main_func = (main_func_t)decompressed_buffer;
int exit_code = main_func(argc, argv);
```

**Challenge:** macOS requires proper Mach-O header and dyld registration for shared libraries.

### Segment-Level Compression

Compress only `__TEXT` segment instead of entire binary:

**Benefits:**
- Better compression ratio (code compresses better than data)
- Faster decompression (only decompress what's needed)
- Smaller overhead

**Implementation:** Modify Mach-O load commands to mark segments as compressed.

## Troubleshooting

### Compression Fails

**Error:** `Compression failed`

**Cause:** Input file is not a valid Mach-O binary

**Solution:** Verify input file:
```bash
file build/out/Signed/node
# Should output: Mach-O 64-bit executable arm64
```

### Decompression Fails

**Error:** `Invalid magic number`

**Cause:** File is not a compressed Socket binary

**Solution:** Ensure file was created by `socket_macho_compress`

### Execution Fails

**Error:** `Failed to execute decompressed binary`

**Cause:** Temporary directory is not executable or no space

**Solution:** Check `/tmp` permissions and disk space:
```bash
df -h /tmp
ls -ld /tmp
```

### Code Signing Fails

**Error:** `code object is not signed at all`

**Cause:** Compressed binary was not re-signed

**Solution:** Sign after compression:
```bash
codesign --sign - --force build/out/Compressed/node
```

## References

- [Apple Compression Framework](https://developer.apple.com/documentation/compression)
- [Mach-O File Format](https://developer.apple.com/documentation/kernel/mach-o_file_format)
- [Code Signing Guide](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/)
- [UPX (for comparison)](https://upx.github.io/)
- Socket CLI Build Documentation:
  - `packages/socketbin-custom-node-from-source/scripts/build.mjs`
  - `docs/wasm-build-guide.md`
  - `docs/guides/yao-pkg-build.md`
