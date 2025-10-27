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

```bash
cd packages/node-smol-builder
pnpm run build
```

The build process:
1. Downloads Node.js v24.10.0 source
2. Applies Socket security patches from `patches/`
3. Configures and compiles Node.js
4. Copies bootstrap code to internal modules
5. Signs the binary (macOS)

## Output

Built binary: `build/out/Release/node`

## Platform Support

Currently builds for the host platform only. Cross-compilation not yet supported.

## License

MIT
