# Socket CLI yao-pkg Build Support

## Overview

Socket CLI supports building standalone executables using [@yao-pkg/pkg](https://github.com/yao-pkg/pkg), a fork of the original pkg tool that provides better Node.js bytecode compilation support and maintains compatibility with modern Node.js versions.

## Why yao-pkg?

yao-pkg is used for Socket CLI binary distribution because it:

1. **Supports Node.js 24.x** - The original pkg tool was discontinued at Node 18
2. **Handles WASM modules** - Required for yoga-layout (Ink's layout engine)
3. **Better bytecode compilation** - Improved V8 bytecode support for performance
4. **CommonJS compatibility** - Works with dependencies that use top-level await

## Key Implementation Details

### yoga-layout WASM Integration

The primary challenge for pkg binary support is yoga-layout's use of WebAssembly with top-level await. Socket CLI solves this by:

1. **Patching yoga-layout** - Adds a synchronous entry point (`dist/src/sync.js`)
2. **Inlining WASM data** - Base64 WASM is embedded directly in the patch
3. **Synchronous WebAssembly APIs** - Uses `new WebAssembly.Module()` and `new WebAssembly.Instance()`
4. **Proxy-based initialization** - Handles async emscripten setup without top-level await

See `patches/yoga-layout.patch` for implementation details.

### pkg Binary Detection

The CLI detects when running as a pkg binary via `process.pkg` and adjusts execution:

```javascript
if (typeof process.pkg !== 'undefined') {
  // Running as pkg binary - directly execute CLI
  require(constants.distCliPath)
} else {
  // Normal Node - spawn with custom flags
  spawn(node, [...flags, cliPath])
}
```

This is necessary because pkg binaries cannot spawn themselves with custom Node flags.

## Building Custom Node.js for yao-pkg

yao-pkg requires a patched Node.js binary to enable bytecode compilation. Build it once:

```bash
# Download the yao-pkg patch first
mkdir -p .custom-node-build/patches
curl -sL https://raw.githubusercontent.com/yao-pkg/pkg-fetch/main/patches/node.v24.9.0.cpp.patch \
  -o .custom-node-build/patches/node.v24.9.0.cpp.patch

# Build the patched Node.js (30-60 minutes)
pnpm run build:yao-pkg:node
```

The script:
- Clones Node.js v24.9.0
- Applies yao-pkg patches
- Configures with small-icu (standard for yao-pkg)
- Builds with all available CPU cores
- Signs the binary for macOS ARM64

**Output:** `.custom-node-build/node-yao-pkg/out/Release/node`

## Building pkg Binaries

### Quick Build (Current Platform)

Build for your current platform only:

```bash
pnpm run build:yao-pkg
```

This:
1. Builds source with rollup (`pnpm run build:dist:src`)
2. Runs `pnpm exec pkg .` using the config in `pkg.json`

### Full Build (All Platforms)

Build for all platforms (requires custom Node for each architecture):

```bash
# Edit pkg.json targets to specify platforms
pnpm run build:yao-pkg
```

Default targets in `pkg.json`:
- `node24-macos-arm64`
- `node24-macos-x64`
- `node24-linux-arm64`
- `node24-linux-x64`
- `node24-win-arm64`
- `node24-win-x64`

**Note:** Cross-platform builds require access to the target platform's patched Node binary.

## Configuration Files

### pkg.json

Main pkg configuration:

```json
{
  "node": "/path/to/.custom-node-build/node-yao-pkg/out/Release/node",
  "targets": ["node24-macos-arm64", ...],
  "outputPath": "pkg-binaries",
  "assets": ["dist/**/*", "requirements.json", "translations.json", "shadow-bin/**/*"],
  "scripts": {
    // yoga-layout WASM files from patched version
    "node_modules/.pnpm/yoga-layout@3.2.1_patch_hash=.../dist/binaries/yoga-wasm-base64-esm.js":
      "node_modules/.pnpm_patches/yoga-layout@3.2.1/dist/binaries/yoga-wasm-base64-esm.js",
    // ... other yoga-layout files
  }
}
```

Key settings:
- **node** - Path to custom yao-pkg patched Node binary
- **targets** - Platform/architecture combinations to build
- **assets** - Files to include in binary (copied to /snapshot)
- **scripts** - Files to include in binary (bundled as bytecode)

## Testing pkg Binaries

Test the built binaries:

```bash
# Built binaries are in pkg-binaries/ or root
./socket-macos --version
./socket-macos scan create --help

# Test a real scan
./socket-macos scan create --json
```

## Limitations & Considerations

1. **Binary Size** - pkg binaries are ~90-110MB (includes Node runtime + bundled code)
2. **Build Time** - Custom Node build takes 30-60 minutes (one-time)
3. **Platform Specific** - Must build custom Node for each target architecture
4. **Dynamic Requires** - Some dynamic requires may not work (see pkg warnings during build)
5. **WASM Limitations** - Only works with our patched yoga-layout approach

## Troubleshooting

### Build Failures

**yoga-layout WASM errors:**
```
Error: File '/**/yoga-wasm-base64-esm.js' was not included
```
- Ensure `patches/yoga-layout.patch` is applied
- Check `pkg.json` scripts section includes yoga-layout files
- Verify `pnpm-lock.yaml` shows patched version

**Missing custom Node:**
```
Error: Cannot find Node binary
```
- Run `pnpm run build:yao-pkg:node` first
- Check `pkg.json` node path points to built binary

### Runtime Errors

**Invalid character in atob():**
- yoga-layout patch may have malformed base64
- Regenerate patch: `pnpm patch-commit node_modules/.pnpm_patches/yoga-layout@3.2.1`

**Module not found:**
- Check if module is in `pkg.json` assets or scripts
- Some modules may need explicit inclusion

## Comparison with SEA

Socket CLI supports both pkg (yao-pkg) and SEA (Single Executable Application):

| Feature | yao-pkg | SEA |
|---------|---------|-----|
| Node Version | 24.x (patched) | 24.8.0+ (native) |
| Binary Size | ~90-110MB | ~60-80MB |
| Build Time | Fast (~30s) | Slower (~2-3min) |
| Custom Node | Required (one-time) | Not required |
| WASM Support | Requires patches | Native support |
| Bytecode | V8 bytecode | V8 snapshot |
| Maturity | Community fork | Official Node.js |

**Recommendation:** Use SEA for production unless you need specific pkg features.

## References

- [yao-pkg/pkg GitHub](https://github.com/yao-pkg/pkg)
- [Original pkg tool](https://github.com/vercel/pkg) (discontinued)
- [Node.js SEA Documentation](https://nodejs.org/api/single-executable-applications.html)
- Socket CLI: `docs/SEA_PLATFORM_SUPPORT.md`
