# Socket Binary Compression Tools

Cross-platform binary compression tools providing UPX-like compression **without antivirus false positives**.

## Overview

These tools provide **safe, native binary compression** for macOS, Linux, and Windows that:
- ✓ Work with code signing (macOS)
- ✓ Use native OS APIs (no antivirus flags)
- ✓ Achieve 70-80% compression (better than UPX)
- ✓ Support all major platforms

**Why not UPX?** UPX triggers 15-30% of antivirus vendors, breaks macOS code signing, and achieves only 50-60% compression. These tools use native OS compression APIs that are trusted by security software and achieve better compression ratios.

## Tools

### macOS (Mach-O)

**socket_macho_compress** - Compresses macOS binaries using Apple's Compression framework.

**Features:**
- 70-80% size reduction (LZMA)
- Code signing compatible
- Fast decompression (~100-200ms)
- Algorithms: LZMA, LZFSE, ZLIB, LZ4

**Usage:**
```bash
socket_macho_compress input_binary output_binary [--quality=lzma]
socket_macho_decompress compressed_binary [args...]
```

### Linux (ELF)

**socket_elf_compress** - Compresses Linux binaries using liblzma (native library).

**Features:**
- 75-80% size reduction (LZMA)
- No antivirus flags (native library)
- Fast decompression
- Uses xz-utils (pre-installed on most distros)

**Usage:**
```bash
socket_elf_compress input_binary output_binary [--quality=lzma]
socket_elf_decompress compressed_binary [args...]
```

### Windows (PE)

**socket_pe_compress** - Compresses Windows binaries using Windows Compression API.

**Features:**
- 70-73% size reduction (LZMS)
- No antivirus flags (native API)
- Windows 8+ compatible
- Algorithms: LZMS, XPRESS, XPRESS_HUFF

**Usage:**
```bash
socket_pe_compress.exe input_binary output_binary [--quality=lzms]
socket_pe_decompress.exe compressed_binary [args...]
```

## Building

### macOS

```bash
make                          # Build all macOS tools
make compress                 # Build compressor only
make decompress               # Build decompressor only
make clean                    # Clean build artifacts
sudo make install             # Install to /usr/local/bin
```

**Requirements:** Xcode Command Line Tools (`xcode-select --install`)

### Linux

```bash
make -f Makefile.linux        # Build all Linux tools
make -f Makefile.linux compress
make -f Makefile.linux decompress
make -f Makefile.linux clean
sudo make -f Makefile.linux install
```

**Requirements:** GCC, liblzma-dev (`apt-get install liblzma-dev` or `yum install xz-devel`)

### Windows

```bash
mingw32-make -f Makefile.windows     # Build all Windows tools
mingw32-make -f Makefile.windows compress
mingw32-make -f Makefile.windows decompress
mingw32-make -f Makefile.windows clean
```

**Requirements:** MinGW-w64, Windows 8+ SDK

### Cross-Platform (CMake)

```bash
mkdir build && cd build
cmake ..
cmake --build .
```

**Requirements:** CMake 3.15+, platform-specific compilers and libraries

## Quick Start

### Using Platform-Specific Tools

```bash
# macOS
./socket_macho_compress /usr/local/bin/node ./node.compressed --quality=lzma
./socket_macho_decompress ./node.compressed --version
codesign --sign - --force ./node.compressed  # Optional: Re-sign after compression

# Linux
./socket_elf_compress /usr/bin/node ./node.compressed --quality=lzma
./socket_elf_decompress ./node.compressed --version

# Windows
socket_pe_compress.exe node.exe node.compressed --quality=lzms
socket_pe_decompress.exe node.compressed --version
```

### Using Cross-Platform Scripts (Recommended)

```bash
# Automatically detects platform and uses appropriate tool.
node ../../scripts/compress-binary.mjs ./node ./node.compressed --quality=lzma
node ../../scripts/decompress-binary.mjs ./node.compressed --version

# Benefits: Automatic platform detection, consistent interface, automatic tool building.
```

## Compression Quality

### macOS Algorithms

| Algorithm | Ratio | Speed | Use Case |
|-----------|-------|-------|----------|
| lz4       | 50% | Very Fast (~50ms) | Fast startup |
| zlib      | 60% | Fast (~100ms) | Compatibility |
| lzfse     | 67% | Fast (~120ms) | Balance (Apple default) |
| **lzma**  | **76%** | Moderate (~200ms) | **Maximum compression** |

### Linux Algorithms

| Algorithm | Ratio | Speed | Use Case |
|-----------|-------|-------|----------|
| **lzma**  | **75-80%** | Fast | **Maximum compression (default)** |

### Windows Algorithms

| Algorithm | Ratio | Speed | Use Case |
|-----------|-------|-------|----------|
| xpress      | 60% | Very Fast | Fast startup |
| xpress_huff | 65% | Fast | Balance |
| **lzms**    | **70-73%** | Moderate | **Maximum compression (default)** |

## Size Comparison

Real-world results with custom Node.js builds:

### macOS (44 MB stripped + signed)

```
Original:                 44 MB
├─ LZFSE compressed:      15 MB  (67% reduction)
└─ LZMA compressed:       10 MB  (76% reduction) ⭐

vs. UPX (if it worked):   22 MB  (50% reduction, breaks codesign ✗)
```

### Linux (39 MB stripped)

```
Original:                 39 MB
└─ LZMA compressed:        9 MB  (77% reduction) ⭐

vs. UPX:                  20 MB  (50% reduction, AV flags ⚠)
```

### Windows (estimated, 44 MB)

```
Original:                 44 MB
└─ LZMS compressed:       13 MB  (70% reduction) ⭐

vs. UPX:                  22 MB  (50% reduction, AV flags ⚠)
```

**Key Takeaway:** These tools achieve 20-30% better compression than UPX while avoiding antivirus false positives and maintaining code signing compatibility.

## Integration with Build Process

### Via Cross-Platform Node.js Script (Recommended)

```bash
# Automatically detects platform and uses appropriate tool.
node scripts/compress-binary.mjs \
  build/out/Release/node \
  build/out/Release/node.compressed \
  --quality=lzma

# Test compressed binary.
node scripts/decompress-binary.mjs \
  build/out/Release/node.compressed \
  --version
```

### Via Platform-Specific Scripts

```bash
# macOS only.
node scripts/compress-macho.mjs \
  build/out/Signed/node \
  build/out/Compressed/node \
  --quality=lzma
```

### Via Build Script Integration

Add to your `scripts/build.mjs`:

```javascript
import { spawn } from '@socketsecurity/registry/lib/spawn'
import path from 'node:path'

// After building binary.
async function compressBinary(inputPath, outputPath) {
  const scriptPath = path.join(__dirname, 'scripts', 'compress-binary.mjs')

  const result = await spawn('node', [
    scriptPath,
    inputPath,
    outputPath,
    '--quality=lzma'
  ])

  if (result.code !== 0) {
    throw new Error(`Compression failed: ${result.code}`)
  }

  // macOS: Re-sign after compression.
  if (process.platform === 'darwin') {
    await spawn('codesign', ['--sign', '-', '--force', outputPath])
  }

  console.log('✓ Binary compressed successfully')
}

// Usage.
await compressBinary(
  'build/out/Release/node',
  'build/out/Release/node.compressed'
)
```

## Distribution

For end-user distribution, ship these files:

### Option 1: Direct Tool Distribution

**macOS:**
- `socket-macos-arm64.compressed` (compressed binary)
- `socket_macho_decompress` (decompressor tool)

**Linux:**
- `socket-linux-x64.compressed` (compressed binary)
- `socket_elf_decompress` (decompressor tool)

**Windows:**
- `socket-windows-x64.compressed` (compressed binary)
- `socket_pe_decompress.exe` (decompressor tool)

### Option 2: Wrapper Script (User-Friendly)

**Unix/Linux/macOS:**
```bash
#!/bin/bash
# socket (user-friendly wrapper)
DIR="$(dirname "$0")"
PLATFORM="$(uname -s)"

case "$PLATFORM" in
  Darwin)  DECOMPRESS="socket_macho_decompress" ;;
  Linux)   DECOMPRESS="socket_elf_decompress" ;;
  *)       echo "Unsupported platform: $PLATFORM"; exit 1 ;;
esac

exec "$DIR/$DECOMPRESS" "$DIR/socket.compressed" "$@"
```

**Windows (socket.bat):**
```batch
@echo off
"%~dp0socket_pe_decompress.exe" "%~dp0socket.compressed" %*
```

Users can then run:
```bash
./socket --version
./socket scan create
```

## Technical Details

### Compressed Binary Format

All platforms use a consistent header format with platform-specific magic numbers:

```c
struct CompressedHeader {
  uint32_t magic;          // Platform-specific magic number
  uint32_t algorithm;      // Compression algorithm ID
  uint64_t original_size;  // Decompressed size in bytes
  uint64_t compressed_size;// Compressed payload size in bytes
};
// Followed by compressed payload
```

**Magic Numbers:**
- macOS: `"SCMP"` = `0x504D4353` (Socket Compressed Mach-o Protocol)
- Linux: `"SELF"` = `0x53454C46` (Socket ELF)
- Windows: `"SEPE"` = `0x53455045` (Socket PE)

### Decompression Process

**macOS:**
1. Parse header and validate magic (`0x504D4353`)
2. Decompress using `compression_decode_buffer()` (Apple framework)
3. Write to `/tmp/socket_decompress_XXXXXX`
4. Execute via `execv()` with original arguments
5. Temp file cleaned up on exit

**Linux:**
1. Parse header and validate magic (`0x53454C46`)
2. Decompress using `lzma_stream_buffer_decode()` (liblzma)
3. Write to `/tmp/socket_decompress_XXXXXX`
4. Execute via `execv()` with original arguments
5. Temp file cleaned up on exit

**Windows:**
1. Parse header and validate magic (`0x53455045`)
2. Decompress using `Decompress()` (Windows Compression API)
3. Write to `%TEMP%\socket_*.exe`
4. Execute via `CreateProcessA()` with original arguments
5. Temp file cleaned up after process completes

### Why This Avoids Antivirus False Positives

**UPX Problems:**
- Uses self-modifying code (heuristic trigger)
- Packs executable sections (suspicious behavior)
- Well-known packer signature (blacklisted)

**Our Approach:**
- Uses native OS compression APIs (trusted)
- No self-modifying code (W^X compliant)
- Decompression happens before execution (transparent)
- Native API calls are whitelisted by AV software

## Troubleshooting

### macOS Build Errors

**Error:** `clang++: command not found`
```bash
xcode-select --install
```

**Error:** `ld: framework not found Compression`
```bash
# Use system clang, not Homebrew
/usr/bin/clang++ -o socket_macho_compress socket_macho_compress.cc -lcompression -O3
```

### Linux Build Errors

**Error:** `fatal error: lzma.h: No such file or directory`
```bash
# Debian/Ubuntu
sudo apt-get install liblzma-dev

# RHEL/CentOS/Fedora
sudo yum install xz-devel
```

**Error:** `undefined reference to 'lzma_stream_buffer_encode'`
```bash
# Add -llzma to linker flags
gcc socket_elf_compress.c -o socket_elf_compress -llzma
```

### Windows Build Errors

**Error:** `compressapi.h: No such file or directory`
```
Install Windows 8+ SDK or use Visual Studio 2015+
```

**Error:** `undefined reference to 'CreateCompressor'`
```bash
# Add Cabinet.lib to linker
gcc socket_pe_compress.c -o socket_pe_compress.exe -lCabinet
```

### Compression Errors

**Error:** `Error: Not a valid Mach-O/ELF/PE binary`
```bash
# Verify binary format matches platform
file your_binary

# Should show:
# macOS:   Mach-O 64-bit executable arm64
# Linux:   ELF 64-bit LSB executable, x86-64
# Windows: PE32+ executable (console) x86-64
```

### Decompression Errors

**Error:** `Error: Invalid magic number`

File was not compressed with Socket tools. Compress it first:
```bash
# Auto-detect platform
node scripts/compress-binary.mjs original_binary compressed_binary
```

**Error:** `Error: Size mismatch after decompression`

Corrupted compressed file. Re-compress from original binary.

### Runtime Errors

**Error:** `Failed to execute decompressed binary` (Unix/Linux)
```bash
# Check /tmp permissions
df -h /tmp
ls -ld /tmp
# Should be: drwxrwxrwt (sticky bit set)
```

**Error:** `Access denied` (Windows)
```batch
# Check %TEMP% permissions
echo %TEMP%
dir "%TEMP%"
# Ensure write access to temp directory
```

## Limitations

### All Platforms

1. **Decompression Overhead**: 50-200ms on first run (varies by algorithm)
2. **Memory Usage**: Requires 2x binary size during decompression
3. **Temporary File**: Requires disk space for decompressed binary
4. **Single Binary**: Only compresses single executables (not bundles/libraries)

### Platform-Specific

**macOS:**
- Requires macOS 10.9+ (Compression framework availability)
- Compressed binary must be re-signed after compression

**Linux:**
- Requires liblzma runtime (pre-installed on most distros)
- Temp files use `/tmp` (must have execute permission)

**Windows:**
- Requires Windows 8+ (Compression API availability)
- Temp files use `%TEMP%` directory

## Performance Characteristics

| Platform | Algorithm | Compression | Decompression | Memory |
|----------|-----------|-------------|---------------|--------|
| macOS    | LZMA      | ~5-10s      | ~150ms        | 2x size |
| macOS    | LZFSE     | ~3-5s       | ~100ms        | 2x size |
| Linux    | LZMA      | ~5-10s      | ~120ms        | 2x size |
| Windows  | LZMS      | ~8-12s      | ~180ms        | 2x size |

Tested with 44 MB Node.js binary.

## Future Improvements

1. **Self-Extracting Stub**: Embed decompressor in binary for single-file distribution
2. **In-Memory Execution**: Execute from memory without temporary file (platform-dependent)
3. **Streaming Decompression**: Reduce memory usage by streaming decompression
4. **Section-Level Compression**: Compress only code sections for better ratios
5. **Multi-threaded Compression**: Use parallel compression for faster builds

## References

### Platform Documentation

**macOS:**
- [Apple Compression Framework](https://developer.apple.com/documentation/compression)
- [Mach-O File Format](https://developer.apple.com/documentation/kernel/mach-o_file_format)
- [Code Signing Guide](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/)

**Linux:**
- [liblzma Documentation](https://tukaani.org/xz/xz-file-format.txt)
- [ELF Specification](https://refspecs.linuxfoundation.org/elf/elf.pdf)
- [LZMA Algorithm](https://en.wikipedia.org/wiki/Lempel%E2%80%93Ziv%E2%80%93Markov_chain_algorithm)

**Windows:**
- [Windows Compression API](https://docs.microsoft.com/en-us/windows/win32/cmpapi/-compression-portal)
- [PE Format Specification](https://docs.microsoft.com/en-us/windows/win32/debug/pe-format)
- [Cabinet Compression](https://docs.microsoft.com/en-us/windows/win32/msi/cabinet-files)

### Socket Documentation

- [Cross-Platform Compression Guide](../../docs/cross-platform-compression.md)
- [macOS Compression Details](../../docs/macho-compression.md)
- [Build System Documentation](../../docs/wasm-build-guide.md)

### UPX Alternatives

- [Why Avoid UPX](https://security.stackexchange.com/questions/195085/why-do-antivirus-programs-often-flag-upx-packed-executables)
- [Native Compression Benefits](https://github.com/upx/upx/issues/332)

## License

Copyright © 2024 Socket Security. All rights reserved.
